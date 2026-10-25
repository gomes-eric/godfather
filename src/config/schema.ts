import { z } from 'zod';
import { TIERS, type RankedTier } from '../core/tiers.js';

// Subset of server.yaml needed so far. Phase 2 extends it to the full layout; unknown keys are
// kept (looseObject) so the file can describe more than the code reads yet.

const roleSchema = z.looseObject({
  key: z.string().min(1),
  name: z.string().min(1),
  tier: z.enum(TIERS).optional(),
});

const channelSchema = z.looseObject({
  key: z.string().min(1),
  name: z.string().min(1),
});

const categorySchema = z.looseObject({
  key: z.string().min(1),
  name: z.string().min(1),
  channels: z.array(channelSchema).default([]),
});

export const serverConfigSchema = z
  .looseObject({
    settings: z.looseObject({
      audit: z.object({ channel: z.string().min(1) }),
    }),
    roles: z.array(roleSchema),
    categories: z.array(categorySchema),
  })
  .superRefine((config, ctx) => {
    const channelKeys = new Set(config.categories.flatMap((c) => c.channels.map((ch) => ch.key)));
    if (!channelKeys.has(config.settings.audit.channel)) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'audit', 'channel'],
        message: `unknown channel key "${config.settings.audit.channel}"`,
      });
    }

    const seenTiers = new Set<string>();
    config.roles.forEach((role, index) => {
      if (!role.tier) return;
      if (seenTiers.has(role.tier)) {
        ctx.addIssue({
          code: 'custom',
          path: ['roles', index, 'tier'],
          message: `tier "${role.tier}" is assigned to more than one role`,
        });
      }
      seenTiers.add(role.tier);
    });
  });

export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** Discord role names for each ranked tier, e.g. { officer: "Oficial" }. */
export function tierRoleNames(config: ServerConfig): Partial<Record<RankedTier, string>> {
  const names: Partial<Record<RankedTier, string>> = {};
  for (const role of config.roles) {
    if (role.tier && role.tier !== 'visitor') names[role.tier] = role.name;
  }
  return names;
}

export function channelNameByKey(config: ServerConfig, key: string): string | undefined {
  for (const category of config.categories) {
    const channel = category.channels.find((c) => c.key === key);
    if (channel) return channel.name;
  }
  return undefined;
}
