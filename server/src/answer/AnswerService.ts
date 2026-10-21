import type Anthropic from "@anthropic-ai/sdk";
import type { KnowledgeItem, Lang } from "../types.js";
import type { ConversationStore } from "./ConversationStore.js";
import type { Retriever } from "./Retriever.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { UsageMeter } from "../usage/UsageMeter.js";
import type { AnswerMemory, MemoryEntry } from "./AnswerMemory.js";

export const MODEL = "claude-opus-5-5";
const MAX_SOURCES = 3;
const MAX_PASSAGES_PER_SOURCE = 3;

/** The single Claude call the service needs - injectable so tests never call the real API. */
export type CreateMessage = (
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

export function claudeCreateMessage(client: Anthropic, meter?: UsageMeter): CreateMessage {
  return async (params) => {
    const res = await client.beta.messages.stream(params).finalMessage();
    await meter?.record("answer", res.model, res.usage).catch(() => undefined);
    return res;
  };
}

export interface AnswerSegment {
  text: string;
  /** 1-based numbers into `sources` */
  sourceRefs: number[];
}

export interface AnswerSource {
  number: number;
  id: string;
  title: string;
  type: KnowledgeItem["type"];
  passages: string[];
}

export type Coverage = "full" | "partial" | "none" | "off_topic";

const COVERAGE = /\s*\[\[coverage:(full|partial|none|off_topic)\]\]\s*/;

/** Takes the hidden coverage mark off the answer. */
export function stripCoverage(segments: AnswerSegment[]): { segments: AnswerSegment[]; coverage: Coverage | null } {
  let coverage: Coverage | null = null;
  const all = new RegExp(COVERAGE.source, "g");
  const out = segments
    .map((s) => {
      const m = COVERAGE.exec(s.text);
      if (!m) return s;
      coverage = m[1] as Coverage;
      return { ...s, text: s.text.replace(all, "").trimEnd() };
    })
    .filter((s) => s.text.trim() || s.sourceRefs.length);
  return { segments: out, coverage };
}

export interface AskResult {
  conversationId: string;
  /** 0-based number of this question in the conversation (used for feedback) */
  turn: number;
  status: "answered" | "declined";
  segments: AnswerSegment[];
  sources: AnswerSource[];
  /** what Claude said about how well the documents answer (null when it gave no mark) */
  coverage?: Coverage | null;
  /** answered from memory - no Claude call */
  fromMemory?: Pick<MemoryEntry, "outcome" | "gapId">;
}

export class ConversationNotFoundError extends Error {}
export class ConversationTooLongError extends Error {}

/** Follow-ups per conversation - each one resends the whole history, so cap the cost. */
export const MAX_QUESTIONS_PER_CONVERSATION = 20;

function documentBlock(item: KnowledgeItem, cache: boolean): Anthropic.Beta.BetaRequestDocumentBlock {
  return {
    type: "document",
    source: { type: "text", media_type: "text/plain", data: item.body },
    title: item.title,
    context: `type: ${item.type}; topic: ${item.topic}; owner: ${item.owner}; updated: ${item.updatedAt}`,
    citations: { enabled: true },
    ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  };
}

export class AnswerService {
  constructor(
    private readonly createMessage: CreateMessage,
    private readonly retriever: Retriever,
    private readonly conversations: ConversationStore,
    private readonly memory: { store: AnswerMemory; version: () => Promise<string> } | null = null,
  ) {}

  async ask(input: { question: string; lang: Lang; conversationId?: string }): Promise<AskResult> {
    let conversation;
    if (input.conversationId) {
      conversation = await this.conversations.get(input.conversationId);
      if (!conversation) throw new ConversationNotFoundError();
      const asked = conversation.messages.filter((m) => m.role === "user").length;
      if (asked >= MAX_QUESTIONS_PER_CONVERSATION) throw new ConversationTooLongError();
      conversation.messages.push({ role: "user", content: input.question });
    } else {
      const version = this.memory ? await this.memory.version() : "";
      const remembered = this.memory ? await this.memory.store.find(input.question, input.lang, version) : null;
      const docs = await this.retriever.documentsFor(input.question, input.lang);
      conversation = await this.conversations.create(input.lang, docs);
      conversation.messages.push({
        role: "user",
        content: [
          ...docs.map((d, i) => documentBlock(d, i === docs.length - 1)),
          { type: "text", text: input.question },
        ],
      });
      if (remembered) {
        // A plain-text assistant turn, so follow-up questions still have the context.
        conversation.messages.push({ role: "assistant", content: remembered.segments.map((s) => s.text).join("") || "-" });
        await this.conversations.save(conversation);
        return {
          conversationId: conversation.id, turn: 0, status: "answered",
          segments: remembered.segments, sources: remembered.sources, coverage: null,
          fromMemory: { outcome: remembered.outcome, gapId: remembered.gapId },
        };
      }
    }

    const response = await this.createMessage({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: conversation.messages,
    });

    // Assistant content goes back exactly as returned (thinking blocks included).
    conversation.messages.push({
      role: "assistant",
      content: response.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
    });
    await this.conversations.save(conversation);

    const turn = conversation.messages.filter((m) => m.role === "user").length - 1;
    if (response.stop_reason === "refusal") {
      return { conversationId: conversation.id, turn, status: "declined", segments: [], sources: [] };
    }
    const mapped = mapAnswer(response, conversation.documents);
    const { segments, coverage } = stripCoverage(mapped.segments);
    const result: AskResult = { conversationId: conversation.id, turn, status: "answered", segments, sources: mapped.sources, coverage };
    if (turn === 0 && this.memory) {
      await this.memory.store.save({
        lang: input.lang, question: input.question, segments, sources: mapped.sources, version: await this.memory.version(),
        ...(coverage === "full" ? { outcome: "answered" as const, gapId: null } : coverage === "off_topic" ? { outcome: "off_topic" as const, gapId: null } : {}),
      });
    }
    return result;
  }

  /** "Didn't help": the remembered answer to this question must not be served again. */
  async forget(question: string, lang: Lang) {
    await this.memory?.store.forget(question, lang);
  }

  async rememberOutcome(question: string, lang: Lang, outcome: NonNullable<MemoryEntry["outcome"]>, gapId: string | null) {
    await this.memory?.store.update(question, lang, { outcome, gapId });
  }

  /** The question and answer text of one turn - so feedback never trusts text sent by the browser. */
  async turn(conversationId: string, turn: number) {
    const c = await this.conversations.get(conversationId);
    if (!c) return undefined;
    const userIdx = c.messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
    const at = userIdx[turn];
    if (at === undefined) return undefined;
    const textOf = (content: Anthropic.Beta.BetaMessageParam["content"]) =>
      !content || typeof content === "string"
        ? content ?? ""
        : content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const user = c.messages[at];
    const assistant = c.messages[at + 1];
    const userContent = user.content;
    const question = !userContent || typeof userContent === "string"
      ? userContent ?? ""
      : userContent.flatMap((b) => (b.type === "text" ? [b.text] : [])).at(-1) ?? "";
    return { question, answerText: assistant ? textOf(assistant.content) : "", lang: c.lang };
  }
}

/** Turns Claude's text + citations into answer segments and a numbered source list. */
export function mapAnswer(response: Anthropic.Beta.BetaMessage, documents: KnowledgeItem[]) {
  const sources: AnswerSource[] = [];
  const byDoc = new Map<number, AnswerSource>();
  const segments: AnswerSegment[] = [];

  for (const block of response.content) {
    if (block.type !== "text") continue;
    const refs = new Set<number>();
    for (const c of block.citations ?? []) {
      if (c.type !== "char_location") continue;
      const doc = documents[c.document_index];
      if (!doc) continue;
      let source = byDoc.get(c.document_index);
      if (!source) {
        if (sources.length >= MAX_SOURCES) continue;
        source = { number: sources.length + 1, id: doc.id, title: doc.title, type: doc.type, passages: [] };
        byDoc.set(c.document_index, source);
        sources.push(source);
      }
      const passage = c.cited_text.trim();
      if (passage && !source.passages.includes(passage) && source.passages.length < MAX_PASSAGES_PER_SOURCE) {
        source.passages.push(passage);
      }
      refs.add(source.number);
    }
    const last = segments[segments.length - 1];
    // merge plain consecutive text so the answer reads naturally
    if (last && refs.size === 0 && last.sourceRefs.length === 0) last.text += block.text;
    else segments.push({ text: block.text, sourceRefs: [...refs].sort((a, b) => a - b) });
  }
  return { segments, sources };
}
