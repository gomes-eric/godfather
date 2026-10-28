import type { ActionRunner } from '../core/action.js';
import { systemActor } from '../core/actor.js';
import { sameSchedule, scheduleFor, TIMERS_URL } from '../core/event-times.js';
import { repeat, type BackgroundJob } from '../core/repeat.js';
import type { ConfigStore } from '../config/store.js';
import { ptBR } from '../i18n/pt-BR.js';
import type { Logger } from '../logger.js';
import { fetchJson, type FetchJson } from './fetch-json.js';

const t = ptBR.events;

interface Deps {
  config: ConfigStore;
  runAction: ActionRunner;
  botUserId: string;
  logger: Logger;
  /** Posts a warning in #audit-log. */
  warn: (text: string) => Promise<void>;
  /** Called after a template moves, so reminders follow right away. */
  onChange?: () => void;
  fetchJson?: FetchJson;
}

/**
 * Keeps the recurring events linked by `shugoEvent` on the times shugo.gg publishes
 * (timers.json, South America on São Paulo time): a template whose days or time differ is
 * rewritten in server.yaml, audited as Padrinho.
 */
export class EventTimesService implements BackgroundJob {
  private readonly fetchJson: FetchJson;
  /** Last problem warned per template, so each one goes to #audit-log once. */
  private readonly warned = new Map<string, string>();

  constructor(private readonly deps: Deps) {
    this.fetchJson = deps.fetchJson ?? ((url) => fetchJson(url, 15_000));
  }

  /** Brings the linked templates in line with timers.json; returns the keys it changed. */
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
        if (this.warned.get(template.key) !== schedule.error) {
          this.warned.set(template.key, schedule.error);
          this.deps.logger.warn({ template: template.key, problem: schedule.error }, 'event time');
          await this.deps.warn(t.shugoProblem(template.title, schedule.error));
        }
        continue;
      }
      this.warned.delete(template.key);
      if (sameSchedule(schedule, template)) continue;

      await this.deps.runAction({
        actor: systemActor(this.deps.botUserId),
        action: 'event.template.edit',
        target: template.key,
        params: { ...schedule, source: TIMERS_URL },
        preview: template.key,
        execute: async () => this.deps.config.updateEventTemplate(template.key, schedule),
      });
      changed.push(template.key);
    }
    if (changed.length > 0) {
      this.deps.logger.info({ templates: changed }, 'event times updated from shugo.gg');
      this.deps.onChange?.();
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
}
