"use client";

import { useState } from "react";
import {
  AppStep,
  TranscriptEntry,
  SegmentGroup,
  LineDecision,
  EditableWord,
  WordTiming,
  SpeakerMap,
} from "@/lib/types";
import { generateFCPXML } from "@/lib/xml";
import { computeFinalClips } from "@/lib/export";
import { autoDetectSpeakers } from "@/lib/speaker-utils";
import FileBrowser from "@/components/file-browser";
import TranscribeStep from "@/components/transcribe-step";
import SegmentStep from "@/components/segment-step";
import PromptStep from "@/components/prompt-step";
import VideoEditor from "@/components/video-editor";
import ExportStep from "@/components/export-step";

/** Strip punctuation + lowercase for fuzzy word matching */
function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build a flat array of EditableWords from the transcript and LLM decisions.
 *
 * - "remove" utterances: all words marked removed=true
 * - "keep" utterances: all words marked removed=false
 * - "trim" utterances: greedy forward scan to match trimmed text against source
 *   words (non-contiguous OK); unmatched words marked removed; on failure keep all.
 *
 * If an utterance has no word-level data, timestamps are interpolated
 * evenly across the utterance duration as a fallback.
 */
function buildEditableWords(
  transcript: TranscriptEntry[],
  decisions: LineDecision[]
): EditableWord[] {
  const decisionMap = new Map(decisions.map((d) => [d.index, d]));
  const allWords: EditableWord[] = [];

  transcript.forEach((seg, utteranceIdx) => {
    const decision = decisionMap.get(utteranceIdx);
    const action = decision?.action ?? "keep";

    // Resolve word-level data; synthesize if missing
    const sourceWords: WordTiming[] =
      seg.words && seg.words.length > 0
        ? seg.words
        : seg.text
            .split(/\s+/)
            .filter(Boolean)
            .map((w, i, arr) => {
              const d = (seg.end - seg.start) / arr.length;
              return {
                word: w,
                start: seg.start + i * d,
                end: seg.start + (i + 1) * d,
              };
            });

    // Determine which word indices to mark removed
    let removedIndices: "all" | "none" | Set<number> = "none";

    if (action === "remove") {
      removedIndices = "all";
    } else if (action === "trim" && decision?.text) {
      const trimTokens = decision.text.split(/\s+/).filter(Boolean).map(normalizeWord);
      const normSource = sourceWords.map((w) => normalizeWord(w.word));

      // Greedy forward scan: match each trim token to the earliest unused
      // source word. This handles non-contiguous trims (filler removed from
      // the middle of an utterance) which the old contiguous matcher missed.
      const kept = new Set<number>();
      let si = 0;
      for (const trimWord of trimTokens) {
        while (si < normSource.length) {
          if (normSource[si] === trimWord) {
            kept.add(si);
            si++;
            break;
          }
          si++;
        }
      }

      // Accept if we matched at least 60% of the trim tokens.
      // Below that, the LLM likely rewrote too much — fall back to keep all.
      if (kept.size >= trimTokens.length * 0.6) {
        const removed = new Set<number>();
        sourceWords.forEach((_, i) => {
          if (!kept.has(i)) removed.add(i);
        });
        removedIndices = removed;
      }
      // else: match failed → keep all (safe fallback)
    }

    sourceWords.forEach((w, wi) => {
      const removed =
        removedIndices === "all"
          ? true
          : removedIndices === "none"
          ? false
          : removedIndices.has(wi);

      allWords.push({
        id: `${utteranceIdx}-${wi}`,
        text: w.word,
        removed,
        start: w.start,
        end: w.end,
        utteranceIdx,
        confidence: w.confidence,
        speaker: w.speaker,
      });
    });
  });

  return allWords;
}

export default function Home() {
  const [step, setStep] = useState<AppStep>("browse");
  const [filePath, setFilePath] = useState("");
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(30);
  const [speakerMap, setSpeakerMap] = useState<SpeakerMap>({});
  const [segments, setSegments] = useState<SegmentGroup[]>([]);
  const [editableWords, setEditableWords] = useState<EditableWord[]>([]);
  const [decisions, setDecisions] = useState<LineDecision[]>([]);

  const handleFileSelected = (path: string, name: string) => {
    setFilePath(path);
    setFileName(name);
    setStep("transcribe");
  };

  const handleTranscribeComplete = (
    t: TranscriptEntry[],
    d: number,
    frameRate: number = 30
  ) => {
    setTranscript(t);
    setDuration(d);
    setFps(frameRate);
    setSpeakerMap(autoDetectSpeakers(t));
    setStep("segment");
  };

  const handleSegmentComplete = (segs: SegmentGroup[]) => {
    setSegments(segs);
    setStep("prompt");
  };

  const handleSegmentSkip = () => {
    setSegments([]);
    setStep("prompt");
  };

  const handlePromptComplete = (decisions: LineDecision[]) => {
    setDecisions(decisions);
    setEditableWords(buildEditableWords(transcript, decisions));
    setStep("edit");
  };

  const handleExport = () => {
    const clips = computeFinalClips(editableWords);
    const xml = generateFCPXML(clips, fileName, duration, fps);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.\w+$/, "")}_edited.fcpxml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stepLabels: { key: AppStep; label: string }[] = [
    { key: "browse", label: "1. Select Video" },
    { key: "transcribe", label: "2. Transcribe" },
    { key: "segment", label: "3. Segment" },
    { key: "prompt", label: "4. LLM Edit" },
    { key: "edit", label: "5. Edit" },
    { key: "export", label: "6. Export" },
  ];

  const stepOrder: AppStep[] = [
    "browse",
    "transcribe",
    "segment",
    "prompt",
    "edit",
    "export",
  ];
  const currentIdx = stepOrder.indexOf(step);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      {/* Top bar */}
      <div className="border-b border-neutral-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">✂️ CLIPPER</span>
          <div className="flex items-center gap-1.5 ml-4">
            {stepLabels.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const targetIdx = stepOrder.indexOf(s.key);
                    if (targetIdx <= currentIdx) setStep(s.key);
                  }}
                  disabled={stepOrder.indexOf(s.key) > currentIdx}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    step === s.key
                      ? "bg-white text-black font-medium"
                      : stepOrder.indexOf(s.key) < currentIdx
                      ? "text-neutral-400 hover:text-neutral-200 cursor-pointer"
                      : "text-neutral-700 cursor-not-allowed"
                  }`}
                >
                  {s.label}
                </button>
                {i < stepLabels.length - 1 && (
                  <span className="text-neutral-800">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {step === "browse" && (
          <FileBrowser onFileSelected={handleFileSelected} />
        )}

        {step === "transcribe" && (
          <TranscribeStep
            filePath={filePath}
            fileName={fileName}
            onComplete={handleTranscribeComplete}
          />
        )}

        {step === "segment" && (
          <SegmentStep
            transcript={transcript}
            onComplete={handleSegmentComplete}
            onSkip={handleSegmentSkip}
          />
        )}

        {step === "prompt" && (
          <PromptStep
            transcript={transcript}
            segments={segments}
            speakerMap={speakerMap}
            onComplete={handlePromptComplete}
          />
        )}

        {step === "edit" && (
          <VideoEditor
            words={editableWords}
            onChange={setEditableWords}
            onContinue={() => setStep("export")}
          />
        )}

        {step === "export" && (
          <ExportStep
            words={editableWords}
            fileName={fileName}
            duration={duration}
            onExport={handleExport}
            transcript={transcript}
          />
        )}
      </div>
    </main>
  );
}
