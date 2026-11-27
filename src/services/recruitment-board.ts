import type { Application } from '../db/applications.js';

/** What a card shows besides the application itself. */
export interface CardLook {
  classEmoji: string;
  avatarUrl: string | null;
  legionName: string;
  /** The applicant's name in Discord, for a Parceiro without a character. */
  applicantName: string;
  /** An Aliança whose legion is not an alliance yet. */
  newAlliance: boolean;
  /** The standing they had before the daily check changed it. */
  previousStanding: string | null;
}

export interface ApplicationView {
  application: Application;
  look: CardLook;
}

/** Where applications are shown and answered (a Discord adapter and an in-memory fake). */
export interface RecruitmentBoard {
  /**
   * Opens the application's private thread (the staff, plus the applicant for a form; in the
   * officers' channel for a daily check review) and posts its card. Null when the channel is
   * missing.
   */
  post(
    view: ApplicationView,
    options: { ping: boolean },
  ): Promise<{ threadId: string; messageId: string } | null>;
  /** Re-renders the card where it was posted (buttons go once it is decided). */
  refresh(view: ApplicationView): Promise<void>;
  /** A message to the applicant, in their thread or the announce channel; it mentions only them. */
  say(application: Application, content: string): Promise<void>;
  deleteThread(threadId: string): Promise<boolean>;
}
