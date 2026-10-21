import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../src/app.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";
import { AnswerService, ConversationTooLongError, MAX_QUESTIONS_PER_CONVERSATION, MODEL, type CreateMessage } from "../src/answer/AnswerService.js";
import { AllDocumentsRetriever } from "../src/answer/Retriever.js";
import { MemoryConversationStore } from "../src/answer/ConversationStore.js";

const store = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"));

function cite(docIndex: number, text: string) {
  return { type: "char_location", cited_text: text, document_index: docIndex, document_title: "t",
           start_char_index: 0, end_char_index: text.length, file_id: null } as const;
}

function fakeClaude(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params));
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { id: "msg", type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn",
             content: [], usage: {} as any, ...r } as Anthropic.Beta.BetaMessage;
  };
  return { create, calls };
}

function appWith(create: CreateMessage) {
  const service = new AnswerService(create, new AllDocumentsRetriever(store), new MemoryConversationStore());
  return createApp(store, service);
}

describe("ask", () => {
  it("sends all documents with citations and caching, then maps citations to sources", async () => {
    const fake = fakeClaude([{
      content: [
        { type: "thinking", thinking: "", signature: "sig" } as any,
        { type: "text", text: "קודם בודקים את סוג הדליפה. ", citations: [cite(0, "לבדוק את סוג הדליפה")] },
        { type: "text", text: "ואז מתקשרים לאיש הקשר.", citations: [cite(0, "להתקשר לאיש הקשר"), cite(2, "פקודת סגירה")] },
      ],
    }]);
    const res = await request(appWith(fake.create)).post("/api/ask").send({ question: "מה עושים בהתראת דליפה?", lang: "he" });
    expect(res.status).toBe(200);
    const sent = fake.calls[0];
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.fallbacks).toBe("default");
    const blocks = sent.messages[0].content as any[];
    expect(blocks.filter((b) => b.type === "document")).toHaveLength(12);
    expect(blocks.every((b) => b.type !== "document" || b.citations?.enabled)).toBe(true);
    expect(blocks[11].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks.at(-1)).toEqual({ type: "text", text: "מה עושים בהתראת דליפה?" });

    expect(res.body.status).toBe("answered");
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.sources[0].passages).toEqual(["לבדוק את סוג הדליפה", "להתקשר לאיש הקשר"]);
    expect(res.body.segments[1].sourceRefs).toEqual([1, 2]);
  });

  it("keeps the conversation for follow-ups, assistant turn unchanged", async () => {
    const fake = fakeClaude([
      { content: [{ type: "thinking", thinking: "", signature: "s1" } as any, { type: "text", text: "a", citations: null }] },
      { content: [{ type: "text", text: "b", citations: null }] },
    ]);
    const app = appWith(fake.create);
    const first = await request(app).post("/api/ask").send({ question: "q1", lang: "he" });
    const second = await request(app).post("/api/ask").send({ question: "q2", lang: "he", conversationId: first.body.conversationId });
    expect(second.body.conversationId).toBe(first.body.conversationId);
    const msgs = fake.calls[1].messages;
    expect(msgs).toHaveLength(3);
    expect((msgs[1].content as any[])[0]).toMatchObject({ type: "thinking", signature: "s1" });
    expect(msgs[2]).toEqual({ role: "user", content: "q2" });
  });

  it("caps sources at 3", async () => {
    const fake = fakeClaude([{ content: [{ type: "text", text: "x", citations: [0, 1, 2, 3, 4].map((i) => cite(i, "p" + i)) }] }]);
    const res = await request(appWith(fake.create)).post("/api/ask").send({ question: "q", lang: "he" });
    expect(res.body.sources).toHaveLength(3);
  });

  it("reports a declined answer", async () => {
    const fake = fakeClaude([{ stop_reason: "refusal", content: [] }]);
    const res = await request(appWith(fake.create)).post("/api/ask").send({ question: "q", lang: "en" });
    expect(res.body.status).toBe("declined");
  });

  it("validates input and handles unknown conversations", async () => {
    const app = appWith(fakeClaude([{ content: [] }]).create);
    expect((await request(app).post("/api/ask").send({ question: "" })).status).toBe(400);
    expect((await request(app).post("/api/ask").send({ question: "x".repeat(2001) })).status).toBe(400);
    expect((await request(app).post("/api/ask").send({ question: "q", conversationId: "nope" })).status).toBe(404);
  });

  it("says when there is no key", async () => {
    const res = await request(createApp(store, null)).post("/api/ask").send({ question: "q" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("no_key");
  });

  it("sends English documents when the screen is in English", async () => {
    const fake = fakeClaude([{ content: [] }]);
    await request(appWith(fake.create)).post("/api/ask").send({ question: "What is IP67?", lang: "en" });
    const docs = (fake.calls[0].messages[0].content as any[]).filter((b) => b.type === "document");
    expect(docs.some((d) => d.title === "Product Specification - Monitoring and Shutoff Unit")).toBe(true);
  });
});

describe("cost limits", () => {
  it("caps questions per conversation", async () => {
    const service = new AnswerService(
      fakeClaude([{ content: [{ type: "text", text: "a", citations: null }] }]).create,
      new AllDocumentsRetriever(store),
      new MemoryConversationStore(),
    );
    const first = await service.ask({ question: "q", lang: "he" });
    for (let i = 1; i < MAX_QUESTIONS_PER_CONVERSATION; i++) {
      await service.ask({ question: "q", lang: "he", conversationId: first.conversationId });
    }
    await expect(service.ask({ question: "q", lang: "he", conversationId: first.conversationId }))
      .rejects.toBeInstanceOf(ConversationTooLongError);
  });
});
