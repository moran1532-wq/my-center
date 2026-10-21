import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.js";
import { authFromEnv } from "./auth.js";
import { JsonKnowledgeStore } from "./store/JsonKnowledgeStore.js";
import { AnswerService, claudeCreateMessage } from "./answer/AnswerService.js";
import { AllDocumentsRetriever } from "./answer/Retriever.js";
import { MemoryConversationStore } from "./answer/ConversationStore.js";
import { randomUUID } from "node:crypto";
import { GapService } from "./gaps/GapService.js";
import { JsonGapStore } from "./gaps/JsonGapStore.js";
import { claudeAnalyzer } from "./gaps/claudeAnalyzer.js";
import { ReportService } from "./reports/ReportService.js";
import { JsonFilePersist } from "./reports/JsonFilePersist.js";
import { PersistedRecipients, PersistedReports, PersistedStats } from "./reports/collections.js";
import { smtpMailerFromEnv } from "./reports/smtpMailer.js";
import { IntakeService } from "./intake/IntakeService.js";
import { claudeAnalyzeDocument, claudeTranslate } from "./intake/claudeIntake.js";
import type { StoredKnowledgeItem } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.KNOWLEDGE_FILE ?? path.join(here, "..", "data", "knowledge.json");
const port = Number(process.env.PORT ?? 3001);

const dataDir = process.env.DATA_DIR ?? path.join(here, "..", "data");
const store = new JsonKnowledgeStore(dataFile, new JsonFilePersist<StoredKnowledgeItem>(path.join(dataDir, "uploaded.json")));

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const answers = client
  ? new AnswerService(claudeCreateMessage(client), new AllDocumentsRetriever(store), new MemoryConversationStore())
  : null;
const stats = new PersistedStats(new JsonFilePersist(path.join(dataDir, "question-stats.json")));
const noAnalyzer = async () => {
  throw new Error("ANTHROPIC_API_KEY is not set");
};
// Gaps can be listed and managed even without a key; only new analysis needs Claude.
const gaps = new GapService(client ? claudeAnalyzer(client) : noAnalyzer, new JsonGapStore(process.env.GAPS_FILE ?? path.join(dataDir, "gaps.json")), randomUUID).withStats(stats);

const mailer = smtpMailerFromEnv();
if (!mailer) console.warn("SMTP_HOST / MAIL_FROM not set - reports are saved but not emailed.");
const recipients = new PersistedRecipients(new JsonFilePersist(path.join(dataDir, "recipients.json")), randomUUID);
const reportService = new ReportService({
  gaps, stats, recipients, mailer, newId: randomUUID,
  reports: new PersistedReports(new JsonFilePersist(path.join(dataDir, "reports.json"))),
});

// Check every 10 minutes whether the 3-day report is due (08:00 Israel time).
const checkReport = () =>
  reportService.tick()
    .then((r) => r && console.log(`Gap report ${r.id} sent (${r.delivery.note})`))
    .catch((e) => console.error("scheduled report failed:", e instanceof Error ? e.message : e));
setInterval(checkReport, 10 * 60 * 1000);
checkReport();
if (!answers) console.warn("ANTHROPIC_API_KEY is not set - questions are disabled until it is.");

const allowedHosts = (process.env.LINK_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
if (!allowedHosts.length) console.warn("LINK_ALLOWED_HOSTS is not set - uploading from links is off.");
const intake = client
  ? new IntakeService({ analyze: claudeAnalyzeDocument(client), translate: claudeTranslate(client), knowledge: store, gaps, newId: randomUUID })
  : null;

const auth = authFromEnv();
if (!process.env.AUTH_MODE) console.warn("AUTH_MODE is not set - every request will be refused. Use AUTH_MODE=proxy (or dev for local work).");
if (process.env.AUTH_MODE === "dev") console.warn("AUTH_MODE=dev - everyone is a knowledge owner. For local development only.");

createApp(store, answers, gaps, { service: reportService, recipients }, intake ? { intake, allowedHosts } : null, auth).listen(port, () => {
  console.log(`Knowledge center server on http://localhost:${port}`);
});
