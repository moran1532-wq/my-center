import type { Lang } from "../types.js";
import type { Gap } from "../gaps/types.js";

export type QuestionOutcome = "answered" | "partial" | "no_info" | "off_topic";

export interface QuestionStat {
  outcome: QuestionOutcome;
  at: string; // ISO
}

export interface StatsStore {
  record(stat: QuestionStat): Promise<void>;
  since(fromIso: string): Promise<QuestionStat[]>;
}

export interface Recipient {
  id: string;
  name: string;
  email: string;
  lang: Lang;
}

export interface RecipientStore {
  list(): Promise<Recipient[]>;
  add(r: Omit<Recipient, "id">): Promise<Recipient>;
  remove(id: string): Promise<boolean>;
}

/** Everything a report shows, frozen at the moment it was made. */
export interface ReportData {
  id: string;
  createdAt: string;
  periodStart: string;
  trigger: "schedule" | "manual";
  stats: { asked: number; answered: number; partial: number; noInfo: number };
  gaps: (Gap & { isNew: boolean })[];
  /** what Claude cost during this period (missing when not measured) */
  cost?: { usd: number; questions: number; perQuestionUsd: number };
  /** gaps a document closed during this period (missing in reports made before this existed) */
  closed?: { id: string; titleHe: string; titleEn: string; closedAt: string }[];
  delivery: { emailed: string[]; failed: string[]; note: "sent" | "no_mail_server" | "no_recipients" | "partial_failure" };
}

export interface ReportStore {
  list(): Promise<ReportData[]>; // newest first
  get(id: string): Promise<ReportData | undefined>;
  save(r: ReportData): Promise<void>;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  attachment: { filename: string; content: string };
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}
