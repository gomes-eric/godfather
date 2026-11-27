import { z } from 'zod';
import { KEY_PATTERN } from '../../config/schema.js';
import { json, confirm, configFailure, type ToolKit } from './kit.js';

export function registerVoiceTools({ tool, s, actor }: ToolKit): void {
  tool('list_voice_generators', 'Geradores de salas de voz (➕) do server.yaml.', {}, async () =>
    json(s.config.get().voiceGenerators),
  );
  tool(
    'upsert_voice_generator',
    'Cria ou edita um gerador de salas de voz no server.yaml. Depois rode apply_server_config.',
    {
      key: z.string().regex(KEY_PATTERN),
      category: z.string().describe('Chave da categoria no server.yaml, ex.: voice-rooms'),
      name: z.string().min(1).max(100).describe('Ex.: "➕ Raid"'),
      nameTemplate: z.string().includes('{n}').describe('Ex.: "Raid {n}"'),
      userLimit: z.number().int().min(0).max(99),
    },
    async (generator) =>
      s
        .runAction({
          actor,
          action: 'voice.generator.upsert',
          target: generator.key,
          params: generator,
          preview: generator.key,
          execute: async () => {
            s.config.upsertVoiceGenerator(generator);
            return `Gerador \`${generator.key}\` salvo no server.yaml. Rode apply_server_config para criá-lo no Discord.`;
          },
        })
        .catch(configFailure),
  );
  tool(
    'delete_voice_generator',
    'Remove um gerador do server.yaml (destrutivo). Depois rode apply_server_config com prune.',
    { key: z.string(), confirm },
    async (args) =>
      s
        .runAction({
          actor,
          action: 'voice.generator.delete',
          target: args.key,
          confirm: args.confirm === true,
          preview: `Remover o gerador ${args.key} do server.yaml. O canal só some do Discord ao rodar apply_server_config com prune: true.`,
          execute: async () => {
            s.config.deleteVoiceGenerator(args.key);
            return `Gerador \`${args.key}\` removido do server.yaml.`;
          },
        })
        .catch(configFailure),
  );
}
