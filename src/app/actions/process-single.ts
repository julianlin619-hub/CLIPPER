"use server";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { TranscriptEntry, LineDecision } from "@/lib/types";
import { getSystemPrompt, buildSegmentMessage, parseDecisions } from "@/lib/llm";

/**
 * Process one segment group — sends all its transcript lines to the LLM
 * in a single call and gets back per-line decisions.
 */
export async function processSegmentGroup(
  lines: TranscriptEntry[],
  startLineIndex: number,
  editPrompt: string,
  model: string,
  segmentTitle?: string,
  segmentSummary?: string
): Promise<LineDecision[]> {
  const indexedLines = lines.map((l, i) => ({
    index: startLineIndex + i,
    text: l.text,
  }));

  const userMessage = buildSegmentMessage(
    indexedLines,
    editPrompt,
    segmentTitle,
    segmentSummary
  );
  let response: string;

  if (model.startsWith("claude")) {
    const anthropic = new Anthropic();
    const result = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: getSystemPrompt(),
      messages: [{ role: "user", content: userMessage }],
    });
    const block = result.content[0];
    response = block.type === "text" ? block.text : "";
  } else {
    const openai = new OpenAI();
    const result = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: userMessage },
      ],
    });
    response = result.choices[0]?.message?.content ?? "";
  }

  return parseDecisions(response);
}
