import { z } from 'zod';
import { CLOCK_PATTERN, WEEKDAYS, type Weekday } from '../config/schema.js';

export const TIMERS_URL = 'https://shugo.gg/timers.json';

export interface TemplateSchedule {
  days: (Weekday | 'daily')[];
  time: string;
}

export interface ScheduleTarget {
  region: string;
  group: number;
  timeZone: string;
}

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
          times: z.array(z.string().regex(CLOCK_PATTERN)).optional(),
          timeLabels: z.array(z.string()).optional(),
          timeZone: z.string().optional(),
        }),
      ),
    }),
  ),
});

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
