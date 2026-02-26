import { LineDecision } from "@/lib/types";

const SYSTEM_PROMPT = `You are a video transcript editor. You will receive a segment of a transcript (multiple lines, each with an index) and a user editing instruction.

For EACH line, decide one of three actions:
- "keep" — leave the line unchanged
- "remove" — delete the line entirely  
- "trim" — edit/shorten the text (you MUST provide the new text)

CRITICAL RULES:
1. You must return a decision for EVERY line
2. You must NOT include any timecode/timestamp information — only index, action, and optionally text
3. For "trim", the new text must be a subset or rephrasing of the original — do not add new content
4. Return ONLY a valid JSON array, no markdown, no explanation

Response format:
[
  { "index": 0, "action": "keep" },
  { "index": 1, "action": "remove" },
  { "index": 2, "action": "trim", "text": "shortened text" }
]`;

/**
 * Build the user message for a segment group (all its transcript lines)
 */
export function buildSegmentMessage(
  lines: { index: number; text: string }[],
  editPrompt: string,
  segmentTitle?: string,
  segmentSummary?: string
): string {
  const context = segmentTitle
    ? `## Segment: ${segmentTitle}${segmentSummary ? `\n${segmentSummary}` : ""}\n\n`
    : "";

  const lineList = lines
    .map((l) => `[${l.index}] ${l.text}`)
    .join("\n");

  return `## Editing Instruction
${editPrompt}

${context}## Transcript Lines
${lineList}`;
}

/**
 * Parse LLM response into line decisions
 */
export function parseDecisions(response: string): LineDecision[] {
  let cleaned = response.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const decisions: LineDecision[] = JSON.parse(cleaned);

  for (const d of decisions) {
    if (typeof d.index !== "number") throw new Error("Invalid decision: missing index");
    if (!["keep", "remove", "trim"].includes(d.action)) {
      throw new Error(`Invalid action "${d.action}" for line ${d.index}`);
    }
    if (d.action === "trim" && !d.text) {
      throw new Error(`Line ${d.index} is "trim" but missing text`);
    }
  }

  return decisions;
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
