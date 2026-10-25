import { describe, expect, it } from 'vitest';
import { helpEmbed, helpFor } from './help.js';
import { commands } from './index.js';

const usages = (tier: Parameters<typeof helpFor>[0]) =>
  helpFor(tier).flatMap((section) => section.entries.map((entry) => entry.usage));

describe('/help', () => {
  it('shows each tier only what it can use', () => {
    expect(usages('visitor')).toContain('/voice rename');
    expect(usages('visitor')).not.toContain('/event list');
    expect(usages('soldier')).toContain('/event list');
    expect(usages('soldier')).not.toContain('/member promote · demote');
    expect(usages('officer')).toContain('/member partner');
    expect(usages('officer')).not.toContain('/setup');
    expect(usages('commander')).toContain('/setup');
    expect(usages('commander')).toContain('/mod ban · unban');
  });

  it('mentions every registered command', () => {
    const text = usages('commander').join(' ');
    for (const command of commands.filter((c) => c.data.name !== 'help')) {
      expect(text, command.data.name).toContain(`/${command.data.name}`);
    }
  });

  it('fits Discord embed limits', () => {
    const embed = helpEmbed('commander').toJSON();
    expect(embed.fields!.length).toBeLessThanOrEqual(25);
    for (const field of embed.fields!) expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(embed).length).toBeLessThan(6000);
  });
});
