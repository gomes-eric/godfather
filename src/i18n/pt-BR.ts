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
} as const;
