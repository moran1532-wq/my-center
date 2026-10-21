import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { JsonKnowledgeStore } from "./store/JsonKnowledgeStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.KNOWLEDGE_FILE ?? path.join(here, "..", "data", "knowledge.json");
const port = Number(process.env.PORT ?? 3001);

createApp(new JsonKnowledgeStore(dataFile)).listen(port, () => {
  console.log(`Knowledge center server on http://localhost:${port}`);
});
