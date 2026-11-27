# Padrinho

Bot de Discord para legiões de **Aion 2**. Cuida de recrutamento, cargos, eventos, salas de voz e
notícias do jogo. O layout do servidor (cargos, canais e permissões) fica descrito num arquivo,
o `server.yaml`, e o bot o aplica com `/setup`. Também dá para controlar o bot por um assistente de
IA (Claude Code, Codex, OpenCode) através de MCP.

Ele foi escrito para a legião M4F1A (Triniel, América do Sul, Asmodianos). Este guia mostra o que
trocar para usar o bot no seu servidor.

## Sumário

1. [O que o bot faz](#o-que-o-bot-faz)
2. [Requisitos](#requisitos)
3. [Criar a aplicação no Discord](#1-criar-a-aplicação-no-discord)
4. [Adaptar o server.yaml](#2-adaptar-o-serveryaml)
5. [Textos fixos no código](#3-textos-fixos-no-código)
6. [Subir em produção](#4-subir-em-produção)
7. [Primeira configuração no Discord](#5-primeira-configuração-no-discord)
8. [Bots de música](#6-bots-de-música)
9. [Resumos de notícias com Claude (opcional)](#7-resumos-de-notícias-com-claude-opcional)
10. [Controlar o bot por IA (MCP)](#8-controlar-o-bot-por-ia-mcp)
11. [Referência do .env](#referência-do-env)
12. [Desenvolvimento local](#desenvolvimento-local)
13. [Atualizar, backup e problemas comuns](#atualizar-backup-e-problemas-comuns)

## O que o bot faz

| Área         | O que faz                                                                                                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor     | Cria e mantém cargos, categorias, canais, permissões, regras e o painel de boas-vindas a partir do `server.yaml` (`/setup`).                                                                                                                                                                                |
| Hierarquia   | Quatro níveis: Comandante, Oficial, Soldado e Visitante. Fora deles: Aliado (de uma legião aliada, conta como Soldado), Parceiro (não joga) e Restrito (só vê o #geral). Mudar alguém de cargo tira o anterior sozinho. O dono do servidor conta sempre como Comandante.                                    |
| Recrutamento | Painel "Enviar minha ficha" com três tipos: Membro (quem já está na legião vira Soldado na hora), Aliança (cria a aliança se um Comandante aprovar) e Parceiro. Cada ficha abre uma thread privada, e o Oficial aprova, recusa ou muda o tipo. Personagem já cadastrado em outra conta nunca entra sozinho. |
| Personagens  | `/perfil` lê o personagem no site oficial do Aion 2, com os equipamentos. Uma checagem diária atualiza classe e nome e avisa quem entrou ou saiu da legião.                                                                                                                                                 |
| Ranking      | Canal de ranking reconstruído todo dia e quando alguém usa `/ranking`.                                                                                                                                                                                                                                      |
| Eventos      | Eventos recorrentes (Cerco, Chefes, Boss semanal) com lembretes, confirmação de presença por botões e agenda. Os horários seguem o [shugo.gg](https://shugo.gg/timers) sozinhos.                                                                                                                            |
| Notícias     | Lê os anúncios do jogo na Steam a cada 15 min e posta no canal de notícias. Com Claude ligado, cada post vira um resumo em português que marca @everyone ou os cargos das classes afetadas.                                                                                                                 |
| Voz          | Canais "➕ Criar" que geram salas temporárias (Dungeon 01, 02…). O dono da sala a renomeia e limita com `/voice`.                                                                                                                                                                                           |
| Música       | Bots de música só respondem em #musica e no chat dos canais de voz. Comandos de música digitados em outro canal são apagados.                                                                                                                                                                               |
| Moderação    | `/mod`, `/member`, `/say` e log de auditoria de tudo que o bot faz.                                                                                                                                                                                                                                         |
| Alianças     | `/alliance add`, `remove` e `list`. Cada aliança tem um cargo com o nome da legião e acesso à categoria Aliança.                                                                                                                                                                                            |
| Grupos       | `/party` monta grupos para conteúdo.                                                                                                                                                                                                                                                                        |

`/help` lista os comandos que cada pessoa pode usar, de acordo com o nível dela.

## Requisitos

- Um servidor Linux sempre ligado. Uma VPS com 1 GB de RAM sobra: o bot usa cerca de 60 MB.
- Docker com o plugin `docker compose`, mais `git` e `curl`.
- [Tailscale](https://tailscale.com) com Funnel, para ter uma URL HTTPS pública. Ela é usada pelo MCP
  e pelos resumos com Claude. Sem esses dois recursos, o bot funciona sem URL pública.
- Para desenvolver no PC: Node.js 22 ou mais novo.

## 1. Criar a aplicação no Discord

1. Abra o [Developer Portal](https://discord.com/developers/applications) e crie uma aplicação. O
   nome dela é o nome do bot.
2. Em **General Information**, copie o **Application ID** (vai para `DISCORD_CLIENT_ID`).
3. Em **Bot**:
   - clique em **Reset Token** e guarde o token (vai para `DISCORD_TOKEN`). Ele é uma senha: não
     publique nem mande no chat;
   - ligue **Server Members Intent** (obrigatório);
   - ligue **Message Content Intent** se for usar a proteção de #musica. Depois ponha
     `DISCORD_MESSAGE_CONTENT=true` no `.env`. Sem ela, o bot não lê o texto das mensagens e não
     apaga comandos de música fora do lugar.
4. Em **OAuth2 → URL Generator**, marque os escopos `bot` e `applications.commands` e a permissão
   **Administrator**. Abra a URL gerada e convide o bot para o seu servidor.
5. No Discord, ligue o Modo desenvolvedor (Configurações → Avançado). Clique com o botão direito no
   ícone do servidor → **Copiar ID** (vai para `DISCORD_GUILD_ID`).
6. Em **Configurações do servidor → Cargos**, arraste o cargo do bot para logo abaixo do cargo do
   dono. O bot só mexe em cargos que estão abaixo do dele.

O bot funciona em um único servidor: o do `DISCORD_GUILD_ID`. Cada guilda roda a própria cópia, com
a própria aplicação e o próprio token.

## 2. Adaptar o server.yaml

O [server.yaml](server.yaml) é o servidor descrito em texto. Cada item tem uma `key` fixa em inglês
e um `name` que aparece no Discord. Trocar o `name` só renomeia o canal ou cargo. Trocar a `key` cria
um item novo.

Faça um fork do repositório e edite o arquivo nele, assim suas mudanças não se perdem nas
atualizações. O que trocar:

**Identidade da legião e do servidor do jogo** (`settings.characters`)

```yaml
characters:
  region: la # região do site oficial do Aion 2
  serverId: 2403 # id do seu servidor no jogo (2403 = Triniel)
  serverName: Triniel # nome do servidor, usado nos textos
  legion: M4F1A # nome da legião no jogo, exatamente como aparece
  reportChannel: officers # onde a checagem diária avisa quem entrou ou saiu
  rankingChannel: ranking
```

Para achar o `serverId`, abra o personagem de alguém do seu servidor no site oficial do Aion 2 ou no
[shugo.gg](https://shugo.gg) e veja o número na URL ou na resposta da página.

**Horários dos eventos** (`settings.timezone`, `settings.eventTimes` e `eventTemplates`)

- `timezone`: o fuso dos horários (`America/Sao_Paulo` na América do Sul).
- `eventTimes.region`: a região no [timers.json do shugo.gg](https://shugo.gg/timers.json)
  (`global-sa` é a América do Sul).
- `eventTimes.group`: o seu grupo de Cerco (1 = 21:00, 2 = 21:05, 3 = 21:10 na América do Sul).
- Os `eventTemplates` com `shugoEvent` seguem os dias e horários do shugo.gg. O bot confere a cada 6 h
  e reescreve o próprio `server.yaml` quando algo muda. Sem `shugoEvent`, valem `days` e `time`.

**Textos de boas-vindas e regras** (`settings.welcome` e `settings.rules`): troque o nome da legião,
a facção e as regras. `{member}` menciona quem entrou, e `{channel:<key>}` vira um link para o canal.

**Recrutamento** (`settings.recruitment`): o canal do painel, o canal das threads de ficha e o cargo
avisado quando chega uma ficha nova.

**Aliados e Restritos** (`settings.allyRole`, `settings.restrictedRole`, `settings.alliances` e a
lista `alliances` no fim do arquivo): o cargo Aliado conta como Soldado em todos os canais; o
Restrito só vê os canais que o liberam (no exemplo, o #geral). A lista `alliances` é escrita pelo
`/alliance add`. O cargo `settings.allyLeaderRole` (Líder Aliado) marca os líderes das guildas
aliadas com `/alliance leader add`, e o bot o tira quando a pessoa deixa de ser Aliado. A checagem diária transforma em Restrito quem sai da legião no jogo e abre uma
análise para os oficiais (com mais de 3 saídas de uma vez, ela não muda ninguém).

**Notícias** (`settings.news`): o canal e o app da Steam (`3393110` é o AION 2). Sem `summary`, sai o
card simples da Steam. Os resumos com Claude estão na [seção 7](#7-resumos-de-notícias-com-claude-opcional).

**Cargos** (`roles`): os níveis precisam continuar com `tier: commander`, `officer`, `soldier` e
`visitor`. Pode trocar nomes, cores e permissões. Os cargos de classe (`class: true`) devem continuar
com as mesmas `key`: o bot liga cada classe do jogo à sua `key`.

**Canais** (`categories`): crie, renomeie ou tire canais à vontade. Cada um tem um `access` com quem
vê e quem escreve: `everyone`, `soldier`, `officer`, `commander`, `bot` (só o bot escreve) ou `none`.
Se tirar um canal, tire também as referências a ele em `settings` (o bot avisa quando uma `key` não
existe).

**Salas de voz** (`voiceGenerators`): cada gerador "➕ Criar" fica sozinho na própria categoria. Ajuste
os nomes das salas e o limite de pessoas.

O comentário no topo do `server.yaml` explica os níveis de acesso. O formato completo, com todos os
campos, está em [src/config/schema.ts](src/config/schema.ts).

## 3. Textos fixos no código

Alguns textos ainda citam a M4F1A e o Triniel direto no código. Troque-os no seu fork:

| Arquivo                                                      | O que tem                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [src/i18n/pt-BR.ts](src/i18n/pt-BR.ts)                       | Mensagens do bot: "Este bot só funciona no servidor da M4F1A", "Não achei o personagem no Triniel", rodapés com "M4F1A". |
| [src/core/news-digest.ts](src/core/news-digest.ts)           | O prompt dos resumos de notícias: descreve a legião, o servidor e quando marcar @everyone.                               |
| [src/services/news.service.ts](src/services/news.service.ts) | A regra que só marca @everyone quando o anúncio cita "Triniel".                                                          |
| [src/mcp/instructions.ts](src/mcp/instructions.ts)           | O texto que apresenta o bot aos assistentes de IA (a facção está fixa como Asmodiana).                                   |
| [Dockerfile](Dockerfile)                                     | `TZ=America/Sao_Paulo`, o fuso do container.                                                                             |

Procure por `M4F1A`, `Triniel` e `asmodian` para achar todos:

```powershell
git grep -n -i -E "m4f1a|triniel|asmodi" -- src Dockerfile
```

## 4. Subir em produção

No servidor Linux:

```bash
git clone https://github.com/SEU-USUARIO/SEU-FORK.git padrinho
cd padrinho
./scripts/deploy-wizard.sh
```

O wizard explica cada passo e pode ser rodado de novo sem perder nada:

1. confere Docker, git, curl e Tailscale;
2. atualiza o código (`git pull`);
3. pede o token, o Application ID e o ID do servidor e grava o `.env`;
4. pergunta se o bot já roda em outro lugar, para pará-lo (numa instalação nova, responda **N**);
5. traz um banco existente, se houver. Numa instalação nova, o banco é criado vazio;
6. sobe o container e espera o `/healthz` responder;
7. publica a porta 8080 com o Tailscale Funnel e grava a URL em `PUBLIC_BASE_URL`;
8. agenda o backup diário no crontab;
9. confere o MCP.

<details>
<summary>Sem o wizard (passo a passo manual)</summary>

```bash
cp .env.example .env              # preencha DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
echo "HOST_GID=$(id -g)" >> .env  # grupo do seu usuário (veja abaixo)
chmod g+w server.yaml
mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build
curl http://127.0.0.1:8080/healthz
sudo tailscale funnel --bg 8080   # depois ponha a URL https://...ts.net em PUBLIC_BASE_URL
docker compose up -d              # recria o container com a URL nova
```

</details>

Detalhes de permissão:

- O container roda como o usuário `node` (uid 1000). A pasta `data/` precisa pertencer ao uid 1000.
- O bot reescreve o `server.yaml` (horários do shugo.gg, `/event template edit`). Para isso, o
  container entra no grupo do seu usuário (`HOST_GID` no `.env`) e o arquivo precisa de permissão de
  escrita para o grupo (`chmod g+w server.yaml`). O wizard faz os dois.
- A porta 8080 só abre para o próprio servidor (`127.0.0.1`). Quem a expõe para fora é o Funnel.

## 5. Primeira configuração no Discord

1. Com o bot online, o dono do servidor roda `/setup dry-run:true` para ver o que vai mudar.
2. Depois roda `/setup` e confirma. O bot cria cargos, canais, permissões, as regras, o painel de
   boas-vindas e o painel de recrutamento.
3. Dê o cargo de Comandante e de Oficial para a liderança. O resto do servidor entra pelo
   recrutamento: quem manda a ficha e é aprovado vira Soldado.

Sempre que editar o `server.yaml`, rode `/setup` de novo. Ele só aplica a diferença. Com
`prune:true`, também apaga o que saiu do arquivo.

Se o servidor já tem canais e cargos, o `/setup` assume os que têm o mesmo nome do `server.yaml` em
vez de criar outros e não apaga nada que não esteja no arquivo. Confira o `dry-run` antes: ele mostra
o que vai ser assumido, criado e alterado.

## 6. Bots de música

O bot dá o cargo **Bot** a todo bot que entra no servidor. O `server.yaml` esconde dos bots todos os
canais de texto, menos #musica e o chat dos canais de voz (`botTextChannels` e `voiceAccess`). Para
isso funcionar:

1. Em **Configurações do servidor → Cargos**, tire **Administrator** dos cargos próprios dos bots de
   música (o cargo com o nome do bot, criado quando ele entrou). Quem é Administrator ignora as
   permissões de canal.
2. Para esconder também os comandos `/` deles nos outros canais, vá em **Configurações do servidor →
   Integrações**, abra cada bot e limite os **Canais** a #musica e aos canais de voz.
3. Em `settings.musicGuard.commandPrefixes`, ponha os prefixos de texto dos seus bots (`m!` é o do
   Jockie Music). Em #musica, só ficam comandos de música. Fora dela, o bot apaga esses comandos e
   avisa a pessoa (precisa do Message Content Intent).

## 7. Resumos de notícias com Claude (opcional)

Com Claude ligado, cada anúncio da Steam (em qualquer idioma) vira um card em português com o que
importa para a legião. O card marca @everyone quando o anúncio afeta o seu servidor e marca o cargo
de cada classe que mudou. Sem isso, o bot posta o card simples da Steam.

O bot se autentica na API do Claude por **Workload Identity Federation**: ele assina um token com a
própria chave, e o Claude Console confia nessa chave. Nenhuma API key fica guardada no servidor. Isso
exige a URL pública do Funnel (`PUBLIC_BASE_URL`).

1. Gere a chave do bot:

   ```bash
   docker compose exec padrinho node dist/wif-keygen.js
   ```

   O comando cria `data/wif/issuer-es256.pem` (uma vez só) e mostra a URL do emissor, a chave
   pública e os campos da regra.

2. No [Claude Console](https://console.anthropic.com), em **Settings → Workload identity**:
   - **Registre um emissor**: a URL é a `PUBLIC_BASE_URL`, a fonte do JWKS é **inline**, e as chaves
     são o JSON que o comando mostrou;
   - **Crie uma conta de serviço** no workspace que vai pagar o uso;
   - **Crie uma regra de federação** ligando o emissor à conta de serviço, com `subject_prefix`
     `padrinho:news`, audience `https://api.anthropic.com` e escopo `workspace:developer`.

3. Ponha os ids no `.env` e recrie o container com `docker compose up -d`:

   ```dotenv
   ANTHROPIC_FEDERATION_RULE_ID=fdrl_...
   ANTHROPIC_ORGANIZATION_ID=00000000-0000-0000-0000-000000000000
   ANTHROPIC_SERVICE_ACCOUNT_ID=svac_...
   ANTHROPIC_WORKSPACE_ID=wrkspc_...
   ```

   Não defina `ANTHROPIC_API_KEY`: ela passaria na frente da federação.

4. Confirme que `settings.news.summary.model` está no `server.yaml` (o padrão é `claude-sonnet-5-5`).
   Para testar sem postar nada, use a ferramenta MCP `preview_news`.

Antes de ligar, ajuste o prompt em [src/core/news-digest.ts](src/core/news-digest.ts) para a sua
legião e o seu servidor ([seção 3](#3-textos-fixos-no-código)).

## 8. Controlar o bot por IA (MCP)

O bot expõe um servidor MCP em `PUBLIC_BASE_URL/mcp`. Pelo assistente, dá para planejar e aplicar o
`server.yaml`, gerenciar eventos, fichas, personagens, ranking e salas de voz. Cada pessoa age com o
próprio nível do Discord.

1. No Discord, rode `/mcp token create name:notebook`. O token aparece uma vez só: guarde-o.
2. No Claude Code:

   ```powershell
   claude mcp add --transport http padrinho https://SEU-SERVIDOR.ts.net/mcp --header "Authorization: Bearer SEU_TOKEN"
   ```

   Codex e OpenCode aceitam a mesma URL com o mesmo cabeçalho.

3. `/mcp token list` mostra os seus tokens e `/mcp token revoke` revoga um deles.

## Referência do .env

| Variável                       | Obrigatória | Descrição                                                                                    |
| ------------------------------ | ----------- | -------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                | sim         | Token do bot (Developer Portal → Bot).                                                       |
| `DISCORD_CLIENT_ID`            | sim         | Application ID.                                                                              |
| `DISCORD_GUILD_ID`             | sim         | ID do servidor do Discord.                                                                   |
| `PUBLIC_BASE_URL`              | sim         | URL HTTPS pública (Funnel). Pode ser um valor de exemplo enquanto não houver uma.            |
| `HTTP_PORT`                    | não         | Porta do servidor HTTP (`/healthz` e `/mcp`). Padrão `8080`.                                 |
| `DATABASE_PATH`                | não         | Caminho do banco SQLite. Padrão `./data/padrinho.db` (`/data/padrinho.db` no container).     |
| `SERVER_CONFIG_PATH`           | não         | Caminho do `server.yaml`. Padrão `./server.yaml`.                                            |
| `LOG_LEVEL`                    | não         | `fatal`, `error`, `warn`, `info` (padrão), `debug` ou `trace`.                               |
| `DISCORD_MESSAGE_CONTENT`      | não         | `true` para ler o texto das mensagens (proteção de #musica). Ligue o intent no Portal antes. |
| `NODE_ENV`                     | não         | `development` (padrão) ou `production`. O Docker usa `production`.                           |
| `HOST_GID`                     | não         | Grupo do usuário do servidor, para o container gravar o `server.yaml`. Padrão `1001`.        |
| `ANTHROPIC_FEDERATION_RULE_ID` | não         | Id da regra de federação (`fdrl_...`). Os quatro `ANTHROPIC_*` ligam os resumos.             |
| `ANTHROPIC_ORGANIZATION_ID`    | não         | Id da organização no Claude Console (UUID).                                                  |
| `ANTHROPIC_SERVICE_ACCOUNT_ID` | não         | Id da conta de serviço (`svac_...`).                                                         |
| `ANTHROPIC_WORKSPACE_ID`       | não         | Id do workspace (`wrkspc_...`).                                                              |

## Desenvolvimento local

```powershell
npm install
copy .env.example .env
npm run dev
```

Use uma aplicação e um servidor de teste do Discord para desenvolver. Com o mesmo token da produção,
os dois bots respondem a tudo em dobro.

| Script                | O que faz                                                    |
| --------------------- | ------------------------------------------------------------ |
| `npm run dev`         | Roda com recarga automática.                                 |
| `npm run check`       | Tipos, lint, formatação e testes. Rode antes de cada commit. |
| `npm test`            | Só os testes (Vitest).                                       |
| `npm run build`       | Compila para `dist/`.                                        |
| `npm run db:generate` | Gera uma migração depois de mudar `src/db/schema.ts`.        |

O bot responde em `http://localhost:8080/healthz`.

## Atualizar, backup e problemas comuns

**Atualizar**, no servidor:

```bash
git pull && docker compose up -d --build
```

As migrações do banco rodam sozinhas na subida. Se você pegou as mudanças do repositório original,
rode `/setup dry-run:true` para ver se o `server.yaml` novo muda algo no servidor.

**Backup**: `scripts/backup.sh` copia o banco para `data/backups` e guarda os 14 mais recentes. O
wizard o agenda para as 04:15. O banco guarda os ids criados pelo `/setup`, eventos, presenças,
personagens, fichas, salas e tokens MCP. Copie `data/` junto com o `.env` se mudar de servidor.

**Problemas comuns**

- **O bot responde em dobro.** Há duas cópias rodando com o mesmo token. Pare uma delas.
- **`EACCES` ao gravar `/app/server.yaml`.** O `HOST_GID` não é o grupo do dono do arquivo, ou falta
  `chmod g+w server.yaml`.
- **`EACCES` em `/data`.** A pasta `data/` não pertence ao uid 1000: `sudo chown -R 1000:1000 data`.
- **"The bot is not in guild…" na subida.** O bot não foi convidado para o servidor do
  `DISCORD_GUILD_ID`.
- **O `/setup` não muda um cargo.** O cargo está acima do cargo do bot. Arraste o cargo do bot para
  cima em Configurações do servidor → Cargos.
- **Bots de música respondem em qualquer canal.** O cargo próprio deles ainda tem Administrator
  ([seção 6](#6-bots-de-música)).
- **As notícias saem sem resumo.** Falta `settings.news.summary` no `server.yaml` ou algum
  `ANTHROPIC_*` no `.env`. Veja os logs com `docker compose logs --tail 100 padrinho`.
