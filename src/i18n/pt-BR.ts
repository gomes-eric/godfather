import type { AuditResult } from '../core/audit.js';
import type { MemberRefusal, ModerationRefusal } from '../core/member-rules.js';
import type { Standing, StandingRefusal } from '../core/standing.js';
import type { Tier } from '../core/tiers.js';

const tierNames: Record<Tier, string> = {
  commander: 'Comandante',
  officer: 'Oficial',
  soldier: 'Soldado',
  visitor: 'Visitante',
};

const auditResults: Record<AuditResult, string> = {
  ok: '✅ Executado',
  denied: '⛔ Negado',
  rejected: '🚧 Recusado',
  error: '❌ Erro',
  confirmation_required: '⏳ Aguardando confirmação',
};

export const ptBR = {
  tier: (tier: Tier) => tierNames[tier],
  standing: (standing: Standing, legion?: string) =>
    standing.kind === 'tier'
      ? tierNames[standing.tier]
      : standing.kind === 'ally'
        ? legion
          ? `Aliado (${legion})`
          : 'Aliado'
        : standing.kind === 'partner'
          ? 'Parceiro'
          : standing.kind === 'restricted'
            ? 'Restrito'
            : 'Visitante',

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
    actions: {
      'member.ban': '🔨 Banimento',
      'member.unban': '🕊️ Banimento removido',
      'member.kick': '👢 Expulsão',
      'member.timeout': '🔇 Timeout',
      'member.promote': '⬆️ Promoção',
      'member.demote': '⬇️ Rebaixamento',
      'member.partner': '💬 Parceiro',
      'member.ally': '🤝 Aliado',
      'member.restrict': '🔒 Restrito',
      'alliance.add': '🤝 Aliança criada',
      'alliance.remove': '✂️ Aliança desfeita',
      'recruit.kind': '🔀 Tipo da ficha trocado',
      'member.sync': '🔄 Sincronizado com o jogo',
      'recruit.decide': '🤝 Ficha de recrutamento',
      'member.register': '🎮 Personagem registrado',
      'legion.check': '🔎 Conferência da legião',
      'news.preview': '📰 Prévia dos resumos de notícias',
      'channel.create': '➕ Canal criado',
      'channel.edit': '✏️ Canal editado',
      'channel.delete': '🗑️ Canal apagado',
      'role.create': '➕ Cargo criado',
      'role.edit': '✏️ Cargo editado',
      'role.delete': '🗑️ Cargo apagado',
      'role.assign': '🏷️ Cargo atribuído/removido',
      'message.send': '📨 Mensagem enviada pelo bot',
      'message.purge': '🧹 Limpeza de mensagens',
      'event.create': '📅 Evento criado',
      'event.edit': '✏️ Evento editado',
      'event.cancel': '🚫 Evento cancelado',
      'event.template.edit': '🔁 Evento recorrente editado',
      'voice.temp.manage': '🔊 Sala de voz moderada',
      'voice.generator.upsert': '➕ Gerador de voz salvo',
      'voice.generator.delete': '🗑️ Gerador de voz removido',
      'setup.apply': '🛠️ /setup aplicado',
      'config.reload': '🔄 server.yaml recarregado',
      'mcp.token.create': '🔑 Token MCP criado',
      'mcp.token.revoke.own': '🗑️ Token MCP revogado',
      'mcp.token.revoke.any': '🗑️ Token MCP revogado',
      'server.read': '🗺️ Leitura do servidor',
      'member.read': '👥 Leitura de membros',
      'message.read': '💬 Leitura de mensagens',
    } as Record<string, string>,
    params: {
      reason: 'Motivo',
      refusal: 'Recusa',
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
      description: 'Descrição',
      name: 'Nome',
      text: 'Texto',
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
    recruitmentTitle: (legion: string) => `🎮 Ficha da ${legion}`,
    recruitmentIntro: (legion: string) =>
      [
        'Clique em **Enviar minha ficha**, escolha o tipo e digite o nome do seu personagem no Aion 2.',
        '',
        '### ⚔️ Membro',
        `Para quem já está na ${legion} ou quer entrar.`,
        '-# Já está na legião? Você vira Soldado na hora. Ainda não? Um Oficial avalia a ficha.',
        '',
        '### 🤝 Aliança',
        'Para quem é de uma legião aliada.',
        '-# O Padrinho confere a sua legião no jogo e um Oficial aprova. Se a legião ainda não é aliada, vira um pedido de aliança, que um Comandante avalia.',
        '',
        '### 💬 Parceiro',
        'Para amigos que não jogam.',
        '-# O personagem é opcional, e um Oficial avalia.',
        '',
        '### 📋 Como funciona',
        '🔎 O Padrinho confere o personagem no site oficial: classe, nível, poder e legião.',
        '🔒 A ficha abre uma conversa privada só com você e a liderança, e a resposta chega por lá.',
        '🎉 Aprovado, você ganha o seu cargo, o da sua classe e o apelido com o nome do personagem.',
        '',
        '-# Dúvidas? Pergunte em {channel:visitor-qa}.',
      ].join('\n'),
  },

  recruitment: {
    applyButton: 'Enviar minha ficha',
    modalTitle: 'Ficha de entrada',
    kindLabel: 'Como você quer entrar?',
    kindPlaceholder: 'Escolha: Membro, Aliança ou Parceiro',
    kinds: {
      member: { emoji: '⚔️', label: 'Membro', hint: 'Já está na legião ou quer entrar nela' },
      ally: { emoji: '🤝', label: 'Aliança', hint: 'É de uma legião aliada' },
      partner: { emoji: '💬', label: 'Parceiro', hint: 'Não joga, mas quer ficar com a gente' },
      restricted: { emoji: '🔒', label: 'Restrito', hint: 'Só vê o #geral' },
    },
    nameLabel: 'Nome do personagem',
    namePlaceholder: 'Exatamente como no Aion 2 (ex.: Padrinho)',
    nameHint: 'Obrigatório para Membro e Aliança. O bot confere classe, poder e legião.',
    alreadyMember: 'Você já faz parte da legião aqui no Discord.',
    notFound: (name: string) =>
      `Não achei o personagem **${name}** no Triniel. Confira o nome exatamente como aparece no jogo.`,
    nameRequired: 'Para Membro e Aliança, digite o nome do seu personagem no jogo.',
    noLegionForAlly:
      'Seu personagem não está em uma legião no jogo. Mande a ficha como **Membro** ou **Parceiro**.',
    alreadyPending: 'Sua ficha já foi enviada e está com os Oficiais. Aguarde a resposta.',
    sent: (name: string) =>
      `✅ Ficha de **${name}** enviada! Abri uma conversa privada com a liderança em #recrutamento, e a resposta chega por lá.`,
    autoApproved: (name: string) =>
      `🎉 **${name}** já está na legião no jogo, então você já é **Soldado**! As boas-vindas estão na sua conversa em #recrutamento.`,
    newApplication: (roleId: string) => `<@&${roleId}> nova ficha de recrutamento para analisar:`,
    newReview: (roleId: string) => `<@&${roleId}> a conferência diária pede uma análise:`,
    threadName: (name: string) => `Ficha · ${name}`,
    reviewThreadName: (name: string) => `Análise · ${name}`,
    threadClosedReason: 'Ficha de recrutamento decidida',
    cardTitle: (name: string) => `📝 Ficha · ${name}`,
    reviewTitle: (name: string) => `🔎 Análise · ${name}`,
    applicantField: '👤 Candidato',
    kindField: '📌 Tipo',
    statusField: '📋 Situação',
    fromCheck: (previous: string) =>
      `> 🚪 **Saiu da legião no jogo**\n> A conferência diária mudou o cargo (era **${previous}**).`,
    pickedLine: (kind: string) => `-# escolheu ${kind}`,
    newAllianceWarning: (legion: string) =>
      `> 🆕 **Pedido de aliança nova**\n> A **${legion}** ainda não é aliada. Só um Comandante aprova, e aprovar cria a aliança.`,
    duplicateWarning: (owner: string) =>
      `> ⚠️ **Personagem já cadastrado** para <@${owner}>\n> Aprovar passa o personagem para esta pessoa, e a outra conta vira Restrito.`,
    pending: '⏳ Aguardando',
    approvedBy: (id: string) => `✅ Aprovada\n-# por <@${id}>`,
    rejectedBy: (id: string) => `✖️ Recusada\n-# por <@${id}>`,
    classField: '🎮 Classe',
    level: (level: number) => `Nv ${level}`,
    powerField: '📊 Poder',
    legionField: '🏰 Legião atual',
    noLegion: 'Sem legião',
    characterField: '🎮 Personagem',
    noCharacter: 'Não informou',
    footer: (id: number) => `Ficha #${id} · Mudar troca o tipo antes de aprovar`,
    reviewFooter: (id: number) =>
      `Análise #${id} · Aprovar mantém o que o bot fez · Recusar devolve o cargo anterior`,
    approve: 'Aprovar',
    reject: 'Recusar',
    change: 'Mudar',
    changePlaceholder: 'Escolha o tipo que aprovar vai dar',
    changePrompt: 'Que tipo esta ficha deve ter? Depois é só clicar em **Aprovar** no card.',
    allyNoLegionOption: 'Aliança (o personagem não está em legião)',
    changed: (kind: string) => `🔀 Tipo da ficha trocado para **${kind}**.`,
    noCharacterForKind:
      'Essa ficha não tem personagem. Membro e Aliança precisam de um; peça uma ficha nova.',
    noLegionForKind:
      'O personagem desta ficha não está em uma legião, então não dá para ser Aliança.',
    restrictedOnlyReviews: 'Restrito só vale para as análises da conferência diária.',
    newAllianceNeedsCommander: (legion: string) =>
      `A **${legion}** ainda não é uma aliança. Só um Comandante aprova um pedido de aliança nova (e aprovar cria a aliança).`,
    gone: 'Essa ficha não existe mais.',
    beingDecided: 'Outra pessoa está decidindo essa ficha agora. Espere um instante.',
    alreadyDecided: 'Essa ficha já foi decidida.',
    leftServer: 'Essa pessoa saiu do servidor.',
    approvedReason: 'Ficha de recrutamento aprovada',
    autoApprovedNotice: (userId: string, character: string, legion: string) =>
      `🤖 <@${userId}> entrou sozinho como **${character}**: o personagem já está na **${legion}** no jogo. Se não for a pessoa certa, use /member restrict.`,
    autoApprovalFailed: (userId: string, character: string) =>
      `⚠️ <@${userId}> mandou a ficha de **${character}**, que já está na legião, mas não consegui aprovar sozinho (falta algum cargo?). A ficha está em #recrutamento esperando um Oficial.`,
    duplicateNotice: (userId: string, character: string, owner: string) =>
      `⚠️ <@${userId}> mandou uma ficha com **${character}**, que já está cadastrado para <@${owner}>. A ficha espera a análise de um Oficial.`,
    welcome: (id: string, legion: string, nickname: string | null, inLegion: boolean) => {
      const rest = `Agora você é **Soldado** aqui${nickname ? ` e seu apelido virou **${nickname}**` : ''}.`;
      return inLegion
        ? `🎉 <@${id}>, sua ficha foi aprovada! Você já é da **${legion}** no jogo. ${rest}`
        : [
            `🎉 <@${id}>, sua entrada na **${legion}** foi aprovada! ${rest}`,
            `🎮 Falta só aceitar o convite da **${legion}** no jogo: um Oficial vai te convidar.`,
          ].join('\n');
    },
    welcomeAlly: (id: string, legion: string, chatId: string | null) =>
      [
        `🤝 <@${id}>, bem-vindo(a), aliado(a) da **${legion}**! Você vê os mesmos canais de um Soldado.`,
        ...(chatId ? [`💬 O chat da aliança é o <#${chatId}>.`] : []),
      ].join('\n'),
    welcomePartner: (id: string) =>
      `💬 <@${id}>, bem-vindo(a)! Agora você é **Parceiro**: pode conversar e usar a voz com a gente.`,
  },

  registration: {
    transferReason: (character: string) => `o personagem ${character} passou para outra conta`,
    transferred: (character: string, oldOwner: string, newOwner: string) =>
      `🔁 O personagem **${character}** passou de <@${oldOwner}> para <@${newOwner}>. A conta antiga perdeu o personagem e virou Restrito.`,
    takenAttempt: (character: string, owner: string, userId: string, by: string) =>
      `⚠️ <@${by}> tentou registrar **${character}** para <@${userId}>, mas ele já está cadastrado para <@${owner}>.`,
    takenNeedsConfirm: (character: string, owner: string) =>
      `**${character}** já está cadastrado para <@${owner}>. Para passar o personagem para esta pessoa (a outra conta vira Restrito), repita com confirm=true.`,
    noClassRole: (className: string) =>
      `A classe **${className}** não tem um cargo no server.yaml, então não sei qual cargo dar.`,
    reason: (officer: string) => `Registro feito por ${officer}`,
    preview: (member: string, character: string) =>
      `Registrar **${character}** para ${member} (classe, apelido e Soldado se for Visitante).`,
    done: (member: string, character: string, nickname: string | null, promoted: boolean) =>
      [
        `✅ **${character}** registrado para ${member}.`,
        nickname
          ? `Apelido: **${nickname}**.`
          : 'O apelido não foi trocado (dono do servidor ou cargo acima do bot).',
        ...(promoted ? ['Agora é **Soldado**.'] : []),
      ].join(' '),
  },

  party: {
    stateEmoji: { open: '🎯', full: '✅', closed: '🔒' },
    state: {
      open: '🟢 Vagas abertas: clique em **Entrar**.',
      full: '✅ **Grupo completo!**',
      closed: '🔒 Grupo fechado.',
    },
    when: (startsAt: string) => `🕘 **${startsAt}**`,
    leader: (id: string) => `👑 Líder: <@${id}>`,
    slots: (taken: number, total: number) => `👥 Vagas · ${taken}/${total}`,
    freeSlot: '— vaga livre',
    footer: (id: number) => `Grupo #${id} · o líder ou um Oficial fecha o grupo`,
    footerClosed: 'Grupo encerrado',
    join: 'Entrar',
    leave: 'Sair',
    close: 'Fechar',
    filled: (activity: string, ids: string[]) =>
      `✅ **${activity}**: grupo completo! ${ids.map((id) => `<@${id}>`).join(' ')}`,
    noChannel: 'Não consigo postar o grupo neste canal.',
    gone: 'Esse grupo não existe mais.',
    alreadyClosed: 'Esse grupo já foi fechado.',
    alreadyIn: 'Você já está nesse grupo.',
    full: 'O grupo já está completo.',
    notIn: 'Você não está nesse grupo.',
    ownerCantLeave: 'Você é o líder: use **Fechar** para encerrar o grupo.',
  },

  legionCheck: {
    reportTitle: '🔎 Conferência diária da legião',
    restrictReason: 'saiu da legião no jogo',
    syncReason: 'Conferência diária da legião',
    renamed: (id: string, from: string, to: string) =>
      `✏️ <@${id}> trocou de nome no jogo: **${from}** → **${to}** (apelido atualizado).`,
    classChanged: (id: string, from: string, to: string) =>
      `🔄 <@${id}> mudou de classe: **${from}** → **${to}** (cargo atualizado).`,
    left: (id: string, name: string, legion: string, now: string) =>
      `🚪 <@${id}> (**${name}**) saiu da **${legion}** no jogo${now ? ` e agora está na **${now}**` : ''}. Use \`/member restrict\` se for o caso.`,
    moved: (id: string, name: string, now: string, from: string, to: string) =>
      `🚪 <@${id}> (**${name}**) saiu da legião no jogo${now ? ` e agora está na **${now}**` : ''}: era ${from}, virou **${to}**. A análise está numa thread aqui.`,
    returned: (id: string, name: string, to: string) =>
      `↩️ <@${id}> (**${name}**) voltou no jogo e virou **${to}** de novo.`,
    leaderLeft: (id: string, name: string, legion: string, now: string, standing: string) =>
      `🚨 <@${id}> (**${name}**, ${standing}) saiu da **${legion}** no jogo${now ? ` e agora está na **${now}**` : ''}. O cargo não muda sozinho; a análise está numa thread aqui.`,
    moveFailed: (id: string, name: string, to: string) =>
      `⚠️ <@${id}> (**${name}**) devia virar **${to}**, mas não consegui mudar o cargo. Confira à mão.`,
    tooManyDepartures: (count: number, max: number) =>
      `🛑 ${count} pessoas pareceram sair da legião de uma vez (o limite é ${max}). Pode ser um problema no site oficial, então ninguém mudou de cargo. Confira no jogo; a próxima conferência vê de novo.`,
    heldBack: (id: string, name: string, now: string) =>
      `⏸️ <@${id}> (**${name}**) aparece ${now ? `na **${now}**` : 'sem legião'}; nada mudou.`,
    joined: (id: string, name: string, legion: string) =>
      `🛡️ <@${id}> (**${name}**) entrou na **${legion}** no jogo.`,
    rankingTitle: (legion: string) => `🏆 Ranking da ${legion}`,
    rankingIntro: 'Top 10 por poder de combate · ⚔️ poder de combate · 🎚️ nível de item',
    rankingEmpty: 'Ninguém registrado ainda. Entra quem teve a ficha de recrutamento aprovada.',
    rankingFooter: 'Atualizado todo dia · membros com ficha de recrutamento aprovada',
    menuPlaceholder: '👤 Escolha um membro para ver o perfil completo',
    menuHint:
      '👇 **Quer ver o perfil completo?** Escolha um membro no menu abaixo: classe, equipamentos e mais. Só você vê a resposta.',
    menuOption: (combatPower: string, itemLevel: string) =>
      `Ver perfil · ⚔️ ${combatPower} · 🎚️ ${itemLevel}`,
    commandBusy:
      '⏳ Uma conferência já está em andamento. O #ranking é atualizado assim que ela terminar.',
    commandDone: (members: number, changes: number) =>
      `🏆 #ranking atualizado: ${members} personagens relidos no site oficial. ${changes > 0 ? `${changes} mudança(s) foram para o relatório no canal dos oficiais.` : 'Nada mudou de classe, nome ou legião.'}`,
  },

  news: {
    author: {
      patch: 'AION 2 · Atualização',
      maintenance: 'AION 2 · Manutenção',
      event: 'AION 2 · Evento',
      restriction: 'AION 2 · Restrições de conta',
      notice: 'AION 2 · Notícia',
    },
    intro: 'Saiu uma notícia nova do jogo.',
    seeDetails: 'Detalhes na Steam.',
    button: 'Ler na Steam',
    footer: 'Publicado na Steam',
    digestFooter: 'Resumo automático · publicado na Steam',
    pingTriniel: 'afeta o Triniel',
    pingClasses: 'mudanças na sua classe',
    previewOff:
      'Os resumos estão desligados: falta `settings.news.summary` no server.yaml ou a federação (ANTHROPIC_*) no .env.',
    previewNoChannel: (key: string) => `Não achei o canal \`${key}\`.`,
    previewHeader: (pings: string[]) =>
      `🔍 Prévia do resumo${pings.length > 0 ? ` · marcaria: ${pings.join(', ')}` : ''}`,
    previewSkipped: (title: string, reason: string) => `⏭️ ${title}: ficaria de fora (${reason})`,
    previewPosted: (title: string) => `✅ ${title}: prévia postada`,
  },

  profile: {
    level: (level: number) => `Nível ${level}`,
    legion: (legion: string) => `🏰 Legião **${legion}**`,
    noLegion: '🏰 Sem legião',
    combatPower: '⚔️ Poder de combate',
    itemLevel: '🎚️ Nível de item',
    weapons: '🗡️ Armas',
    armor: '🛡️ Armaduras',
    accessories: '💍 Acessórios',
    runesArcana: '🔮 Runas e arcanas',
    gear: '🎒 Equipamentos',
    noGear: 'Nenhum item equipado.',
    footer: (server: string) => `${server} · dados do site oficial do Aion 2`,
    apiDown:
      'Não consegui falar com o site oficial do Aion 2 agora. Tente de novo em alguns minutos.',
    notFound: (name: string) => `Não achei o personagem **${name}** no Triniel.`,
    notRegistered:
      'Você ainda não tem um personagem registrado aqui. Passe um nome: /perfil nome:<personagem>.',
    memberNotRegistered: (id: string) =>
      `<@${id}> ainda não tem um personagem registrado aqui. Tente pelo nome.`,
    gearPlaceholder: '🔍 Ver detalhes de um equipamento',
    gearOption: (slot: string) => `Atributos, pedras e origem · ${slot}`,
    gearGone: 'Esse equipamento não está mais no personagem. Use /perfil de novo.',
    pieceLevel: (level: number) => `Nível ${level}`,
    enchant: (level: number, max: number | null) =>
      `Encantamento +${level}${max !== null ? ` de +${max}` : ''}`,
    classes: (names: string[]) => `Classe: ${names.join(', ')}`,
    mainStats: '⚔️ Atributos principais',
    subStats: '✨ Atributos secundários',
    magicStones: '💠 Pedras mágicas',
    godStones: '🌟 Pedra divina',
    sources: (list: string[]) => `Origem: ${list.join(', ')}`,
    trade: '📦 Comércio e origem',
    tradable: 'Negociável',
    notTradable: 'Não negociável',
    itemFooter: (character: string) => `Equipado por ${character} · dados do site oficial`,
    slots: {
      MainHand: 'Arma principal',
      SubHand: 'Arma secundária',
      Helmet: 'Elmo',
      Shoulder: 'Ombreiras',
      Torso: 'Peitoral',
      Pants: 'Calças',
      Gloves: 'Luvas',
      Boots: 'Botas',
      Cape: 'Capa',
      Necklace: 'Colar',
      Earring1: 'Brinco',
      Earring2: 'Brinco',
      Ring1: 'Anel',
      Ring2: 'Anel',
      Bracelet1: 'Bracelete',
      Bracelet2: 'Bracelete',
      Belt: 'Cinto',
      Amulet: 'Amuleto',
      Rune1: 'Runa',
      Rune2: 'Runa',
      Arcana1: 'Arcana',
      Arcana2: 'Arcana',
      Arcana3: 'Arcana',
      Arcana4: 'Arcana',
      Arcana5: 'Arcana',
    } as Record<string, string>,
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
      alreadyAlly: 'Essa pessoa já é Aliado dessa legião.',
      alreadyRestricted: 'Essa pessoa já é Restrito.',
    } satisfies Record<
      | MemberRefusal
      | ModerationRefusal
      | Exclude<StandingRefusal, 'alreadyThere'>
      | 'alreadyPartner'
      | 'notPartner'
      | 'alreadyAlly'
      | 'alreadyRestricted',
      string
    >,
    /** Reason in Discord's audit log for a change made with /member or MCP. */
    officerReason: 'Mudança de cargo feita por um oficial',
    changePreview: (name: string, from: string, to: string) => `**${name}**: ${from} → **${to}**`,
    changed: (name: string, to: string) => `**${name}** agora é **${to}**.`,
    missingStandingRole: (standing: string) =>
      `O cargo de **${standing}** ainda não existe. Rode /setup.`,
    partnerPreview: (name: string, from: string) =>
      `Tornar **${name}** Parceiro (hoje: ${from}). O cargo anterior sai.`,
    allyPreview: (name: string, from: string, legion: string) =>
      `Tornar **${name}** Aliado da **${legion}** (hoje: ${from}). O cargo anterior sai.`,
    allied: (name: string, legion: string) =>
      `🤝 **${name}** agora é **Aliado** da **${legion}**: vê os mesmos canais de um Soldado.`,
    restrictPreview: (name: string, from: string, reason: string) =>
      `Restringir **${name}** (hoje: ${from}): só vai ver o #geral. Motivo: ${reason}`,
    restricted: (name: string) => `🔒 **${name}** agora é **Restrito**: só vê o #geral.`,
    restrictNotice: (officerId: string, userId: string, from: string, reason: string) =>
      `🔒 <@${officerId}> restringiu <@${userId}> (era ${from}). Motivo: ${reason}`,
    noRestrictedRole:
      'O cargo Restrito não está configurado (settings.restrictedRole). Rode /setup.',
    noAllyRole: 'O cargo Aliado não está configurado (settings.allyRole). Rode /setup.',
    unknownAlliance: (legion: string) =>
      `**${legion}** não é uma aliança. Veja as alianças em /alliance list.`,
    noPartnerRole: 'O cargo de Parceiro não está configurado (settings.partnerRole). Rode /setup.',
    partnered: (name: string) =>
      `💬 **${name}** agora é **Parceiro**: pode conversar e usar a voz com a legião.`,
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

  alliances: {
    emptyName: 'Diga o nome da legião aliada.',
    ownLegion: 'Essa é a nossa própria legião.',
    exists: (legion: string) => `A **${legion}** já é uma aliança.`,
    addPreview: (legion: string) =>
      `Criar a aliança com a **${legion}**: um cargo com o nome da legião, acima de Aliado.`,
    added: (legion: string) =>
      `🤝 A **${legion}** agora é uma aliança. Use /member ally para pôr alguém nela, ou aprove as fichas de Aliança.`,
    roleNotCreated: (legion: string) =>
      `Não consegui criar o cargo da **${legion}**, então a aliança não foi criada. Confira se o cargo do bot está acima de Aliado e tente de novo.`,
    removePreview: (legion: string, allies: number) =>
      `Desfazer a aliança com a **${legion}**: ${allies === 1 ? '1 aliado vira' : `${allies} aliados viram`} Restrito e o cargo da legião é apagado.`,
    removedReason: (legion: string) => `a aliança com a ${legion} acabou`,
    removed: (legion: string, restricted: number) =>
      `✂️ A aliança com a **${legion}** acabou. ${restricted === 1 ? '1 aliado virou' : `${restricted} aliados viraram`} Restrito.`,
    listTitle: '🤝 Alianças',
    listEmpty: 'Nenhuma aliança ainda. Um Comandante cria com /alliance add.',
    listLine: (legion: string, members: number) =>
      `**${legion}** · ${members === 1 ? '1 aliado' : `${members} aliados`}`,
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
      rescheduled: (unix: number) =>
        `🕘 **Evento remarcado** para <t:${unix}:F> (<t:${unix}:R>). Um novo aviso sai antes do novo horário.`,
      cancelled: '🚫 **Evento cancelado.**',
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
    statusName: { yes: 'Vou', maybe: 'Talvez', no: 'Não vou' },
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
    shugoProblem: (title: string, problem: string) =>
      `⚠️ Não consegui conferir o horário de **${title}** no shugo.gg (${problem}). O horário do server.yaml continua valendo.`,
    templateUpdated: (key: string) =>
      `🔁 Template \`${key}\` atualizado no server.yaml. A agenda e os avisos se ajustam em até 30 segundos.`,
    templateUnknown: (key: string) => `Não existe template \`${key}\`. Veja /event template list.`,
    templateInvalid: (details: string) =>
      `❌ A mudança deixaria o server.yaml inválido:\n${details}`,
    badTime: (input: string) =>
      `Horário inválido: "${input}". Use \`21:00\`, \`21h\` ou \`9h30\` (horário de Brasília).`,
    badDays: (input: string) =>
      `Dias inválidos: "${input}". Exemplos: \`seg qui sáb\`, \`mon,thu,sat\`, \`todo dia\`.`,
    templateNoChange: 'Nada para mudar: informe o horário, os dias, o título ou se fica ligado.',
    shugoRejected: (title: string, reason: string) =>
      `⚠️ O shugo.gg mudou o horário de **${title}**, mas não consegui gravar no server.yaml: ${reason}`,
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

  music: {
    notice: (userId: string, prefixes: readonly string[]) => {
      const examples = [...prefixes.map((p) => `\`${p}play\``), '`/play`'].join(', ');
      return `<@${userId}> 🎵 aqui só vale comando de música (${examples}...). Sua mensagem foi apagada para o canal ficar limpo.`;
    },
    elsewhere: (userId: string, musicChannelId: string) =>
      `<@${userId}> 🎵 comandos de música só funcionam no <#${musicChannelId}> ou no chat da sua sala de voz. Sua mensagem foi apagada.`,
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
    modalTitle: 'Mensagem do Padrinho',
    titleLabel: 'Título (opcional)',
    titleHint: 'Com título, a mensagem sai como card',
    titlePlaceholder: 'Ex.: Guerra do Abismo hoje',
    textLabel: 'Mensagem',
    textPlaceholder: 'Escreva aqui. Enter quebra a linha.',
  },

  config: {
    reloaded: (roles: number, channels: number) =>
      `🔄 server.yaml recarregado: ${roles} cargos e ${channels} canais. Rode \`/setup dry-run:true\` para ver o que mudaria no servidor.`,
    invalid: (details: string) =>
      `❌ O server.yaml tem erros e não foi carregado. A configuração anterior continua valendo.\n\`\`\`\n${details.slice(0, 1800)}\n\`\`\``,
  },

  setup: {
    previewTitle: '🧪 Prévia do /setup (nada foi alterado)',
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
      setNicknameLock: (locked: boolean) =>
        locked
          ? '🔒 Travar apelidos: só o Padrinho muda o nome de cada um'
          : '🔓 Destravar apelidos: cada um pode mudar o próprio',
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
  help: {
    title: '🎩 O que o Padrinho faz por você',
    intro:
      'Comandos que o **seu cargo** pode usar. Nas salas de voz criadas pelo ➕ Criar, o painel de botões faz o mesmo que `/voice`.',
    footer: (tier: string) => `Mostrando os comandos de: ${tier} · só você vê esta mensagem`,
    sections: [
      {
        title: '🎮 Personagens',
        entries: [
          {
            usage: '/perfil',
            text: 'Poder de combate, nível de item e equipamentos de um personagem',
            tier: 'visitor',
          },
          {
            usage: '/ranking',
            text: 'Atualiza o #ranking agora com os dados do site oficial',
            tier: 'officer',
          },
        ],
      },
      {
        title: '🎯 Grupos',
        entries: [
          {
            usage: '/party',
            text: 'Abre um grupo para masmorra, boss ou Abismo; a galera entra pelo botão',
            tier: 'soldier',
          },
        ],
      },
      {
        title: '🔊 Sua sala de voz',
        entries: [
          {
            usage: '/voice rename',
            text: 'Muda o nome da sala (2 vezes a cada 10 min)',
            tier: 'visitor',
          },
          {
            usage: '/voice limit',
            text: 'Quantas pessoas cabem (0 = sem limite)',
            tier: 'visitor',
          },
          { usage: '/voice lock · unlock', text: 'Tranca ou abre a sala', tier: 'visitor' },
          {
            usage: '/voice hide · unhide',
            text: 'Esconde ou mostra a sala na lista',
            tier: 'visitor',
          },
          { usage: '/voice kick', text: 'Tira alguém da sala sem volta', tier: 'visitor' },
          { usage: '/voice claim', text: 'Assume uma sala cujo dono saiu', tier: 'visitor' },
        ],
      },
      {
        title: '📅 Eventos',
        entries: [
          { usage: '/event list', text: 'Eventos dos próximos 7 dias', tier: 'soldier' },
          {
            usage: '/event create · edit · cancel',
            text: 'Cria, edita ou cancela um evento',
            tier: 'officer',
          },
          { usage: '/event rsvps', text: 'Quem confirmou presença', tier: 'officer' },
          {
            usage: '/event template',
            text: 'Liga, desliga ou edita os eventos recorrentes',
            tier: 'officer',
          },
        ],
      },
      {
        title: '👥 Membros',
        entries: [
          {
            usage: '/member promote · demote',
            text: 'Sobe ou desce alguém na legião',
            tier: 'officer',
          },
          {
            usage: 'Fichas no #recrutamento',
            text: 'Aprove, recuse ou mude o tipo (Membro, Aliança, Parceiro) de quem pediu para entrar',
            tier: 'officer',
          },
          {
            usage: '/member partner',
            text: 'Torna alguém Parceiro (quem não joga), tirando o cargo anterior',
            tier: 'officer',
          },
          {
            usage: '/member ally',
            text: 'Torna alguém Aliado de uma aliança, tirando o cargo anterior',
            tier: 'officer',
          },
          {
            usage: '/member restrict',
            text: 'Restringe alguém ao #geral, com o motivo para os oficiais',
            tier: 'officer',
          },
          { usage: '/alliance list', text: 'As legiões aliadas', tier: 'soldier' },
          {
            usage: '/alliance add · remove',
            text: 'Cria ou desfaz uma aliança (os aliados dela viram Restrito)',
            tier: 'commander',
          },
          { usage: '/member info', text: 'Cargo, classes e datas de alguém', tier: 'officer' },
        ],
      },
      {
        title: '🛡️ Moderação',
        entries: [
          { usage: '/mod timeout', text: 'Silencia alguém por um tempo', tier: 'officer' },
          { usage: '/mod kick', text: 'Expulsa alguém do servidor', tier: 'officer' },
          { usage: '/mod purge', text: 'Apaga mensagens recentes de um canal', tier: 'officer' },
          { usage: '/mod ban · unban', text: 'Bane ou desbane alguém', tier: 'commander' },
          {
            usage: '/say',
            text: 'Envia uma mensagem como o Padrinho (sem texto, abre um formulário)',
            tier: 'officer',
          },
          { usage: '/audit', text: 'Últimas ações registradas no log', tier: 'officer' },
        ],
      },
      {
        title: '⚙️ Servidor e IA',
        entries: [
          { usage: '/mcp token', text: 'Tokens para controlar o Padrinho por IA', tier: 'officer' },
          {
            usage: '/setup',
            text: 'Aplica o server.yaml (canais, cargos, painéis)',
            tier: 'commander',
          },
          {
            usage: '/config reload',
            text: 'Recarrega o server.yaml sem reiniciar',
            tier: 'commander',
          },
        ],
      },
      {
        title: '💡 Sem comando',
        entries: [
          {
            usage: '#ranking',
            text: 'A legião por poder de combate, atualizada todo dia',
            tier: 'soldier',
          },
          { usage: '✅ ❔ ❌', text: 'Confirme presença nos avisos de #eventos', tier: 'soldier' },
          {
            usage: 'm!p · /play',
            text: 'Música em #musica (Don Vinil e Tony Vitrola)',
            tier: 'visitor',
          },
        ],
      },
    ],
  },
} as const;
