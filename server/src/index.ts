import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.js";
import { JsonKnowledgeStore } from "./store/JsonKnowledgeStore.js";
import { AnswerService, claudeCreateMessage } from "./answer/AnswerService.js";
import { AllDocumentsRetriever } from "./answer/Retriever.js";
import { MemoryConversationStore } from "./answer/ConversationStore.js";
import { randomUUID } from "node:crypto";
import { GapService } from "./gaps/GapService.js";
import { JsonGapStore } from "./gaps/JsonGapStore.js";
import { claudeAnalyzer } from "./gaps/claudeAnalyzer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.KNOWLEDGE_FILE ?? path.join(here, "..", "data", "knowledge.json");
const port = Number(process.env.PORT ?? 3001);

const store = new JsonKnowledgeStore(dataFile);
const gapsFile = process.env.GAPS_FILE ?? path.join(here, "..", "data", "gaps.json");
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const answers = client
  ? new AnswerService(claudeCreateMessage(client), new AllDocumentsRetriever(store), new MemoryConversationStore())
  : null;
const gaps = client ? new GapService(claudeAnalyzer(client), new JsonGapStore(gapsFile), randomUUID) : null;
if (!answers) console.warn("ANTHROPIC_API_KEY is not set - questions are disabled until it is.");

createApp(store, answers, gaps).listen(port, () => {
  console.log(`Knowledge center server on http://localhost:${port}`);
});
