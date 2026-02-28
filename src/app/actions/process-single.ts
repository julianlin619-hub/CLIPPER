"use server";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { TranscriptEntry, LineDecision, SpeakerMap } from "@/lib/types";
import { buildCreativeMessage, parseIndexedDecisions } from "@/lib/llm";
import { writeFileSync } from "fs";
import { join } from "path";

const TEMPERATURE = 0.3;

/**
 * Call an LLM (Claude or OpenAI) and return the text response.
 */
async function callLLM(
  model: string,
  systemPrompt: string,
  userMessage: string,
  temperature: number = TEMPERATURE
): Promise<string> {
  if (model.startsWith("claude")) {
    const anthropic = new Anthropic();
    const result = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const block = result.content[0];
    return block.type === "text" ? block.text : "";
  } else {
    const openai = new OpenAI();
    const result = await openai.chat.completions.create({
      model,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    return result.choices[0]?.message?.content ?? "";
  }
}

/**
 * Process one segment group in a single LLM pass.
 *
 * The LLM receives the transcript with [index] prefixes and returns
 * per-utterance decisions (KEEP / REMOVE / TRIM: text) referencing
 * those indices. No diff layer needed.
 */
export async function processSegmentGroup(
  lines: TranscriptEntry[],
  startLineIndex: number,
  editPrompt: string,
  model: string,
  segmentTitle?: string,
  segmentSummary?: string,
  speakerMap?: SpeakerMap
): Promise<LineDecision[]> {
  const indexedLines = lines.map((l, i) => ({
    index: startLineIndex + i,
    text: l.text,
    speaker: l.words?.[0]?.speaker ?? null,
  }));

  const creativeMessage = buildCreativeMessage(
    indexedLines,
    segmentTitle,
    segmentSummary,
    speakerMap
  );

  const rawOutput = await callLLM(
    model,
    editPrompt,
    creativeMessage,
    TEMPERATURE
  );

  if (!rawOutput.trim()) {
    throw new Error("LLM returned empty response");
  }

  const decisions = parseIndexedDecisions(rawOutput, lines.length, startLineIndex);

  // ── Debug log ──
  const decisionLog = decisions
    .map((d) => {
      const src = indexedLines.find((l) => l.index === d.index);
      const label = src?.speaker != null ? `Speaker ${src.speaker}` : "?";
      const preview =
        d.action === "trim"
          ? `"${d.text}"`
          : `"${src?.text?.slice(0, 80)}${(src?.text?.length ?? 0) > 80 ? "…" : ""}"`;
      return `[${d.index}] ${d.action.toUpperCase().padEnd(6)} | ${label} | ${preview}`;
    })
    .join("\n");

  const logContent = [
    "════════════════ INPUT ════════════════",
    creativeMessage,
    "",
    "════════════════ RAW LLM OUTPUT ════════════════",
    rawOutput,
    "",
    "════════════════ PARSED DECISIONS ════════════════",
    decisionLog,
    "════════════════════════════════════════════════",
  ].join("\n");

  try {
    writeFileSync(join(process.cwd(), "debug-last-run.txt"), logContent, "utf8");
  } catch {
    // non-fatal
  }

  return decisions;
}
