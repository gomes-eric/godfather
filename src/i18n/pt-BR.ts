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
      actor: '👤 Quem',
      source: '🛠️ Via',
      target: '🎯 Alvo',
      result: '📌 Resultado',
      params: '📝 Detalhes',
    },
    /** Title of each action in #audit-log; unknown actions fall back to their key. */
    actions: {
      'member.ban': '🔨 Banimento',
      'member.unban': '🕊️ Banimento removido',
      'member.kick': '👢 Expulsão',
      'member.timeout': '🔇 Timeout',
      'member.promote': '⬆️ Promoção',
      'member.demote': '⬇️ Rebaixamento',
      'member.partner': '🤝 Parceiro',
      'channel.create': '➕ Canal criado',
      'channel.edit': '✏️ Canal editado',
      'channel.delete': '🗑️ Canal apagado',
      'role.create': '➕ Cargo criado',
      'role.edit': '✏️ Cargo editado',
      'role.delete': '🗑️ Cargo apagado',
      'role.assign': '🏷️ Cargo atribuído/removido',
      'message.send': '📨 Mensagem enviada pelo bot',
      'message.edit': '✏️ Mensagem editada',
      'message.delete': '🗑️ Mensagem apagada',
      'message.purge': '🧹 Limpeza de mensagens',
      'event.create': '📅 Evento criado',
      'event.edit': '✏️ Evento editado',
      'event.cancel': '🚫 Evento cancelado',
      'event.template.edit': '🔁 Evento recorrente editado',
      'boss.override': '💀 Respawn de boss ajustado',
      'voice.own.manage': '🔊 Sala de voz ajustada pelo dono',
      'voice.temp.manage': '🔊 Sala de voz moderada',
      'voice.generator.upsert': '➕ Gerador de voz salvo',
      'voice.generator.delete': '🗑️ Gerador de voz removido',
      'setup.apply': '🛠️ /setup aplicado',
      'config.reload': '🔄 server.yaml recarregado',
      'mcp.token.create': '🔑 Token MCP criado',
      'mcp.token.revoke.own': '🗑️ Token MCP revogado',
      'mcp.token.revoke.any': '🗑️ Token MCP revogado',
    } as Record<string, string>,
    /** Friendly names for common action parameters. */
    params: {
      reason: 'Motivo',
      minutes: 'Minutos',
      from: 'De',
      to: 'Para',
      userId: 'Membro',
      authorId: 'Autor',
      channelId: 'Canal',
      roleId: 'Cargo',
      owner: 'Dono',
      count: 'Quantidade',
      ops: 'Alterações',
      warnings: 'Avisos',
      prune: 'Remover sobras',
      title: 'Título',
      when: 'Quando',
      startsAt: 'Início',
      respawnAt: 'Respawn',
      description: 'Descrição',
      name: 'Nome',
      text: 'Texto',
      boss: 'Boss',
      how: 'Como',
      deleteMessageSeconds: 'Apagar mensagens (s)',
      occurrenceId: 'Evento',
      assign: 'Atribuir',
      key: 'Chave',
      time: 'Horário',
      days: 'Dias',
      enabled: 'Ativo',
    } as Record<string, string>,
    yes: 'sim',
    no: 'não',
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
    rolePickerTitle: '🎭 Escolha sua classe',
    rolePickerIntro: (multipleClasses: boolean) =>
      multipleClasses
        ? 'Marque as classes que você joga no Aion 2: elas aparecem no seu perfil e ajudam os Oficiais a montar grupos. 🎮\n-# Clique de novo para remover.'
        : 'Marque sua **classe principal** no Aion 2: ela aparece no seu perfil e ajuda os Oficiais a montar grupos. 🎮\n-# Escolher outra troca a anterior · clicar de novo remove.',
    archetypes: {
      warrior: '🔵 **Guerreiros**',
      scout: '🟢 **Batedores**',
      mage: '🟣 **Magos**',
      priest: '🟡 **Sacerdotes**',
    } as Record<string, string>,
    rolePickerFooter: 'Os botões abaixo seguem a mesma ordem.',
  },

  classes: {
    added: (name: string) => `✅ Agora você é **${name}**.`,
    removed: (name: string) => `➖ Classe **${name}** removida.`,
    switched: (name: string, previous: string[]) =>
      `🔄 Agora você é **${name}** (antes: ${previous.join(', ')}).`,
    unknown: 'Essa classe não existe mais. Peça a um Oficial para rodar /setup.',
  },

  members: {
    refusals: {
      targetIsBot: 'Não dá para fazer isso com um bot.',
      targetIsOwner: 'Ninguém pode fazer isso com o dono do servidor.',
      targetIsSelf: 'Você não pode fazer isso consigo mesmo.',
      alreadyTop: 'Essa pessoa já está no cargo mais alto possível.',
      alreadyBottom: 'Essa pessoa já é Visitante.',
      notHigher: 'O cargo escolhido não é acima do atual. Use /member demote.',
      notLower: 'O cargo escolhido não é abaixo do atual. Use /member promote.',
      cannotManageTier: 'Você só pode mover pessoas para cargos abaixo do seu.',
      officerLimit: 'O limite de Oficiais já foi atingido (o mesmo do jogo).',
      targetTooHigh: 'Você só pode moderar quem está abaixo do seu cargo.',
      alreadyPartner: 'Essa pessoa já é Parceiro.',
      notPartner: 'Essa pessoa não é Parceiro.',
      inLegion:
        'Essa pessoa já é da legião. Parceiro é para quem não joga; rebaixe para Visitante antes, se for o caso.',
    } as Record<string, string>,
    noPartnerRole: 'O cargo de Parceiro não está configurado (settings.partnerRole). Rode /setup.',
    partnered: (name: string) =>
      `🤝 **${name}** agora é **Parceiro**: pode conversar e usar a voz com a legião.`,
    unpartnered: (name: string) => `↩️ **${name}** deixou de ser Parceiro e voltou a Visitante.`,
    notMember: 'Essa pessoa não está no servidor.',
    missingRole: (tier: string) => `O cargo **${tier}** ainda não existe. Rode /setup.`,
    botCannot:
      'O Discord não me deixa agir sobre essa pessoa: o cargo mais alto dela está acima do meu.',
    promotePreview: (name: string, from: string, to: string) =>
      `Promover **${name}** de ${from} para **${to}**.`,
    demotePreview: (name: string, from: string, to: string) =>
      `Rebaixar **${name}** de ${from} para **${to}**.`,
    promoted: (name: string, to: string) => `⬆️ **${name}** agora é **${to}**.`,
    demoted: (name: string, to: string) => `⬇️ **${name}** agora é **${to}**.`,
    info: {
      title: (name: string) => `👤 ${name}`,
      tier: 'Cargo na legião',
      classes: 'Classes',
      joined: 'Entrou no servidor',
      created: 'Conta criada',
      timedOut: 'Em timeout até',
      none: '—',
    },
  },

  moderation: {
    kickPreview: (name: string, reason: string) =>
      `Expulsar **${name}** do servidor. Motivo: ${reason}`,
    kicked: (name: string) => `👢 **${name}** foi expulso.`,
    banPreview: (name: string, reason: string, deleteHours: number) =>
      `Banir **${name}**. Motivo: ${reason}. ${
        deleteHours === 0
          ? 'O histórico de mensagens não será apagado.'
          : `Mensagens das últimas ${deleteHours}h serão apagadas.`
      }`,
    banned: (name: string) => `🔨 **${name}** foi banido.`,
    unbanned: (name: string) => `🕊️ **${name}** foi desbanido.`,
    notBanned: 'Essa pessoa não está banida.',
    timedOut: (name: string, minutes: number) =>
      `🔇 **${name}** está em timeout por ${minutes} min.`,
    timeoutRemoved: (name: string) => `🔊 Timeout de **${name}** removido.`,
    purgePreview: (count: number, channel: string, user?: string) =>
      `Apagar as últimas ${count} mensagens${user ? ` de **${user}**` : ''} em **#${channel}**. Mensagens com mais de 14 dias não podem ser apagadas em massa.`,
    purged: (count: number, channel: string) =>
      `🧹 ${count} mensagens apagadas em **#${channel}**.`,
    noReason: 'sem motivo informado',
    notText: 'Esse canal não aceita mensagens.',
  },

  welcome: {
    ping: (id: string) => `👋 <@${id}>`,
    footer: (count: number) => `Você é o membro nº ${count} · M4F1A`,
  },
  voice: {
    notInRoom: 'Entre numa sala temporária (criada por um ➕) para usar este comando.',
    notOwner:
      'Só o dono da sala (ou um Oficial) pode fazer isso. Se o dono saiu, clique em **Assumir** no painel da sala.',
    ownerPresent: 'O dono ainda está na sala. Só um Oficial pode tomar a posse.',
    alreadyOwner: 'Você já é o dono desta sala.',
    cannotKickSelf: 'Você não pode expulsar a si mesmo.',
    notInThisRoom: 'Essa pessoa não está nesta sala.',
    renamed: (name: string) => `✏️ Sala renomeada para **${name}**.`,
    limited: (limit: number) =>
      limit === 0 ? '♾️ Sala sem limite de pessoas.' : `👥 Limite da sala: **${limit}** pessoas.`,
    locked: '🔒 Sala trancada: ninguém novo entra. Quem já está nela pode sair e voltar.',
    unlocked: '🔓 Sala aberta de novo.',
    hidden: '🙈 Sala oculta: só quem já está nela consegue vê-la.',
    unhidden: '👁️ Sala visível de novo.',
    kicked: (name: string) => `👢 **${name}** foi removido da sala e não pode voltar.`,
    claimed: '👑 Agora você é o dono desta sala.',
    renameLimited: (at: Date) =>
      `⏳ O Discord só deixa renomear uma sala 2 vezes a cada 10 minutos. Tente de novo <t:${Math.ceil(at.getTime() / 1000)}:R>.`,
    renameQueued: (name: string) =>
      `⏳ O Discord está segurando a renomeação; a sala vira **${name}** sozinha assim que ele liberar.`,
    nameInvalid: 'O nome precisa ter entre 1 e 100 caracteres.',
    limitInvalid: 'O limite precisa ser um número de 0 a 99 (0 = sem limite).',
    nobodyToKick: 'Não há mais ninguém na sala para expulsar.',
    kickPrompt: 'Quem você quer remover da sala? A pessoa não consegue voltar.',
    panel: {
      title: '🎛️ Controles da sala',
      owner: (id: string) => `👑 Dono: <@${id}>`,
      open: '🔓 Aberta',
      lockedState: '🔒 Trancada',
      visible: '👁️ Visível',
      hiddenState: '🙈 Oculta',
      limit: (limit: number) => (limit === 0 ? '👥 Sem limite' : `👥 Até ${limit} pessoas`),
      help: 'Só o dono (ou um Oficial) usa os botões. Se o dono sair, quem estiver na sala pode clicar em **Assumir**.',
      lock: 'Trancar',
      unlock: 'Abrir',
      hide: 'Ocultar',
      unhide: 'Mostrar',
      setLimit: 'Limite',
      rename: 'Renomear',
      kick: 'Expulsar',
      claim: 'Assumir',
      renameTitle: 'Renomear a sala',
      renameLabel: 'Novo nome',
      limitTitle: 'Limite de pessoas',
      limitLabel: 'Quantas pessoas cabem (0 = sem limite)',
      kickPlaceholder: 'Escolha quem sai',
    },
  },

  events: {
    card: {
      soon: (minutes: number, unix: number) =>
        `⏳ Começa **em ${minutes} minutos** · <t:${unix}:R>`,
      now: '🔔 **Começou agora!** Bora pra call.',
      time: '🕘 Horário',
      timeValue: (clock: string) => `**${clock}** · Brasília`,
      room: '📍 Sala',
      attendance: '🙋 Presença',
      attendanceValue: (yes: number, maybe: number, no: number) =>
        `✅ **${yes}** vão · ❔ **${maybe}** talvez · ❌ **${no}** não vão`,
      footer: (id: number) => `M4F1A · evento #${id}`,
    },
    agenda: {
      title: '📅 Agenda da Legião',
      subtitle: 'Próximos 7 dias · horários de Brasília',
      today: 'Hoje',
      tomorrow: 'Amanhã',
      weekdays: {
        sun: 'Domingo',
        mon: 'Segunda-feira',
        tue: 'Terça-feira',
        wed: 'Quarta-feira',
        thu: 'Quinta-feira',
        fri: 'Sexta-feira',
        sat: 'Sábado',
      } as Record<string, string>,
      footer: 'Atualizada automaticamente · números para /event cancel e /event rsvps',
    },
    buttons: { yes: 'Vou', maybe: 'Talvez', no: 'Não vou' },
    statusName: { yes: 'Vou', maybe: 'Talvez', no: 'Não vou' } as Record<string, string>,
    voted: (status: string, title: string) => `Presença registrada em **${title}**: **${status}**.`,
    gone: 'Esse evento não existe mais.',
    agendaEmpty:
      '😴 Nenhum evento nos próximos 7 dias. Oficiais criam eventos com `/event create`.',
    badWhen: 'Não entendi a data. Exemplos: `30/10 21:00`, `sáb 21h`, `amanhã 20:30`, `hoje 21h`.',
    inPast: 'Essa data já passou.',
    created: (id: number, title: string, unix: number) =>
      `📅 Evento **#${id} ${title}** criado para <t:${unix}:F> (<t:${unix}:R>). Os avisos saem automaticamente.`,
    edited: (id: number) => `✏️ Evento **#${id}** atualizado.`,
    cancelPreview: (id: number, title: string, unix: number) =>
      `Cancelar **#${id} ${title}** de <t:${unix}:F>. Os avisos que ainda não saíram não serão enviados.`,
    cancelled: (id: number) => `🚫 Evento **#${id}** cancelado.`,
    notFound: (id: number) => `Não achei o evento **#${id}**. Veja os números em /event list.`,
    alreadyCancelled: 'Esse evento já foi cancelado.',
    templateOnlyEdit:
      'Esse é um evento recorrente do server.yaml. Edite o template com `/event template edit`, ou cancele só esta data com `/event cancel`.',
    listTitle: '📅 Próximos 7 dias',
    listLine: (id: number, emoji: string, title: string, unix: number, recurring: boolean) =>
      `\`#${id}\` <t:${unix}:f> ${emoji} ${title}${recurring ? ' 🔁' : ''}`,
    rsvpsTitle: (title: string) => `📋 Presença: ${title}`,
    nobody: 'ninguém',
    templateListTitle: '🔁 Eventos recorrentes (server.yaml)',
    templateLine: (
      key: string,
      emoji: string,
      title: string,
      days: string,
      time: string,
      enabled: boolean,
    ) => `${enabled ? '🟢' : '⚪'} \`${key}\` ${emoji} **${title}** — ${days} às ${time}`,
    templateUpdated: (key: string) =>
      `🔁 Template \`${key}\` atualizado no server.yaml. A agenda e os avisos se ajustam em até 30 segundos.`,
    templateUnknown: (key: string) => `Não existe template \`${key}\`. Veja /event template list.`,
    templateInvalid: (details: string) =>
      `❌ A mudança deixaria o server.yaml inválido:\n${details}`,
    weekdays: {
      sun: 'dom',
      mon: 'seg',
      tue: 'ter',
      wed: 'qua',
      thu: 'qui',
      fri: 'sex',
      sat: 'sáb',
      daily: 'todo dia',
    } as Record<string, string>,
  },

  bosses: {
    unknown: (input: string) => `Não conheço o boss "${input}". Veja /boss list.`,
    badTime:
      'Não entendi o horário. Exemplos: `09:16` (relógio do mapa) ou `5h44m` (tempo restante).',
    noRespawn: (name: string) =>
      `Ainda não sei o tempo de respawn de **${name}**. Use \`/boss set\` com o horário que aparece no mapa (M).`,
    set: (name: string, unix: number) =>
      `💀 **${name}** nasce <t:${unix}:t> (<t:${unix}:R>). Os avisos saem automaticamente.`,
    cleared: (name: string) =>
      `↩️ Correção manual de **${name}** removida. O horário volta a vir do questlog.gg.`,
    nothingToClear: (name: string) => `**${name}** não tem correção manual.`,
    listTitle: '💀 Bosses de campo',
    alive: '🟢 vivo',
    unknownStatus: '❔ sem informação',
    respawn: (unix: number) => `nasce <t:${unix}:t> (<t:${unix}:R>)`,
    sourceQuestlog: (unix: number) => `questlog.gg · leitura <t:${unix}:R>`,
    sourceManual: (userId: string) => `definido por <@${userId}>`,
    feedOff: '-# Leitura automática do questlog.gg desligada (server.yaml). Use /boss set.',
    reminderSource: (source: string) => `Fonte: ${source}`,
    region: (region: string) => `📍 ${region}`,
    warnings: {
      down: '⚠️ O questlog.gg não responde há mais de 15 minutos. Os timers dos bosses podem estar desatualizados — use `/boss set`.',
      format:
        '⚠️ O formato da resposta do questlog.gg mudou e não consigo ler os timers. Use `/boss set` até alguém atualizar o bot.',
      stale:
        '⚠️ Ninguém atualiza os timers no questlog.gg há horas (ninguém abriu o mapa com o app deles). Confira e use `/boss set` se precisar.',
    },
  },

  music: {
    notice: (channelId: string, prefixes: readonly string[]) => {
      const examples = [...prefixes.map((p) => `\`${p}play\``), '`/play`'].join(', ');
      return `🎵 Em <#${channelId}> só vale comando de música (${examples}...). Sua mensagem foi apagada para o canal ficar limpo.`;
    },
  },

  resolve: {
    none: (what: string, input: string) => `Não achei ${what} "${input}".`,
    ambiguous: (what: string, input: string, options: string[]) =>
      `"${input}" pode ser mais de ${what}: ${options.join(', ')}. Seja mais específico ou use o ID.`,
    what: { member: 'um membro', channel: 'um canal', role: 'um cargo', category: 'uma categoria' },
  },

  channels: {
    created: (name: string, id: string) => `➕ Canal <#${id}> (**${name}**) criado.`,
    edited: (id: string) => `✏️ Canal <#${id}> atualizado.`,
    deletePreview: (name: string, managed: boolean) =>
      `Apagar o canal **${name}** e todo o seu histórico.${
        managed ? ' ⚠️ Ele está no server.yaml: o próximo /setup vai recriá-lo vazio.' : ''
      }`,
    deleted: (name: string) => `🗑️ Canal **${name}** apagado.`,
    notCategory: 'Isso não é uma categoria.',
  },

  roles: {
    created: (name: string) => `➕ Cargo **${name}** criado.`,
    edited: (name: string) => `✏️ Cargo **${name}** atualizado.`,
    deletePreview: (name: string, members: number) =>
      `Apagar o cargo **${name}** (${members} ${members === 1 ? 'pessoa tem' : 'pessoas têm'} esse cargo).`,
    deleted: (name: string) => `🗑️ Cargo **${name}** apagado.`,
    assigned: (role: string, member: string) => `✅ **${member}** agora tem o cargo **${role}**.`,
    removed: (role: string, member: string) => `➖ Cargo **${role}** removido de **${member}**.`,
    aboveBot: 'Esse cargo está acima do Padrinho, então não posso alterá-lo.',
    tierRole:
      'Esse é um cargo da hierarquia da legião. Use `promote_member` / `demote_member` (ou /member) para mudar o nível de alguém.',
    integration: 'Esse cargo pertence a um bot e não pode ser alterado.',
  },

  mcp: {
    created: (name: string, token: string, url: string) =>
      [
        `🔑 Token **${name}** criado. Copie agora — ele não será mostrado de novo:`,
        `\`\`\`\n${token}\n\`\`\``,
        `Endpoint: \`${url}\``,
        'Claude Code:',
        `\`\`\`\nclaude mcp add --transport http padrinho ${url} --header "Authorization: Bearer ${token}"\n\`\`\``,
        '-# Quem tiver este token age como você no servidor. Não compartilhe. Revogue com `/mcp token revoke`.',
      ].join('\n'),
    listTitle: '🔑 Seus tokens MCP',
    listLine: (id: number, name: string, created: number, used: number | null) =>
      `\`#${id}\` **${name}** — criado <t:${created}:d>${used ? ` · último uso <t:${used}:R>` : ' · nunca usado'}`,
    none: 'Você não tem tokens ativos.',
    revoked: (name: string) => `🗑️ Token **${name}** revogado.`,
    tokenNotFound: (id: number) => `Não achei o token **#${id}** (ou ele já foi revogado).`,
  },

  say: {
    sent: (channel: string) => `📨 Mensagem enviada em **#${channel}**.`,
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
