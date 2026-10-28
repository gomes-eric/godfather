// Pure reading of shugo.gg's timers.json (https://shugo.gg/timers.json): the official start times
// of the game's recurring events per region, turned into server.yaml template days and time.

import { z } from 'zod';
import { WEEKDAYS, type Weekday } from '../config/schema.js';

export const TIMERS_URL = 'https://shugo.gg/timers.json';

export interface TemplateSchedule {
  days: (Weekday | 'daily')[];
  time: string;
}

export interface ScheduleTarget {
  /** timers.json region id; South America (Triniel) is "global-sa". */
  region: string;
  /** Siege matching group: picks the time when an event lists one per group. */
  group: number;
  /** The server's clock; times on any other clock are refused, not converted. */
  timeZone: string;
}

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const timersSchema = z.object({
  regions: z.array(z.object({ id: z.string(), timeZone: z.string() })),
  events: z.array(
    z.object({
      id: z.string(),
      schedules: z.record(
        z.string(),
        z.looseObject({
          type: z.string(),
          days: z.array(z.string()).optional(),
          times: z.array(clockTime).optional(),
          timeLabels: z.array(z.string()).optional(),
          timeZone: z.string().optional(),
        }),
      ),
    }),
  ),
});

/** Days and time of one timers.json event for the server, or why it can't be a template. */
export function scheduleFor(
  json: unknown,
  eventId: string,
  target: ScheduleTarget,
): TemplateSchedule | { error: string } {
  const parsed = timersSchema.safeParse(json);
  if (!parsed.success) return { error: 'timers.json came in an unknown format' };
  const { regions, events } = parsed.data;

  const region = regions.find((r) => r.id === target.region);
  if (!region) return { error: `timers.json has no region "${target.region}"` };
  const event = events.find((e) => e.id === eventId);
  if (!event) return { error: `timers.json has no event "${eventId}"` };
  const schedule = event.schedules[target.region];
  if (!schedule) return { error: `"${eventId}" has no schedule for ${target.region}` };

  const timeZone = schedule.timeZone ?? region.timeZone;
  if (timeZone !== target.timeZone) {
    return { error: `"${eventId}" runs on ${timeZone}, not ${target.timeZone}` };
  }

  let days: TemplateSchedule['days'];
  if (schedule.type === 'daily') {
    days = ['daily'];
  } else if (schedule.type === 'weekly') {
    const weekdays = schedule.days ?? [];
    if (weekdays.length === 0 || !weekdays.every((d) => WEEKDAYS.includes(d as Weekday))) {
      return { error: `"${eventId}" has unknown days: ${weekdays.join(', ')}` };
    }
    days = weekdays as Weekday[];
  } else {
    return { error: `"${eventId}" is a ${schedule.type} event, not daily or weekly` };
  }

  const times = schedule.times ?? [];
  let time: string | undefined;
  if (times.length === 1) {
    time = times[0];
  } else if (schedule.timeLabels?.length === times.length) {
    time = times[target.group - 1];
    if (!time) return { error: `"${eventId}" has no time for group ${target.group}` };
  } else {
    return { error: `"${eventId}" runs ${times.length} times a day; a template holds one` };
  }
  return { days, time: time! };
}

export function sameSchedule(a: TemplateSchedule, b: TemplateSchedule): boolean {
  const days = (s: TemplateSchedule) => [...s.days].sort().join(',');
  return a.time === b.time && days(a) === days(b);
}
