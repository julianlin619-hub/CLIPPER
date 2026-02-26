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

// LLM edit decisions — per transcript line
export type SegmentAction = "keep" | "remove" | "trim";

export interface LineDecision {
  index: number;
  action: SegmentAction;
  text?: string; // only present when action === "trim"
}

// Per-word in the editable transcript
export interface EditableWord {
  id: string;
  text: string;
  removed: boolean;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: number | null;
}

// Editable segment — built from transcript + LLM decisions
export interface EditableSegment {
  originalIndex: number;
  start: number;
  end: number;
  originalText: string;
  editedText: string;
  action: SegmentAction;
  words: EditableWord[];
}

// App step flow
export type AppStep = "browse" | "transcribe" | "segment" | "prompt" | "edit" | "export";

// Full in-memory app state (replaces .vseg files)
export interface ClipperState {
  filePath: string;
  fileName: string;
  transcript: TranscriptEntry[];
  duration: number;
  segments: SegmentGroup[];
}
