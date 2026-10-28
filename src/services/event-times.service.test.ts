import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActionRequest } from '../core/action.js';
import { ConfigStore } from '../config/store.js';
import type { Logger } from '../logger.js';
import { EventTimesService } from './event-times.service.js';

const SERVER_YAML = readFileSync(new URL('../../server.yaml', import.meta.url), 'utf8');
const logger = { info: () => undefined, warn: () => undefined } as unknown as Logger;

const timers = (siegeDays: string[], siegeTimes: string[]) => ({
  regions: [{ id: 'global-sa', timeZone: 'America/Sao_Paulo' }],
  events: [
    {
      id: 'artifact-siege',
      schedules: {
        'global-sa': {
          type: 'weekly',
          days: siegeDays,
          times: siegeTimes,
          timeLabels: siegeTimes.map((_, i) => `Group ${i + 1}`),
        },
      },
    },
    {
      id: 'siege-bosses',
      schedules: {
        'global-sa': {
          type: 'weekly',
          days: ['mon', 'thu', 'sat'],
          times: ['21:30', '21:35', '21:40'],
          timeLabels: ['Group 1', 'Group 2', 'Group 3'],
        },
      },
    },
    {
      id: 'guardian-nahma',
      schedules: { 'global-sa': { type: 'weekly', days: ['fri', 'sun'], times: ['21:00'] } },
    },
  ],
});

function setup(feed: { current: unknown }) {
  const path = join(mkdtempSync(join(tmpdir(), 'padrinho-')), 'server.yaml');
  writeFileSync(path, SERVER_YAML);
  const config = new ConfigStore(path);
  const actions: string[] = [];
  const warnings: string[] = [];
  let refreshed = 0;
  const service = new EventTimesService({
    config,
    botUserId: '1',
    logger,
    runAction: async <T>(request: ActionRequest<T>) => {
      actions.push(`${request.action} ${request.target}`);
      return { status: 'ok', value: await request.execute() };
    },
    warn: async (text) => void warnings.push(text),
    onChange: () => void refreshed++,
    fetchJson: async () => feed.current,
  });
  const template = (key: string) => config.get().eventTemplates.find((tpl) => tpl.key === key)!;
  return { service, config, path, actions, warnings, template, refreshed: () => refreshed };
}

describe('EventTimesService', () => {
  it('leaves server.yaml alone when it matches timers.json', async () => {
    const s = setup({ current: timers(['mon', 'thu', 'sat'], ['21:00', '21:05', '21:10']) });
    expect(await s.service.check()).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(readFileSync(s.path, 'utf8')).toBe(SERVER_YAML);
  });

  it('rewrites a template that moved, audited, and refreshes reminders', async () => {
    const s = setup({ current: timers(['tue', 'fri'], ['20:30', '20:35', '20:40']) });
    expect(await s.service.check()).toEqual(['abyss-war']);
    expect(s.actions).toEqual(['event.template.edit abyss-war']);
    expect(s.template('abyss-war')).toMatchObject({ days: ['tue', 'fri'], time: '20:30' });
    expect(new ConfigStore(s.path).get().eventTemplates[0]).toMatchObject({ time: '20:30' });
    expect(s.refreshed()).toBe(1);
  });

  it('warns once when an event can no longer be read, keeping the yaml time', async () => {
    const feed = { current: timers(['mon', 'thu', 'sat'], ['21:00', '21:05', '21:10']) };
    feed.current.events = feed.current.events.filter((e) => e.id !== 'guardian-nahma');
    const s = setup(feed);
    await s.service.check();
    await s.service.check();
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain('Nahma');
    expect(s.template('weekly-boss-nahma')).toMatchObject({ days: ['fri', 'sun'], time: '21:00' });
  });
});
