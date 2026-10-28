import type {
  ChatInputCommandInteraction,
  Guild,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { ConfigStore } from '../../config/store.js';
import type { ActionRunner } from '../../core/action.js';
import type { Actor } from '../../core/actor.js';
import type { AuditLog } from '../../core/audit.js';
import type { CharacterStore } from '../../db/characters.js';
import type { Logger } from '../../logger.js';
import type { EventService } from '../../services/event.service.js';
import type { GameCharacterService } from '../../services/game-character.service.js';
import type { LegionCheckService } from '../../services/legion-check.service.js';
import type { PartyService } from '../../services/party.service.js';
import type { RecruitmentDesk } from '../../services/recruitment-desk.service.js';
import type { RegistrationService } from '../../services/registration.service.js';
import type { ApplicationStore } from '../../db/applications.js';
import type { MemberService } from '../../services/member.service.js';
import type { MessageService } from '../../services/message.service.js';
import type { ModerationService } from '../../services/moderation.service.js';
import type { SetupService } from '../../services/setup.service.js';
import type { TokenService } from '../../services/token.service.js';
import type { VoiceService } from '../../services/voice.service.js';
import type { ConfirmationStore } from '../interactions/confirmation.js';

export interface CommandContext {
  guild: Guild;
  logger: Logger;
  config: ConfigStore;
  audit: AuditLog;
  setup: SetupService;
  members: MemberService;
  moderation: ModerationService;
  messages: MessageService;
  voice: VoiceService;
  events: EventService;
  /** Characters from the official Aion 2 site. */
  characters: GameCharacterService;
  /** Which in-game character each member has (from approved applications). */
  registrations: CharacterStore;
  /** The legion check and the #ranking board (/ranking). */
  legion: LegionCheckService;
  /** Party finder (/party). */
  parties: PartyService;
  /** Ties members to their characters (class role, nickname, Soldado). */
  registration: RegistrationService;
  /** "Enviar minha ficha": posting applications and carrying out decisions. */
  recruitmentDesk: RecruitmentDesk;
  applications: ApplicationStore;
  tokens: TokenService;
  /** Public URL of the MCP endpoint, shown with new tokens. */
  mcpUrl: string;
  runAction: ActionRunner;
  confirmations: ConfirmationStore;
  resolveActor(userId: string): Promise<Actor>;
}

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
}
