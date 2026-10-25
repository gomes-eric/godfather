import { PermissionFlagsBits as P } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { EVERYONE } from './model.js';
import { computeOverwrites } from './overwrites.js';

const tierRoleKeys = { commander: 'commander', officer: 'officer', soldier: 'soldier' };
const byTarget = (overwrites: ReturnType<typeof computeOverwrites>) =>
  Object.fromEntries(overwrites.map((o) => [o.target, o]));

describe('computeOverwrites', () => {
  it('public read-only channel: everyone sees, nobody but the bot writes', () => {
    const o = byTarget(
      computeOverwrites({ kind: 'text', view: 'everyone', write: 'bot', tierRoleKeys }),
    );

    expect(o[EVERYONE]?.allow).toBe(P.ViewChannel | P.ReadMessageHistory);
    expect(o[EVERYONE]?.deny).toBe(
      P.SendMessages | P.SendMessagesInThreads | P.CreatePublicThreads | P.CreatePrivateThreads,
    );
    expect(o.soldier).toBeUndefined();
  });

  it('members-only channel: hidden from everyone, open to soldier and above', () => {
    const o = byTarget(
      computeOverwrites({ kind: 'text', view: 'soldier', write: 'soldier', tierRoleKeys }),
    );

    expect(o[EVERYONE]?.deny ?? 0n).toBe(
      P.ViewChannel |
        P.ReadMessageHistory |
        P.SendMessages |
        P.SendMessagesInThreads |
        P.CreatePublicThreads |
        P.CreatePrivateThreads,
    );
    for (const role of ['soldier', 'officer', 'commander']) {
      expect(o[role]?.allow, role).toBe(o[EVERYONE]?.deny);
    }
  });

  it('officer channel does not open to soldiers', () => {
    const o = byTarget(
      computeOverwrites({ kind: 'voice', view: 'officer', write: 'officer', tierRoleKeys }),
    );

    expect(o.soldier).toBeUndefined();
    expect(o.officer?.allow).toBe(P.ViewChannel | P.Connect | P.Speak | P.Stream);
  });

  it('#musica: soldiers see and run slash commands but nobody writes', () => {
    const o = byTarget(
      computeOverwrites({
        kind: 'text',
        view: 'soldier',
        write: 'none',
        slashCommands: 'soldier',
        tierRoleKeys,
      }),
    );

    expect((o[EVERYONE]?.deny ?? 0n) & P.SendMessages).toBe(P.SendMessages);
    expect((o[EVERYONE]?.deny ?? 0n) & P.UseApplicationCommands).toBe(P.UseApplicationCommands);
    expect((o.soldier?.allow ?? 0n) & P.SendMessages).toBe(0n);
    expect((o.soldier?.allow ?? 0n) & P.UseApplicationCommands).toBe(P.UseApplicationCommands);
  });

  it('adds fixed allows such as the Bot role in voice channels', () => {
    const o = byTarget(
      computeOverwrites({
        kind: 'voice',
        view: 'officer',
        write: 'officer',
        tierRoleKeys,
        extraAllows: [{ roleKey: 'bots', allow: P.ViewChannel | P.Connect | P.Speak }],
      }),
    );

    expect(o.bots?.allow).toBe(P.ViewChannel | P.Connect | P.Speak);
  });

  it('announcement channels also block threads for people who cannot post', () => {
    const o = byTarget(
      computeOverwrites({ kind: 'announcement', view: 'everyone', write: 'officer', tierRoleKeys }),
    );
    expect((o[EVERYONE]?.deny ?? 0n) & P.CreatePublicThreads).toBe(P.CreatePublicThreads);
    expect((o.officer?.allow ?? 0n) & P.SendMessages).toBe(P.SendMessages);
  });

  it('ignores tiers whose role is not configured', () => {
    const o = byTarget(
      computeOverwrites({
        kind: 'text',
        view: 'soldier',
        write: 'soldier',
        tierRoleKeys: { officer: 'officer' },
      }),
    );

    expect(Object.keys(o).sort()).toEqual([EVERYONE, 'officer']);
  });
});
