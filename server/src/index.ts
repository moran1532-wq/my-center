import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.js";
import { JsonKnowledgeStore } from "./store/JsonKnowledgeStore.js";
import { AnswerService, claudeCreateMessage } from "./answer/AnswerService.js";
import { AllDocumentsRetriever } from "./answer/Retriever.js";
import { MemoryConversationStore } from "./answer/ConversationStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.KNOWLEDGE_FILE ?? path.join(here, "..", "data", "knowledge.json");
const port = Number(process.env.PORT ?? 3001);

const store = new JsonKnowledgeStore(dataFile);
const answers = process.env.ANTHROPIC_API_KEY
  ? new AnswerService(claudeCreateMessage(new Anthropic()), new AllDocumentsRetriever(store), new MemoryConversationStore())
  : null;
if (!answers) console.warn("ANTHROPIC_API_KEY is not set - questions are disabled until it is.");

createApp(store, answers).listen(port, () => {
  console.log(`Knowledge center server on http://localhost:${port}`);
});
