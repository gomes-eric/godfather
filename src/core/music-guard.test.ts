import { describe, expect, it } from 'vitest';
import { musicVerdict, type GuardedMessage } from './music-guard.js';

const JOCKIE = '411916947773587456';
const PADRINHO = '500000000000000001';

const message = (over: Partial<GuardedMessage>): GuardedMessage => ({
  inMusicChannel: true,
  authorIsBot: false,
  isUserMessage: true,
  inVoiceChat: false,
  content: '',
  mentionedBotIds: [],
  botId: PADRINHO,
  ...over,
});
const settings = { commandPrefixes: ['m!'] };
const here = { delete: true, notice: 'here' };
const elsewhere = { delete: true, notice: 'elsewhere' };

describe('musicVerdict in #musica', () => {
  it.each([
    ['a prefix command', { content: 'm!p never gonna' }, 'keep'],
    ['a prefix command in any case, after spaces', { content: '  M!Queue' }, 'keep'],
    [
      'a music bot mention at the start',
      { content: `<@${JOCKIE}> play x`, mentionedBotIds: [JOCKIE] },
      'keep',
    ],
    [
      'a nickname mention of a music bot',
      { content: `<@!${JOCKIE}> p x`, mentionedBotIds: [JOCKIE] },
      'keep',
    ],
    ['a bot message', { authorIsBot: true, content: 'Tocando agora' }, 'keep'],
    ['a system message', { isUserMessage: false }, 'keep'],
    ['chatter', { content: 'que música boa' }, here],
    ['a prefix in the middle', { content: 'olha m!p' }, here],
    ['a mention of a person', { content: '<@1> olha', mentionedBotIds: [] }, here],
    [
      'a mention of Padrinho itself',
      { content: `<@${PADRINHO}> oi`, mentionedBotIds: [PADRINHO] },
      here,
    ],
  ])('%s', (_, over, verdict) => {
    expect(musicVerdict(message(over), settings)).toEqual(verdict);
  });

  it('removes every typed message when no prefix is configured', () => {
    expect(musicVerdict(message({ content: 'm!p x' }), { commandPrefixes: [] })).toEqual(here);
  });
});

describe('musicVerdict elsewhere', () => {
  const outside = (over: Partial<GuardedMessage>) => message({ inMusicChannel: false, ...over });

  it.each([
    ['a prefix command', { content: 'm!p never gonna' }, elsewhere],
    [
      'a music bot mention at the start',
      { content: `<@${JOCKIE}> play x`, mentionedBotIds: [JOCKIE] },
      elsewhere,
    ],
    ['chatter that names a prefix', { content: 'bora tocar m!p depois?' }, 'keep'],
    [
      'a music bot mention in the middle',
      { content: `oi <@${JOCKIE}>`, mentionedBotIds: [JOCKIE] },
      'keep',
    ],
    [
      'a mention of Padrinho itself',
      { content: `<@${PADRINHO}> play x`, mentionedBotIds: [PADRINHO] },
      'keep',
    ],
    ['a command in a voice room chat', { content: 'm!p x', inVoiceChat: true }, 'keep'],
    ['a command by a bot', { content: 'm!p x', authorIsBot: true }, 'keep'],
    ['a system message', { content: 'm!p x', isUserMessage: false }, 'keep'],
  ])('%s', (_, over, verdict) => {
    expect(musicVerdict(outside(over), settings)).toEqual(verdict);
  });
});
