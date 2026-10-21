import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { KnowledgeItem, Lang } from "../types.js";

export interface Conversation {
  id: string;
  lang: Lang;
  /** Documents frozen at the first question: keeps citation numbers stable and the cache warm. */
  documents: KnowledgeItem[];
  /** Full history, assistant turns kept exactly as returned (required by the API). */
  messages: Anthropic.Beta.BetaMessageParam[];
  updatedAt: number;
}

export interface ConversationStore {
  create(lang: Lang, documents: KnowledgeItem[]): Promise<Conversation>;
  get(id: string): Promise<Conversation | undefined>;
  save(conversation: Conversation): Promise<void>;
}

/** In-memory store. Conversations expire after `ttlMs` of inactivity. */
export class MemoryConversationStore implements ConversationStore {
  private readonly items = new Map<string, Conversation>();

  constructor(
    private readonly ttlMs = 2 * 60 * 60 * 1000,
    private readonly maxItems = 1000,
  ) {}

  private sweep() {
    const now = Date.now();
    for (const [id, c] of this.items) if (now - c.updatedAt > this.ttlMs) this.items.delete(id);
    while (this.items.size > this.maxItems) this.items.delete(this.items.keys().next().value!);
  }

  async create(lang: Lang, documents: KnowledgeItem[]): Promise<Conversation> {
    this.sweep();
    const c: Conversation = { id: randomUUID(), lang, documents, messages: [], updatedAt: Date.now() };
    this.items.set(c.id, c);
    return c;
  }

  async get(id: string) {
    this.sweep();
    return this.items.get(id);
  }

  async save(c: Conversation) {
    c.updatedAt = Date.now();
    this.items.set(c.id, c);
  }
}
