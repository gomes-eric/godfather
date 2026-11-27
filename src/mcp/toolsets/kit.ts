import { ChannelType, type Guild } from 'discord.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ConfigError } from '../../config/loader.js';
import type { ConfigStore } from '../../config/store.js';
import { rejected, type ActionRunner, type ServiceOutcome } from '../../core/action.js';
import type { Actor } from '../../core/actor.js';
import type { ActionName } from '../../core/permissions.js';
import type { AuditLog } from '../../core/audit.js';
import type { GuildDirectory } from '../../discord/directory.js';
import { findChannel, findMember } from '../../discord/resolvers.js';
import { ptBR } from '../../i18n/pt-BR.js';
import type { ApplicationStore } from '../../db/applications.js';
import type { CharacterStore } from '../../db/characters.js';
import type { AllianceService } from '../../services/alliance.service.js';
import type { ChannelService } from '../../services/channel.service.js';
import { GameApiError, type GameCharacterService } from '../../services/game-character.service.js';
import type { LegionCheckService } from '../../services/legion-check.service.js';
import type { RankingBoard } from '../../services/ranking-board.service.js';
import type { NewsService } from '../../services/news.service.js';
import type { RecruitmentDesk } from '../../services/recruitment-desk.service.js';
import type { RegistrationService } from '../../services/registration.service.js';
import type { EventService } from '../../services/event.service.js';
import type { MemberService } from '../../services/member.service.js';
import type { MessageService } from '../../services/message.service.js';
import type { ModerationService } from '../../services/moderation.service.js';
import type { RoleService } from '../../services/role.service.js';
import type { SetupService } from '../../services/setup.service.js';

export interface McpServices {
  guild: Guild;
  config: ConfigStore;
  directory: GuildDirectory;
  audit: AuditLog;
  runAction: ActionRunner;
  setup: SetupService;
  members: MemberService;
  moderation: ModerationService;
  messages: MessageService;
  events: EventService;
  channels: ChannelService;
  roles: RoleService;
  characters: GameCharacterService;
  registrations: CharacterStore;
  registration: RegistrationService;
  applications: ApplicationStore;
  recruitmentDesk: RecruitmentDesk;
  alliances: AllianceService;
  legion: LegionCheckService;
  ranking: RankingBoard;
  news: NewsService;
  messageContent: boolean;
}

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
export const fail = (value: string): ToolResult => ({ ...text(value), isError: true });
export const json = (value: unknown): ToolResult => text(JSON.stringify(value, null, 2));

export function fromOutcome<T>(
  outcome: ServiceOutcome<T>,
  render: (value: T) => ToolResult = (value) =>
    typeof value === 'string' ? text(value) : json(value),
): ToolResult {
  switch (outcome.status) {
    case 'ok':
      return render(outcome.value);
    case 'confirmation_required':
      return json({
        status: 'confirmation_required',
        preview: outcome.preview,
        hint: 'Show the preview to the user, ask for explicit confirmation, then call again with confirm: true.',
      });
    case 'denied':
      return fail(ptBR.errors.denied(outcome.requiredTier));
    case 'rejected':
      return fail(outcome.reason);
  }
}

export const member = z.string().describe('Membro: nome, @menção ou ID');
export const channel = z.string().describe('Canal: nome (com ou sem #), menção ou ID');
export const confirm = z
  .boolean()
  .optional()
  .describe('Só true depois que o usuário confirmou a prévia mostrada');
export const reason = z.string().max(400).optional().describe('Motivo (vai para a auditoria)');

export type ToolKit = ReturnType<typeof createToolKit>;

/** What every toolset registers its tools with, bound to the calling actor. */
export function createToolKit(server: McpServer, s: McpServices, actor: Actor) {
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult | ServiceOutcome<unknown>>,
  ) =>
    server.registerTool(name, { description, inputSchema }, (async (args: unknown) => {
      try {
        const result = await handler(args as z.infer<z.ZodObject<Shape>>);
        return 'status' in result ? fromOutcome(result) : result;
      } catch (error) {
        if (error instanceof NotFound) return fail(error.message);
        return fail(
          `Erro ao executar ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }) as never);

  const read = <T>(action: ActionName, execute: () => Promise<T>) =>
    s.runAction({ actor, action, preview: action, execute });

  const memberId = (input: string): string => {
    const found = findMember(s.guild, input);
    if (!found.ok) throw new NotFound(found.reason);
    return found.value.id;
  };
  const channelId = (input: string, voiceOnly = false): string => {
    const found = findChannel(s.guild, input, (c) =>
      voiceOnly
        ? c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice
        : c.type !== ChannelType.GuildCategory,
    );
    if (!found.ok) throw new NotFound(found.reason);
    return found.value.id;
  };

  return { tool, read, memberId, channelId, s, actor };
}

export class NotFound extends Error {}

export function gameFailure(error: unknown): ServiceOutcome<never> {
  if (error instanceof GameApiError) return rejected(ptBR.profile.apiDown);
  throw error;
}

export function configFailure(error: unknown): ServiceOutcome<string> {
  if (error instanceof ConfigError) return rejected(error.message);
  throw error;
}
