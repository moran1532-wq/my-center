import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { KnowledgeStore } from "./store/KnowledgeStore.js";
import type { KnowledgeType } from "./types.js";

const TYPES: KnowledgeType[] = ["procedure", "document", "customer_answer"];

export function createApp(store: KnowledgeStore) {
  const app = express();
  // Only origins listed in ALLOWED_ORIGINS may call the API from a browser.
  // In development the client goes through the Vite proxy, so none are needed.
  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/knowledge", async (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (type && !TYPES.includes(type as KnowledgeType)) {
      return res.status(400).json({ error: "invalid type" });
    }
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined;
    const items = await store.list({ type: type as KnowledgeType | undefined, q });
    // list view does not need the full body
    res.json(items.map(({ body, ...rest }) => ({ ...rest, excerpt: body.slice(0, 160) })));
  });

  app.get("/api/knowledge/:id", async (req, res) => {
    const item = await store.get(req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    res.json(item);
  });

  return app;
}
