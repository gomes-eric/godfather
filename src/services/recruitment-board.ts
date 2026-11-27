import type { Application } from '../db/applications.js';

export interface CardLook {
  classEmoji: string;
  avatarUrl: string | null;
  legionName: string;
  applicantName: string;
  newAlliance: boolean;
  previousStanding: string | null;
}

export interface ApplicationView {
  application: Application;
  look: CardLook;
}

export interface RecruitmentBoard {
  post(
    view: ApplicationView,
    options: { ping: boolean },
  ): Promise<{ threadId: string; messageId: string } | null>;
  refresh(view: ApplicationView): Promise<void>;
  say(application: Application, content: string): Promise<void>;
  deleteThread(threadId: string): Promise<boolean>;
}
