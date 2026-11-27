import type { ServerConfig } from './schema.js';

// Named readers for the settings several modules share, so the YAML's shape stays in config/.

/** The legion's name in the game. */
export const ownLegion = (config: ServerConfig): string => config.settings.characters.legion;

/** The officers' channel: the daily check's report, review threads and every notice for them. */
export const officerChannelKey = (config: ServerConfig): string | undefined =>
  config.settings.characters.reportChannel;

/** Recruitment's channels and ping role, when recruitment is on. */
export const recruitmentSettings = (config: ServerConfig) => config.settings.recruitment;

/** The alliances' shared chat, linked in an ally's welcome. */
export const allianceChatKey = (config: ServerConfig): string | undefined =>
  config.settings.alliances.channel;

/** The audit log channel. */
export const auditChannelKey = (config: ServerConfig): string => config.settings.audit.channel;
