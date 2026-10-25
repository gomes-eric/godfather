import type { AuditResult } from '../core/audit.js';
import type { Tier } from '../core/tiers.js';

// Every string shown to users in Discord lives here (PLAN.md §4).

const tierNames: Record<Tier, string> = {
  commander: 'Comandante',
  officer: 'Oficial',
  soldier: 'Soldado',
  visitor: 'Visitante',
};

const auditResults: Record<AuditResult, string> = {
  ok: '✅ Executado',
  denied: '⛔ Negado',
  error: '❌ Erro',
  confirmation_required: '⏳ Aguardando confirmação',
};

export const ptBR = {
  tier: (tier: Tier) => tierNames[tier],

  errors: {
    denied: (requiredTier: Tier) =>
      `⛔ Você não tem permissão para isso. É preciso ser **${tierNames[requiredTier]}** ou superior.`,
    unexpected: '❌ Algo deu errado ao executar o comando. O erro foi registrado.',
    wrongGuild: 'Este bot só funciona no servidor da M4F1A.',
  },

  confirmation: {
    prompt: (preview: string) => `⚠️ **Confirme a ação**\n${preview}\n\n-# Expira em 60 segundos.`,
    confirmButton: 'Confirmar',
    cancelButton: 'Cancelar',
    cancelled: '✖️ Ação cancelada.',
    expired: '⌛ Esta confirmação expirou ou não é sua. Rode o comando de novo.',
  },

  audit: {
    result: (result: AuditResult) => auditResults[result],
    fields: {
      actor: 'Quem',
      source: 'Origem',
      target: 'Alvo',
      result: 'Resultado',
      params: 'Parâmetros',
    },
    source: (source: string, harness?: string) =>
      source === 'mcp'
        ? `IA via MCP${harness ? ` (${harness})` : ''}`
        : source === 'slash'
          ? 'Comando no Discord'
          : 'Sistema',
    listTitle: '📜 Auditoria recente',
    empty: 'Nenhuma ação registrada ainda.',
  },

  panels: {
    rolePickerTitle: '⚔️ Escolha sua classe',
    rolePickerDescription: (multipleClasses: boolean) =>
      multipleClasses
        ? 'Clique nas classes que você joga. Clique de novo para remover.'
        : 'Clique na sua classe principal. Escolher outra troca a anterior; clicar de novo remove.',
  },

  classes: {
    added: (name: string) => `✅ Agora você é **${name}**.`,
    removed: (name: string) => `➖ Classe **${name}** removida.`,
    switched: (name: string, previous: string[]) =>
      `🔄 Agora você é **${name}** (antes: ${previous.join(', ')}).`,
    unknown: 'Essa classe não existe mais. Peça a um Oficial para rodar /setup.',
  },

  config: {
    reloaded: (roles: number, channels: number) =>
      `🔄 server.yaml recarregado: ${roles} cargos e ${channels} canais. Rode \`/setup dry-run:true\` para ver o que mudaria no servidor.`,
    invalid: (details: string) =>
      `❌ O server.yaml tem erros e não foi carregado. A configuração anterior continua valendo.\n\`\`\`\n${details.slice(0, 1800)}\n\`\`\``,
  },

  setup: {
    previewTitle: '🧪 Prévia do /setup (nada foi alterado)',
    planTitle: '🛠️ O /setup vai fazer isto',
    resultTitle: '🛠️ Resultado do /setup',
    upToDate: '✅ O servidor já está igual ao server.yaml. Nada a fazer.',
    more: (count: number) => `…e mais ${count} itens.`,
    counts: (ops: number) => `${ops} ${ops === 1 ? 'alteração' : 'alterações'}`,
    confirmPreview: (summary: string) => `O /setup vai aplicar ${summary} no servidor.`,
    applied: (ok: number, failed: number) =>
      failed === 0
        ? `✅ ${ok} ${ok === 1 ? 'alteração aplicada' : 'alterações aplicadas'}.`
        : `⚠️ ${ok} aplicadas, **${failed} falharam**. Corrija e rode /setup de novo.`,
    failure: (description: string, error: string) => `❌ ${description}: ${error}`,
    changes: {
      name: 'nome',
      color: 'cor',
      hoist: 'exibir separado',
      mentionable: 'mencionável',
      permissions: 'permissões',
      overwrites: 'acessos',
      parent: 'categoria',
      topic: 'tópico',
      userLimit: 'limite',
      tags: 'tags',
      requireTag: 'tag obrigatória',
    } as Record<string, string>,
    ops: {
      adopt: (kind: string, name: string) => `🔗 Assumir ${kind} existente **${name}**`,
      createRole: (name: string) => `➕ Criar cargo **${name}**`,
      updateRole: (name: string, changes: string) => `✏️ Atualizar cargo **${name}** (${changes})`,
      reorderRoles: '🔀 Reordenar cargos',
      createCategory: (name: string) => `➕ Criar categoria **${name}**`,
      updateCategory: (name: string, changes: string) =>
        `✏️ Atualizar categoria **${name}** (${changes})`,
      createChannel: (name: string) => `➕ Criar canal **${name}**`,
      updateChannel: (name: string, changes: string) =>
        `✏️ Atualizar canal **${name}** (${changes})`,
      enableCommunity: '🏛️ Ativar o recurso Comunidade (necessário para Fórum e Anúncios)',
      setCommunityChannels: '🏛️ Definir canais de regras e de atualizações da Comunidade',
      reorderChannels: '🔀 Reordenar categorias e canais',
      setAfk: (name: string, minutes: number) => `🌙 Canal AFK: **${name}** após ${minutes} min`,
      upsertPanel: (name: string) => `📌 Publicar/atualizar mensagem fixa em **#${name}**`,
      deleteChannel: (name: string) => `🗑️ Apagar canal **${name}**`,
      deleteCategory: (name: string) => `🗑️ Apagar categoria **${name}**`,
      deleteRole: (name: string) => `🗑️ Apagar cargo **${name}**`,
      forgetMessage: (key: string) => `🗑️ Esquecer mensagem fixa \`${key}\``,
    },
    kinds: { role: 'cargo', category: 'categoria', channel: 'canal' } as Record<string, string>,
    warnings: {
      roleAboveBot: (name: string, changes: string) =>
        `ℹ️ O cargo **${name}** fica acima do Padrinho, então não posso alterá-lo. Ele está diferente do server.yaml em: ${changes}. Ajuste à mão em **Configurações do Servidor → Cargos** se quiser que fique igual.`,
      channelKindMismatch: (name: string, expected: string, actual: string) =>
        `⚠️ O canal **${name}** é do tipo \`${actual}\`, mas o server.yaml pede \`${expected}\`. O Discord não converte esse tipo; apague o canal ou mude o yaml.`,
    },
    communityManual:
      'Não consegui ativar a Comunidade pela API. Ative em **Configurações do Servidor → Habilitar Comunidade** (regras: #regras, atualizações: #oficiais) e rode /setup de novo.',
  },
} as const;
