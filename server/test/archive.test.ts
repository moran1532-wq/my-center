import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import { JsonKnowledgeStore, type ArchiveEntry } from "../src/store/JsonKnowledgeStore.js";
import { MemoryPersist } from "../src/reports/collections.js";
import { GapService } from "../src/gaps/GapService.js";
import { MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import { SmartRetriever } from "../src/answer/Retriever.js";
import { createApp } from "../src/app.js";
import { authFromEnv } from "../src/auth.js";
import type { StoredKnowledgeItem } from "../src/types.js";

function setup() {
  const store = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"),
    new MemoryPersist<StoredKnowledgeItem>(), new MemoryPersist<ArchiveEntry>());
  const gaps = new GapService(async () => ({ kind: "no_info", gapTitleHe: "אחריות", gapTitleEn: "Warranty", matchesGapId: null }), new MemoryGapStore(), () => "g1");
  return { store, gaps, app: createApp(store, null, gaps) };
}

describe("removing documents", () => {
  it("a removed document leaves the list, search and Claude's reading; restore brings it back", async () => {
    const t = setup();
    const v0 = await t.store.version();
    const res = await request(t.app).post("/api/knowledge/doc-spec/archive");
    expect(res.status).toBe(200);
    expect((await request(t.app).get("/api/knowledge")).body).toHaveLength(11);
    expect((await new SmartRetriever(t.store).documentsFor("IP67", "he")).map((d) => d.id)).not.toContain("doc-spec");
    expect(await t.store.version()).not.toBe(v0); // remembered answers are dropped
    const item = await request(t.app).get("/api/knowledge/doc-spec");
    expect(item.status).toBe(200); // old links still open
    expect(item.body.archived).toBe(true);
    expect((await request(t.app).get("/api/knowledge-archived")).body.map((d: any) => d.id)).toEqual(["doc-spec"]);

    expect((await request(t.app).post("/api/knowledge/doc-spec/restore")).status).toBe(200);
    expect((await request(t.app).get("/api/knowledge")).body).toHaveLength(12);
    expect((await request(t.app).get("/api/knowledge-archived")).body).toHaveLength(0);
  });

  it("gaps the document closed open again", async () => {
    const t = setup();
    await t.store.add({ id: "up-1", type: "document", updatedAt: "2026-11-01", isSample: false, title: "אחריות", topic: "", owner: "", body: "24 חודשים" });
    const gap = (await t.gaps.consider({ question: "מה האחריות?", answerText: "", lang: "he", notHelpful: false }))!;
    await t.gaps.close(gap.id, "up-1");
    const res = await request(t.app).post("/api/knowledge/up-1/archive");
    expect(res.body.reopened.map((g: any) => g.id)).toEqual([gap.id]);
    expect((await request(t.app).get("/api/gaps")).body).toHaveLength(1);
    const back = await request(t.app).post("/api/knowledge/up-1/restore");
    expect(back.body.reclosed).toEqual([gap.id]);
    expect((await request(t.app).get("/api/gaps")).body).toHaveLength(0);
  });

  it("unknown ids are 404; team members can't remove or restore", async () => {
    const t = setup();
    expect((await request(t.app).post("/api/knowledge/nope/archive")).status).toBe(404);
    const SECRET = "s3cret-s3cret-s3cret";
    const app = createApp(t.store, null, t.gaps, null, null, authFromEnv({ AUTH_MODE: "proxy", AUTH_PROXY_SECRET: SECRET }));
    const member = (r: request.Test) => r.set("x-auth-secret", SECRET).set("x-user-email", "a@wint.ai");
    expect((await member(request(app).post("/api/knowledge/doc-spec/archive"))).status).toBe(403);
    expect((await member(request(app).post("/api/knowledge/doc-spec/restore"))).status).toBe(403);
    expect((await member(request(app).get("/api/knowledge-archived"))).status).toBe(403);
  });
});
