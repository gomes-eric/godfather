import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from './directory.js';

export function officerChannel(directory: GuildDirectory, config: ConfigStore) {
  const key = config.get().settings.characters.reportChannel;
  return key ? directory.channelByKey(key) : undefined;
}

export async function notifyOfficers(
  deps: { directory: GuildDirectory; config: ConfigStore },
  content: string,
): Promise<void> {
  await officerChannel(deps.directory, deps.config)?.send({
    content,
    allowedMentions: { parse: [] },
  });
}
