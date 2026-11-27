import { systemActor } from '../core/actor.js';
import { sameSchedule, scheduleFor, TIMERS_URL } from '../core/event-times.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { EventTemplateConfig } from '../config/schema.js';
import type { ConfigStore } from '../config/store.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import type { EventCalendar } from './event-calendar.js';
import { fetchJson, type FetchJson } from './fetch-json.js';

const t = ptBR.events;

interface Deps {
  config: Pick<ConfigStore, 'get'>;
  calendar: Pick<EventCalendar, 'updateTemplate'>;
  botUserId: string;
  logger: Logger;
  warn: (text: string) => Promise<void>;
  fetchJson?: FetchJson;
}

export class EventTimesService implements BackgroundJob {
  private readonly fetchJson: FetchJson;
  private readonly warned = new Map<string, string>();

  constructor(private readonly deps: Deps) {
    this.fetchJson = deps.fetchJson ?? ((url) => fetchJson(url, 15_000));
  }

  async check(): Promise<string[]> {
    const config = this.deps.config.get();
    const settings = config.settings.eventTimes;
    const linked = config.eventTemplates.filter((tpl) => tpl.shugoEvent);
    if (!settings || linked.length === 0) return [];

    const timers = await this.fetchJson(TIMERS_URL);
    const target = { ...settings, timeZone: config.settings.timezone };
    const changed: string[] = [];
    for (const template of linked) {
      const schedule = scheduleFor(timers, template.shugoEvent!, target);
      if ('error' in schedule) {
        await this.warnOnce(
          template,
          schedule.error,
          t.shugoProblem(template.title, schedule.error),
        );
        continue;
      }
      if (!sameSchedule(schedule, template)) {
        const outcome = await this.deps.calendar.updateTemplate(
          systemActor(this.deps.botUserId),
          template.key,
          { days: schedule.days.join(' '), time: schedule.time, source: TIMERS_URL },
        );
        if (outcome.status !== 'ok') {
          const problem = outcome.status === 'rejected' ? outcome.reason : outcome.status;
          await this.warnOnce(template, problem, t.shugoRejected(template.title, problem));
          continue;
        }
        changed.push(template.key);
      }
      this.warned.delete(template.key);
    }
    if (changed.length > 0) {
      this.deps.logger.info({ templates: changed }, 'event times updated from shugo.gg');
    }
    return changed;
  }

  start(): () => void {
    const hours = this.deps.config.get().settings.eventTimes?.checkHours ?? 6;
    return repeat(
      hours * 3_600_000,
      () => this.check(),
      (error) => this.deps.logger.warn({ err: error }, 'event time check failed'),
    );
  }

  private async warnOnce(template: EventTemplateConfig, problem: string, text: string) {
    if (this.warned.get(template.key) === problem) return;
    this.warned.set(template.key, problem);
    this.deps.logger.warn({ template: template.key, problem }, 'event time');
    await this.deps.warn(text);
  }
}
