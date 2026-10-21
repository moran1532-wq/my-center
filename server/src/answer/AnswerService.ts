import type Anthropic from "@anthropic-ai/sdk";
import type { KnowledgeItem, Lang } from "../types.js";
import type { ConversationStore } from "./ConversationStore.js";
import type { Retriever } from "./Retriever.js";
import { SYSTEM_PROMPT } from "./prompt.js";

export const MODEL = "claude-opus-5-5";
const MAX_SOURCES = 3;
const MAX_PASSAGES_PER_SOURCE = 3;

/** The single Claude call the service needs - injectable so tests never call the real API. */
export type CreateMessage = (
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

export function claudeCreateMessage(client: Anthropic): CreateMessage {
  return (params) => client.beta.messages.stream(params).finalMessage();
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

export interface AskResult {
  conversationId: string;
  status: "answered" | "declined";
  segments: AnswerSegment[];
  sources: AnswerSource[];
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
      const docs = await this.retriever.documentsFor(input.question, input.lang);
      conversation = await this.conversations.create(input.lang, docs);
      conversation.messages.push({
        role: "user",
        content: [
          ...docs.map((d, i) => documentBlock(d, i === docs.length - 1)),
          { type: "text", text: input.question },
        ],
      });
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

    if (response.stop_reason === "refusal") {
      return { conversationId: conversation.id, status: "declined", segments: [], sources: [] };
    }
    return { conversationId: conversation.id, status: "answered", ...mapAnswer(response, conversation.documents) };
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
