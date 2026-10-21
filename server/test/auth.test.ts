import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import { authFromEnv } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";
import { GapService } from "../src/gaps/GapService.js";
import { MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import { ReportService } from "../src/reports/ReportService.js";
import { MemoryPersist, PersistedRecipients, PersistedReports, PersistedStats } from "../src/reports/collections.js";

const SECRET = "s3cret-s3cret-s3cret";
const store = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"));
const gaps = new GapService(async () => { throw new Error("x"); }, new MemoryGapStore(), () => "g");
const recipients = new PersistedRecipients(new MemoryPersist(), () => "r");
const reporting = { recipients, service: new ReportService({ gaps, stats: new PersistedStats(new MemoryPersist()), recipients,
  reports: new PersistedReports(new MemoryPersist()), mailer: null, newId: () => "rep" }) };
const appWith = (env: Record<string, string>) => createApp(store, null, gaps, reporting, null, authFromEnv(env));

describe("sign-in", () => {
  it("refuses everything when not configured", async () => {
    const res = await request(appWith({})).get("/api/knowledge");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("auth_not_configured");
  });

  it("proxy mode: needs the shared secret and a user", async () => {
    const app = appWith({ AUTH_MODE: "proxy", AUTH_PROXY_SECRET: SECRET });
    expect((await request(app).get("/api/knowledge").set("x-user-email", "a@wint.ai")).status).toBe(401);
    expect((await request(app).get("/api/knowledge").set("x-auth-secret", "wrong-wrong-wrong-wr").set("x-user-email", "a@wint.ai")).status).toBe(401);
    expect((await request(app).get("/api/knowledge").set("x-auth-secret", SECRET)).status).toBe(401);
    const ok = await request(app).get("/api/me").set("x-auth-secret", SECRET).set("x-user-email", "a@wint.ai");
    expect(ok.body.role).toBe("member");
  });

  it("team members can ask and read; only knowledge owners change things", async () => {
    const app = appWith({ AUTH_MODE: "proxy", AUTH_PROXY_SECRET: SECRET });
    const as = (role: string) => (r: request.Test) => r.set("x-auth-secret", SECRET).set("x-user-email", "a@wint.ai").set("x-user-role", role);
    const member = as("member");
    const owner = as("owner");
    expect((await member(request(app).get("/api/knowledge"))).status).toBe(200);
    expect((await member(request(app).get("/api/gaps"))).status).toBe(200);
    expect((await member(request(app).post("/api/recipients").send({ name: "x", email: "x@wint.ai" }))).status).toBe(403);
    expect((await member(request(app).post("/api/reports"))).status).toBe(403);
    expect((await member(request(app).post("/api/gaps/g/dismiss"))).status).toBe(403);
    expect((await member(request(app).post("/api/uploads/preview").field("text", "x"))).status).toBe(403);
    expect((await owner(request(app).post("/api/recipients").send({ name: "x", email: "x@wint.ai" }))).status).toBe(200);
    expect((await owner(request(app).get("/api/me"))).body.role).toBe("owner");
  });

  it("bad configurations stop the server from starting", () => {
    expect(() => authFromEnv({ AUTH_MODE: "proxy" })).toThrow();
    expect(() => authFromEnv({ AUTH_MODE: "proxy", AUTH_PROXY_SECRET: "short" })).toThrow();
    expect(() => authFromEnv({ AUTH_MODE: "dev", NODE_ENV: "production" })).toThrow();
  });
});

describe("guard", () => {
  it("every route that changes data is owner-only, except asking and feedback", () => {
    const app = appWith({ AUTH_MODE: "dev" }) as any;
    const routes: { path: string; method: string; names: string[] }[] = [];
    for (const layer of app._router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ path: layer.route.path, method, names: layer.route.stack.map((l: any) => l.name) });
      }
    }
    const writes = routes.filter((r) => r.method !== "get" && !["/api/ask", "/api/feedback"].includes(r.path));
    expect(writes.length).toBeGreaterThanOrEqual(7);
    for (const r of writes) expect(r.names, `${r.method.toUpperCase()} ${r.path}`).toContain("ownerOnly");
    expect(routes.find((r) => r.path === "/api/recipients" && r.method === "get")!.names).toContain("ownerOnly");
  });
});
