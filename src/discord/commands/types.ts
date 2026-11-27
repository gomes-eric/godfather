import type {
  ChatInputCommandInteraction,
  Guild,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { ConfigStore } from '../../config/store.js';
import type { ActionRunner } from '../../core/action.js';
import type { Actor } from '../../core/actor.js';
import type { AuditLog } from '../../core/audit.js';
import type { Logger } from '../../logger.js';
import type { AllianceService } from '../../services/alliance.service.js';
import type { EventCalendar } from '../../services/event-calendar.js';
import type { CharacterLookup } from '../../services/character-lookup.service.js';
import type { LegionCheckService } from '../../services/legion-check.service.js';
import type { PartyService } from '../../services/party.service.js';
import type { Recruitment } from '../../services/recruitment.service.js';
import type { RegistrationService } from '../../services/registration.service.js';
import type { Roster } from '../../services/roster.service.js';
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
  roster: Roster;
  alliances: AllianceService;
  moderation: ModerationService;
  messages: MessageService;
  voice: VoiceService;
  events: EventCalendar;
  characters: CharacterLookup;
  legion: LegionCheckService;
  parties: PartyService;
  registration: RegistrationService;
  recruitment: Recruitment;
  tokens: TokenService;
  mcpUrl: string;
  runAction: ActionRunner;
  confirmations: ConfirmationStore;
  resolveActor(userId: string): Promise<Actor>;
}

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
}
