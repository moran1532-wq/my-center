import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AnalyzeGap } from "./types.js";
import { buildAnalyzerPrompt } from "./analyzerPrompt.js";

const Verdict = z.object({
  kind: z.enum(["answered", "partial", "no_info", "off_topic"]),
  gapTitleHe: z.string(),
  gapTitleEn: z.string(),
  matchesGapId: z.string().nullable(),
});

export function claudeAnalyzer(client: Anthropic): AnalyzeGap {
  return async (candidate, existing) => {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Verdict) },
      messages: [{ role: "user", content: buildAnalyzerPrompt(candidate, existing) }],
    });
    if (!response.parsed_output) throw new Error(`gap analysis returned no result (${response.stop_reason})`);
    return response.parsed_output;
  };
}
