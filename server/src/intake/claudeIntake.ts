import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AnalyzeDocument, TranslateDocument } from "./types.js";
import { buildIntakePrompt, buildTranslatePrompt } from "./intakePrompt.js";
import type { UsageMeter } from "../usage/UsageMeter.js";

const Analysis = z.object({
  titleHe: z.string(),
  titleEn: z.string(),
  type: z.enum(["procedure", "document", "customer_answer"]),
  topicHe: z.string(),
  topicEn: z.string(),
  sourceLang: z.enum(["he", "en"]),
  targetGap: z.object({ answers: z.boolean(), explanationHe: z.string(), explanationEn: z.string() }).nullable(),
  alsoAnswersGapIds: z.array(z.string()),
});

export function claudeAnalyzeDocument(client: Anthropic, meter?: UsageMeter): AnalyzeDocument {
  return async (text, target, openGaps) => {
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(Analysis) },
      messages: [{ role: "user", content: buildIntakePrompt(text, target, openGaps) }],
    });
    await meter?.record("doc_analysis", res.model, res.usage).catch(() => undefined);
    if (!res.parsed_output) throw new Error(`document analysis returned no result (${res.stop_reason})`);
    return res.parsed_output;
  };
}

export function claudeTranslate(client: Anthropic, meter?: UsageMeter): TranslateDocument {
  return async (text, to) => {
    // streamed: a long document's translation can take a while
    const res = await client.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 64000,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: buildTranslatePrompt(text, to) }],
      })
      .finalMessage();
    await meter?.record("translation", res.model, res.usage).catch(() => undefined);
    if (res.stop_reason === "max_tokens") throw new Error("translation was cut off");
    const out = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!out) throw new Error(`translation returned no text (${res.stop_reason})`);
    return out;
  };
}
