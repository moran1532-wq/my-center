import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import { createApp } from "../src/app.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";

const app = createApp(new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json")));

describe("knowledge API", () => {
  it("lists all 12 sample items", async () => {
    const res = await request(app).get("/api/knowledge");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(12);
    expect(res.body.every((i: any) => i.isSample)).toBe(true);
    expect(res.body[0].body).toBeUndefined();
  });

  it("filters by type", async () => {
    const counts = await Promise.all(
      ["procedure", "customer_answer", "document"].map(async (t) =>
        (await request(app).get(`/api/knowledge?type=${t}`)).body.length),
    );
    expect(counts).toEqual([5, 4, 3]);
  });

  it("rejects an unknown type", async () => {
    expect((await request(app).get("/api/knowledge?type=x")).status).toBe(400);
  });

  it("searches in Hebrew", async () => {
    const res = await request(app).get("/api/knowledge?q=" + encodeURIComponent("סוללה"));
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns a full item and 404 for missing", async () => {
    const res = await request(app).get("/api/knowledge/doc-spec");
    expect(res.body.body).toContain("IP67");
    expect((await request(app).get("/api/knowledge/nope")).status).toBe(404);
  });
});
