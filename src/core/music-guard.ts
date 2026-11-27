export interface GuardedMessage {
  inMusicChannel: boolean;
  authorIsBot: boolean;
  /** Typed by someone (a message or a reply), not a join, a pin or another system message. */
  isUserMessage: boolean;
  /** In the text chat of a voice room, where music commands are welcome. */
  inVoiceChat: boolean;
  content: string;
  mentionedBotIds: readonly string[];
  botId: string;
}

export type MusicVerdict = 'keep' | { delete: true; notice: 'here' | 'elsewhere' };

/**
 * #musica takes only music commands; anywhere else but a voice room's chat, a music command is
 * removed and its author pointed to #musica. A music command is one of the prefixes (`m!play`) or
 * a mention of a music bot at the start (`@Jockie Music play`), which Jockie also takes as a prefix.
 */
export function musicVerdict(
  message: GuardedMessage,
  settings: { commandPrefixes: readonly string[] },
): MusicVerdict {
  if (message.authorIsBot || !message.isUserMessage) return 'keep';
  const command = isMusicCommand(message, settings.commandPrefixes);
  if (message.inMusicChannel) return command ? 'keep' : { delete: true, notice: 'here' };
  if (message.inVoiceChat || !command) return 'keep';
  return { delete: true, notice: 'elsewhere' };
}

function isMusicCommand(message: GuardedMessage, commandPrefixes: readonly string[]): boolean {
  const text = message.content.trimStart().toLowerCase();
  if (commandPrefixes.some((prefix) => text.startsWith(prefix.toLowerCase()))) return true;
  const mentioned = /^<@!?(\d+)>/.exec(text)?.[1];
  return (
    mentioned !== undefined &&
    mentioned !== message.botId &&
    message.mentionedBotIds.includes(mentioned)
  );
}
