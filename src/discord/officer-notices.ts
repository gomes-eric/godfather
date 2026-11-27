import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from './directory.js';

/** The officers' channel (settings.characters.reportChannel), where the bot reports to them. */
export function officerChannel(directory: GuildDirectory, config: ConfigStore) {
  const key = config.get().settings.characters.reportChannel;
  return key ? directory.channelByKey(key) : undefined;
}

/** A short notice for the officers; mentions are shown but never ping. */
export async function notifyOfficers(
  deps: { directory: GuildDirectory; config: ConfigStore },
  content: string,
): Promise<void> {
  await officerChannel(deps.directory, deps.config)?.send({
    content,
    allowedMentions: { parse: [] },
  });
}
