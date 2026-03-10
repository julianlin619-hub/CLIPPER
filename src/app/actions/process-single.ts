"use server";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { TranscriptEntry, LineDecision, SpeakerMap } from "@/lib/types";
import { buildCreativeMessage, parseIndexedDecisions } from "@/lib/llm";

const TEMPERATURE = 0.3;

const FRAGMENT_VALIDATION_MODEL = "claude-sonnet-4-20250514";
const FRAGMENT_VALIDATION_SYSTEM = `You are a grammar checker. For each numbered text fragment below, reply with VALID if it begins as a grammatically complete sentence (or a self-contained clause that could open a spoken monologue), or FRAGMENT if it starts mid-sentence or mid-clause (e.g. begins with a lowercase preposition, a dependent clause opener, or is clearly the tail of a prior sentence). Reply ONLY in the format [index] VALID or [index] FRAGMENT, one per line. No explanations.`;

const COMPREHENSION_SYSTEM = `You are a content analyst. Read the following conversation transcript and return a brief structured analysis in 3–5 sentences:
1. The core problem or goal being discussed
2. The key turning point, reframe, or insight
3. The resolution or main takeaway (be specific and concrete — include any numbers, frameworks, or named tactics if present)

This analysis will be used to guide editorial decisions. Do not editorialize or add opinions. Be concise and factual.`;

/**
 * Run a comprehension pass on a segment's lines.
 * Returns a short natural-language summary of the arc, or null on failure.
 * Non-blocking: failures fall back to null (editing proceeds without context).
 */
async function runComprehensionPass(
  lines: TranscriptEntry[],
  model: string
): Promise<string | null> {
  try {
    const prose = lines
      .map((l) => l.text.trim())
      .filter(Boolean)
      .join(' ');

    const anthropic = new Anthropic();
    const result = await anthropic.messages.create({
      model,
      max_tokens: 512,
      temperature: 0,
      system: COMPREHENSION_SYSTEM,
      messages: [{ role: 'user', content: prose }],
    });

    const block = result.content[0];
    return block.type === 'text' ? block.text.trim() : null;
  } catch (err) {
    console.warn('Comprehension pass failed (skipping):', err);
    return null;
  }
}

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
 * Validate boundary lines (TRIM outputs and KEEPs that follow a REMOVE) for
 * mid-sentence fragments. Mutates decisions in place by setting fragmentWarning=true
 * on any line flagged as FRAGMENT. Non-blocking: failures are silently swallowed.
 */
/**
 * Count total words across a slice of TranscriptEntry lines.
 */
function transcriptWordCount(lines: TranscriptEntry[], startIdx: number, endIdx: number): number {
  let count = 0;
  for (let k = startIdx; k <= endIdx && k < lines.length; k++) {
    count += (lines[k]?.text ?? "").split(/\s+/).filter(Boolean).length;
  }
  return count;
}

async function validateFragments(
  decisions: LineDecision[],
  lines: TranscriptEntry[]
): Promise<void> {
  // Collect boundary lines: TRIM outputs + KEEP lines that follow a *substantial* REMOVE.
  // "Substantial" means the removed run has >= 5 words total in the source transcript.
  // This prevents trivial noise clips like "in sorry." or "Okay." from masking real boundaries.
  const boundaries: { index: number; text: string }[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (d.action === "remove") continue;

    const outputText =
      d.action === "trim" ? (d.text ?? lines[i]?.text ?? "") : (lines[i]?.text ?? "");

    const isTrim = d.action === "trim";

    // Walk backward over the preceding REMOVE run, skipping trivial gaps,
    // to find the last substantial removed block (>= 5 words).
    let prevIsSubstantialRemove = false;
    if (i > 0 && decisions[i - 1].action === "remove") {
      // Find the full preceding remove run
      let runEnd = i - 1;
      let runStart = runEnd;
      while (runStart > 0 && decisions[runStart - 1].action === "remove") runStart--;

      const removedWords = transcriptWordCount(lines, runStart, runEnd);

      if (removedWords >= 5) {
        // Substantial remove — this is a real boundary
        prevIsSubstantialRemove = true;
      } else {
        // Trivial remove (noise/filler) — look further back for the last kept line
        // and check whether THAT was preceded by a substantial remove.
        // If so, the current KEEP line is still a boundary fragment.
        let lookback = runStart - 1;
        while (lookback >= 0 && decisions[lookback].action !== "remove") lookback--;
        if (lookback >= 0) {
          let lb_end = lookback;
          let lb_start = lb_end;
          while (lb_start > 0 && decisions[lb_start - 1].action === "remove") lb_start--;
          const lb_words = transcriptWordCount(lines, lb_start, lb_end);
          if (lb_words >= 5) prevIsSubstantialRemove = true;
        }
      }
    }

    if (isTrim || prevIsSubstantialRemove) {
      boundaries.push({ index: d.index, text: outputText });
    }
  }

  if (boundaries.length === 0) return;

  try {
    const anthropic = new Anthropic();
    const userMessage = boundaries.map((b) => `[${b.index}] ${b.text}`).join("\n");

    const result = await anthropic.messages.create({
      model: FRAGMENT_VALIDATION_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: FRAGMENT_VALIDATION_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const responseText =
      result.content[0]?.type === "text" ? result.content[0].text : "";

    const decisionMap = new Map(decisions.map((d) => [d.index, d]));
    const linePattern = /^\[(\d+)\]\s+(VALID|FRAGMENT)$/im;

    for (const line of responseText.split("\n")) {
      const match = line.trim().match(linePattern);
      if (!match) continue;
      const idx = parseInt(match[1], 10);
      if (match[2].toUpperCase() === "FRAGMENT") {
        const d = decisionMap.get(idx);
        if (d) d.fragmentWarning = true;
      }
    }
  } catch (err) {
    // Validation is non-blocking — log and continue
    console.warn("Fragment validation failed (skipping):", err);
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

  // ── Comprehension pass (non-blocking) ──────────────────────────────────
  // Read the segment as flowing prose first, so the edit LLM has global
  // context about the arc before making per-utterance decisions.
  const comprehensionSummary = await runComprehensionPass(lines, model);

  const creativeMessage = buildCreativeMessage(
    indexedLines,
    segmentTitle,
    segmentSummary,
    speakerMap
  );

  // Prepend the comprehension summary as context for the editing pass.
  const editMessage = comprehensionSummary
    ? `## Global Arc Summary (read before editing)
${comprehensionSummary}

${creativeMessage}`
    : creativeMessage;

  const rawOutput = await callLLM(
    model,
    editPrompt,
    editMessage,
    TEMPERATURE
  );

  if (!rawOutput.trim()) {
    throw new Error("LLM returned empty response");
  }

  const { decisions } = parseIndexedDecisions(rawOutput, lines.length, startLineIndex);

  // ── Fragment validation (non-blocking) ───────────────────────────────────
  await validateFragments(decisions, lines);

  return decisions;
}
