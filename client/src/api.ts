import type { KnowledgeItem, KnowledgeType, Lang, StoredKnowledgeItem } from "../../server/src/types";
import { localize, queryKnowledge } from "../../server/src/knowledgeQuery";

export type { KnowledgeItem, KnowledgeType, Lang };
export type KnowledgeSummary = Omit<KnowledgeItem, "body"> & { excerpt: string };

// Demo mode: a static preview with the sample data bundled in, no server needed.
const DEMO = import.meta.env.VITE_DEMO === "1";
const demoData = async (): Promise<StoredKnowledgeItem[]> =>
  (largeMode()
    ? (await import("../../server/data/knowledge-large.json")).default
    : (await import("../../server/data/knowledge.json")).default) as StoredKnowledgeItem[];

const summarize = ({ body, ...rest }: KnowledgeItem): KnowledgeSummary => ({ ...rest, excerpt: body.slice(0, 160) });

/** Preview: sample data + documents uploaded in this browser. */
const demoAll = async (): Promise<StoredKnowledgeItem[]> => [...(await (await import("./demoAsk")).demoUploads()), ...(await demoData())];

export async function listKnowledge(lang: Lang, type?: KnowledgeType, q?: string): Promise<KnowledgeSummary[]> {
  if (DEMO) return queryKnowledge(await demoAll(), { lang, type, q }).map(summarize);
  const params = new URLSearchParams({ lang });
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const res = await fetch(`/api/knowledge?${params}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function getKnowledge(id: string, lang: Lang): Promise<KnowledgeItem | null> {
  if (DEMO) {
    const item = (await demoAll()).find((i) => i.id === id);
    return item ? localize(item, lang) : null;
  }
  const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}?lang=${lang}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export interface AnswerSegment { text: string; sourceRefs: number[] }
export interface AnswerSource { number: number; id: string; title: string; type: KnowledgeType; passages: string[] }
export interface AskResult {
  conversationId: string;
  turn: number;
  /** answered from memory - no Claude call (server sends the remembered outcome; preview sends true) */
  fromMemory?: unknown;
  /** preview only: how many documents Claude read */
  docsRead?: { sent: number; total: number };
  status: "answered" | "declined";
  segments: AnswerSegment[];
  sources: AnswerSource[];
}

export class AskError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function ask(question: string, lang: Lang, conversationId?: string): Promise<AskResult> {
  if (DEMO) {
    const { demoAsk, DemoAskError } = await import("./demoAsk");
    const all = await demoAll();
    const docs = queryKnowledge(all, { lang });
    const other = queryKnowledge(all, { lang: lang === "he" ? "en" : "he" });
    try {
      return await demoAsk(question, docs, other, conversationId);
    } catch (e) {
      throw new AskError(e instanceof DemoAskError ? e.code : "unknown");
    }
  }
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, lang, conversationId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AskError(res.status === 429 ? "busy" : body.error ?? "unknown");
  }
  return res.json();
}

export type { Gap, GapExample, GapReason } from "../../server/src/gaps/types";
import type { Gap } from "../../server/src/gaps/types";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new AskError(res.status === 429 ? "busy" : b.error ?? "unknown");
  }
  return res.json();
}

export async function sendFeedback(conversationId: string, turn: number): Promise<void> {
  if (DEMO) return (await import("./demoAsk")).demoFeedback(conversationId, turn);
  await post("/api/feedback", { conversationId, turn });
}

export async function listGaps(status: "open" | "closed" = "open"): Promise<Gap[]> {
  if (DEMO) {
    const g = (await import("./demoAsk")).demoGaps();
    return status === "closed" ? g.listClosed() : g.list();
  }
  const res = await fetch(`/api/gaps${status === "closed" ? "?status=closed" : ""}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function setGapStatus(id: string, action: "dismiss" | "restore"): Promise<void> {
  if (DEMO) {
    await (await import("./demoAsk")).demoGaps().setStatus(id, action === "dismiss" ? "dismissed" : "open");
    return;
  }
  await post(`/api/gaps/${encodeURIComponent(id)}/${action}`);
}

// ---- reports ----
import type { Recipient, ReportData } from "../../server/src/reports/types";
export type { Recipient };
export interface ReportSummary {
  id: string; createdAt: string; periodStart: string; trigger: ReportData["trigger"];
  stats: ReportData["stats"]; gapCount: number; newCount: number; delivery: ReportData["delivery"];
  subjects: { he: string; en: string };
}

export async function listReports(): Promise<{ reports: ReportSummary[]; nextDue: string | null }> {
  if (DEMO) return (await import("./demoAsk")).demoReports().listSummaries();
  const res = await fetch("/api/reports");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function generateReport(): Promise<ReportSummary> {
  if (DEMO) return (await import("./demoAsk")).demoReports().generate();
  return post("/api/reports");
}

export async function reportHtml(id: string, lang: Lang): Promise<string> {
  if (DEMO) return (await import("./demoAsk")).demoReports().html(id, lang);
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}/html?lang=${lang}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

export async function listRecipients(): Promise<Recipient[]> {
  if (DEMO) return (await import("./demoAsk")).demoRecipients().list();
  const res = await fetch("/api/recipients");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function addRecipient(r: Omit<Recipient, "id">): Promise<Recipient> {
  if (DEMO) return (await import("./demoAsk")).demoRecipients().add(r);
  return post("/api/recipients", r);
}

export async function removeRecipient(id: string): Promise<void> {
  if (DEMO) {
    await (await import("./demoAsk")).demoRecipients().remove(id);
    return;
  }
  const res = await fetch(`/api/recipients/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(String(res.status));
}

// ---- uploading ----
import type { IntakeAnalysis } from "../../server/src/intake/types";
export interface UploadPreview {
  draftId: string;
  kind: string;
  truncated: boolean;
  excerpt: string;
  chars: number;
  sourceUrl: string | null;
  analysis: IntakeAnalysis;
  suggestedGaps: { id: string; titleHe: string; titleEn: string; isTarget: boolean }[];
}
export interface UploadSource { file?: File; url?: string; text?: string; gapId?: string | null }
export interface UploadCommit {
  draftId: string; titleHe: string; titleEn: string; type: KnowledgeType; topicHe: string; topicEn: string;
  closeGapIds: string[]; closeTargetAnyway: boolean;
}

async function demoCall<T>(fn: () => Promise<T>): Promise<T> {
  const { DemoAskError } = await import("./demoAsk");
  try {
    return await fn();
  } catch (e) {
    throw new AskError(e instanceof DemoAskError ? e.code.replace(/^demo:/, "") : "unknown");
  }
}

export async function previewUpload(src: UploadSource): Promise<UploadPreview> {
  if (DEMO) return demoCall(async () => (await import("./demoAsk")).demoPreviewUpload(src));
  const form = new FormData();
  if (src.gapId) form.append("gapId", src.gapId);
  if (src.file) form.append("file", src.file);
  else if (src.url) form.append("url", src.url);
  else if (src.text) form.append("text", src.text);
  const res = await fetch("/api/uploads/preview", { method: "POST", body: form });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new AskError(res.status === 429 ? "busy" : b.error ?? "unknown");
  }
  return res.json();
}

export async function commitUpload(c: UploadCommit): Promise<{ itemId: string; closed: { id: string; titleHe: string; titleEn: string }[] }> {
  if (DEMO) return demoCall(async () => (await import("./demoAsk")).demoCommitUpload(c));
  return post("/api/uploads/commit", c);
}

export type Role = "owner" | "member";
export async function getRole(): Promise<Role> {
  if (DEMO) return "owner";
  const res = await fetch("/api/me");
  if (!res.ok) throw new AskError((await res.json().catch(() => ({}))).error ?? "unknown");
  return (await res.json()).role === "owner" ? "owner" : "member";
}

export interface UsageInfo {
  measured: boolean;
  month?: { questions: number; usd: number; perQuestionUsd: number; fromMemory: number };
}
export async function getUsage(): Promise<UsageInfo> {
  if (DEMO) return { measured: false };
  const res = await fetch("/api/usage");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Preview only: include 28 extra sample documents to try smart search. */
export const LARGE_MODE_KEY = "preview-large-base";
export function largeMode(): boolean {
  try {
    return DEMO && localStorage.getItem(LARGE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setLargeMode(on: boolean) {
  try {
    localStorage.setItem(LARGE_MODE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
