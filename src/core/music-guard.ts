export interface GuardedMessage {
  inMusicChannel: boolean;
  authorIsBot: boolean;
  isUserMessage: boolean;
  inVoiceChat: boolean;
  content: string;
  mentionedBotIds: readonly string[];
  botId: string;
}

export type MusicVerdict = 'keep' | { delete: true; notice: 'here' | 'elsewhere' };

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
