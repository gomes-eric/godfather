import { z } from 'zod';
import { ptBR } from '../../i18n/pt-BR.js';
import { formatPlan, formatResult } from '../../setup/format.js';
import { confirm, configFailure, type ToolKit } from './kit.js';

export function registerConfigTools({ tool, read, s, actor }: ToolKit): void {
  tool(
    'reload_server_config',
    'Relê o server.yaml do disco sem reiniciar o bot (como /config reload). Um arquivo inválido é recusado e a configuração atual continua.',
    {},
    async () =>
      s
        .runAction({
          actor,
          action: 'config.reload',
          target: 'server.yaml',
          preview: 'config.reload',
          execute: async () => {
            const config = s.config.reload();
            const channels = config.categories.reduce((n, c) => n + c.channels.length, 0);
            return ptBR.config.reloaded(config.roles.length, channels);
          },
        })
        .catch(configFailure),
  );

  tool('get_server_config', 'Conteúdo atual do server.yaml (já validado).', {}, async () =>
    read('setup.plan', async () => s.config.get()),
  );
  tool(
    'plan_server_config',
    'Mostra o que o /setup mudaria no Discord para ficar igual ao server.yaml (não altera nada).',
    { prune: z.boolean().optional() },
    async (args) =>
      read('setup.plan', async () =>
        formatPlan((await s.setup.plan(args.prune === true)).plan, 6000),
      ),
  );
  tool(
    'apply_server_config',
    'Aplica o server.yaml no Discord, como o /setup (destrutivo).',
    { prune: z.boolean().optional(), confirm },
    async (args) => {
      const prune = args.prune === true;
      const planned = await s.setup.plan(prune);
      return s.runAction({
        actor,
        action: 'setup.apply',
        confirm: args.confirm === true,
        target: 'server.yaml',
        params: { prune, ops: planned.plan.ops.length },
        preview: formatPlan(planned.plan, 3000),
        execute: async () => {
          const fresh = await s.setup.plan(prune);
          return formatResult(fresh.plan, await s.setup.apply(fresh), 3000);
        },
      });
    },
  );
}
