import { describe, expect, it } from 'vitest';
import { sameSchedule, scheduleFor } from './event-times.js';

const SP = 'America/Sao_Paulo';

const timers = {
  updatedAt: '2026-10-25',
  regions: [
    { id: 'global-sa', label: 'S. America', timeZone: SP },
    { id: 'global-eu', label: 'Europe', timeZone: 'Europe/Berlin' },
  ],
  events: [
    {
      id: 'artifact-siege',
      name: 'Artifact Siege',
      schedules: {
        'global-sa': {
          type: 'weekly',
          days: ['mon', 'thu', 'sat'],
          times: ['21:00', '21:05', '21:10'],
          timeLabels: ['Group 1', 'Group 2', 'Group 3'],
        },
      },
    },
    {
      id: 'guardian-nahma',
      name: 'Guardian Lord Nahma',
      schedules: {
        'global-sa': { type: 'weekly', days: ['fri', 'sun'], times: ['21:00'] },
        'global-eu': { type: 'weekly', days: ['fri', 'sun'], times: ['21:00'] },
      },
    },
    {
      id: 'battlefield',
      name: 'Battlefield',
      schedules: { 'global-sa': { type: 'daily', times: ['11:00', '19:00'] } },
    },
    {
      id: 'shugo-festival',
      name: 'Shugo Festival',
      schedules: { 'global-sa': { type: 'hourly', minute: 0 } },
    },
    {
      id: 'daily-reset',
      name: 'Daily reset',
      schedules: { 'global-sa': { type: 'daily', times: ['16:00'], timeZone: 'Asia/Seoul' } },
    },
  ],
};

const triniel = { region: 'global-sa', group: 1, timeZone: SP };

describe('scheduleFor', () => {
  it('reads a weekly event, picking the server group time', () => {
    expect(scheduleFor(timers, 'artifact-siege', triniel)).toEqual({
      days: ['mon', 'thu', 'sat'],
      time: '21:00',
    });
    expect(scheduleFor(timers, 'artifact-siege', { ...triniel, group: 3 })).toEqual({
      days: ['mon', 'thu', 'sat'],
      time: '21:10',
    });
  });

  it('reads an event with a single time', () => {
    expect(scheduleFor(timers, 'guardian-nahma', triniel)).toEqual({
      days: ['fri', 'sun'],
      time: '21:00',
    });
  });

  it('refuses what a template cannot hold: several times a day, hourly, unknown ids', () => {
    expect(scheduleFor(timers, 'battlefield', triniel)).toEqual({
      error: expect.stringContaining('battlefield'),
    });
    expect(scheduleFor(timers, 'shugo-festival', triniel)).toEqual({
      error: expect.stringContaining('hourly'),
    });
    expect(scheduleFor(timers, 'nope', triniel)).toEqual({
      error: expect.stringContaining('nope'),
    });
    expect(scheduleFor(timers, 'artifact-siege', { ...triniel, group: 4 })).toEqual({
      error: expect.stringContaining('group 4'),
    });
  });

  it('refuses times on another clock than the server', () => {
    expect(scheduleFor(timers, 'daily-reset', triniel)).toEqual({
      error: expect.stringContaining('Asia/Seoul'),
    });
    expect(scheduleFor(timers, 'guardian-nahma', { ...triniel, region: 'global-eu' })).toEqual({
      error: expect.stringContaining('Europe/Berlin'),
    });
  });

  it('refuses a file in an unknown shape', () => {
    expect(scheduleFor({ events: 'x' }, 'artifact-siege', triniel)).toEqual({
      error: expect.stringContaining('timers.json'),
    });
  });
});

describe('sameSchedule', () => {
  it('ignores the order of the days', () => {
    expect(
      sameSchedule(
        { days: ['thu', 'mon'], time: '21:00' },
        { days: ['mon', 'thu'], time: '21:00' },
      ),
    ).toBe(true);
    expect(
      sameSchedule({ days: ['mon'], time: '21:00' }, { days: ['mon', 'thu'], time: '21:00' }),
    ).toBe(false);
    expect(sameSchedule({ days: ['mon'], time: '21:00' }, { days: ['mon'], time: '21:05' })).toBe(
      false,
    );
  });
});
