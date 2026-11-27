import type { ServerConfig } from './schema.js';

export const ownLegion = (config: ServerConfig): string => config.settings.characters.legion;

export const officerChannelKey = (config: ServerConfig): string | undefined =>
  config.settings.characters.reportChannel;

export const recruitmentSettings = (config: ServerConfig) => config.settings.recruitment;

export const allianceChatKey = (config: ServerConfig): string | undefined =>
  config.settings.alliances.channel;

export const auditChannelKey = (config: ServerConfig): string => config.settings.audit.channel;
