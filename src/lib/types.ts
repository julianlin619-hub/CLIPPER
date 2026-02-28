// Word-level timestamp from Deepgram
export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number | null;
}

// Transcript entry (utterance from Deepgram)
export interface TranscriptEntry {
  start: number;
  end: number;
  text: string;
  words?: WordTiming[];
}

// Segment group identified by Claude
export interface SegmentGroup {
  id: number;
  title: string;
  startLine: number;
  endLine: number;
  start: number;
  end: number;
  summary: string;
}

// LLM edit decisions — per transcript utterance
export type SegmentAction = "keep" | "remove" | "trim";

export interface LineDecision {
  index: number;
  action: SegmentAction;
  text?: string; // trimmed text when action === "trim"
}

// A single word in the editable transcript.
// Every word carries its own Deepgram start/end timestamp.
// Removing a word excludes exactly that time range from the FCPXML.
export interface EditableWord {
  id: string;
  text: string;
  removed: boolean;
  start: number;           // word-level timestamp from Deepgram (required)
  end: number;             // word-level timestamp from Deepgram (required)
  utteranceIdx: number;    // which source utterance this word belongs to (display grouping only)
  confidence?: number;
  speaker?: number | null;
}

// Speaker name map: Deepgram speaker ID → human-readable label (e.g. "Host", "Guest")
export type SpeakerMap = Record<number, string>;

// App step flow
export type AppStep = "browse" | "transcribe" | "segment" | "prompt" | "edit" | "export";

// Full in-memory app state
export interface ClipperState {
  filePath: string;
  fileName: string;
  transcript: TranscriptEntry[];
  duration: number;
  segments: SegmentGroup[];
}
