import type { ConfigStore } from '../config/store.js';
import type { GuildDirectory } from './directory.js';
import { officerChannelKey } from '../config/views.js';

export function officerChannel(directory: GuildDirectory, config: ConfigStore) {
  const key = officerChannelKey(config.get());
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
