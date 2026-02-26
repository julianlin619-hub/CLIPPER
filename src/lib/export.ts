import { EditableWord } from "@/lib/types";

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/**
 * Merge consecutive kept words into contiguous clips.
 *
 * A new clip starts wherever one or more removed words create a gap.
 * Words are processed in their original order, so the output is a
 * time-ordered list of { start, end, text } clips ready for FCPXML.
 */
export function computeFinalClips(
  words: EditableWord[]
): { start: number; end: number; text: string }[] {
  const clips: { start: number; end: number; text: string }[] = [];
  let current: { start: number; end: number; words: string[] } | null = null;

  for (const word of words) {
    if (word.removed) {
      if (current) {
        clips.push({ start: current.start, end: current.end, text: current.words.join(" ") });
        current = null;
      }
    } else {
      if (!current) {
        current = { start: word.start, end: word.end, words: [word.text] };
      } else {
        current.end = word.end;
        current.words.push(word.text);
      }
    }
  }
  if (current) {
    clips.push({ start: current.start, end: current.end, text: current.words.join(" ") });
  }

  return clips;
}

/**
 * Generate a human-readable debug report showing every kept vs cut block.
 */
export function generateDebugTXT(
  words: EditableWord[],
  fileName: string,
  totalDuration: number
): string {
  const clips = computeFinalClips(words);
  const exportedDuration = clips.reduce((a, c) => a + (c.end - c.start), 0);
  const cutDuration = totalDuration - exportedDuration;
  const pctKept = totalDuration > 0 ? Math.round((exportedDuration / totalDuration) * 100) : 0;
  const keptWords = words.filter((w) => !w.removed).length;
  const removedWords = words.filter((w) => w.removed).length;

  const lines: string[] = [];
  const hr = "─".repeat(60);

  lines.push("CLIPPER EXPORT DEBUG REPORT (word-level)");
  lines.push("═".repeat(60));
  lines.push(`File:              ${fileName}`);
  lines.push(`Original duration: ${fmt(totalDuration)}`);
  lines.push(`Exported duration: ${fmt(exportedDuration)}  (${pctKept}% kept)`);
  lines.push(`Cut:               ${fmt(cutDuration)}  (${100 - pctKept}% removed)`);
  lines.push(`Total words:       ${words.length}  (kept: ${keptWords}, removed: ${removedWords})`);
  lines.push(`Output clips:      ${clips.length}  (each clip = contiguous run of kept words)`);
  lines.push("");
  lines.push("═".repeat(60));
  lines.push("TIMELINE  (K=kept, X=cut)");
  lines.push(hr);

  // Group consecutive same-state words into blocks for readability
  type Block = { kind: "keep" | "cut"; words: EditableWord[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;

  for (const word of words) {
    const kind: "keep" | "cut" = word.removed ? "cut" : "keep";
    if (!cur || cur.kind !== kind) {
      if (cur) blocks.push(cur);
      cur = { kind, words: [word] };
    } else {
      cur.words.push(word);
    }
  }
  if (cur) blocks.push(cur);

  let clipNum = 0;
  for (const block of blocks) {
    const start = block.words[0].start;
    const end = block.words[block.words.length - 1].end;
    const dur = (end - start).toFixed(2);
    const text = block.words.map((w) => w.text).join(" ");

    if (block.kind === "keep") {
      clipNum++;
      lines.push(`[K #${clipNum.toString().padStart(3, "0")}]  ${fmt(start)} → ${fmt(end)}  (${dur}s)`);
      lines.push(`         "${text}"`);
    } else {
      lines.push(`[X CUT]  ${fmt(start)} → ${fmt(end)}  (${dur}s)`);
      lines.push(`         "${text}"`);
    }
    lines.push("");
  }

  lines.push(hr);
  lines.push(`END — ${clipNum} clips · ${fmt(exportedDuration)} kept of ${fmt(totalDuration)} total`);

  return lines.join("\n");
}
