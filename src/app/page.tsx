"use client";

import { useState } from "react";
import {
  AppStep,
  TranscriptEntry,
  SegmentGroup,
  LineDecision,
  EditableSegment,
  EditableWord,
  WordTiming,
} from "@/lib/types";
import { generateFCPXML } from "@/lib/xml";
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
 * Map each token in `tokens` to a source WordTiming by finding the first
 * contiguous run of source words that matches the token sequence.
 * Falls back to individual greedy matching if no contiguous run is found.
 */
function matchWordsToSource(
  tokens: string[],
  sourceWords: WordTiming[]
): (WordTiming | undefined)[] {
  if (!sourceWords.length) return tokens.map(() => undefined);

  const normTokens = tokens.map(normalizeWord);
  const normSource = sourceWords.map((w) => normalizeWord(w.word));

  // Find the starting index in sourceWords where the token sequence begins
  let startIdx = -1;
  for (let si = 0; si <= normSource.length - normTokens.length; si++) {
    if (normSource[si] === normTokens[0]) {
      let match = true;
      for (let ti = 1; ti < normTokens.length; ti++) {
        if (normSource[si + ti] !== normTokens[ti]) {
          match = false;
          break;
        }
      }
      if (match) {
        startIdx = si;
        break;
      }
    }
  }

  if (startIdx !== -1) {
    return tokens.map((_, ti) => sourceWords[startIdx + ti]);
  }

  // Fallback: match each token independently (greedy first-match)
  return tokens.map((token) => {
    const norm = normalizeWord(token);
    return sourceWords.find((w) => normalizeWord(w.word) === norm);
  });
}

function buildEditableSegments(
  transcript: TranscriptEntry[],
  decisions: LineDecision[]
): EditableSegment[] {
  const decisionMap = new Map(decisions.map((d) => [d.index, d]));
  return transcript.map((seg, i) => {
    const decision = decisionMap.get(i);
    const action = decision?.action ?? "keep";
    const editedText =
      action === "trim" && decision?.text ? decision.text : seg.text;

    const sourceWords = seg.words ?? [];
    const textTokens = editedText.split(/\s+/).filter(Boolean);

    const matched = matchWordsToSource(textTokens, sourceWords);
    const words: EditableWord[] = textTokens.map((w, j) => ({
      id: `${i}-${j}`,
      text: w,
      removed: false,
      start: matched[j]?.start,
      end: matched[j]?.end,
      confidence: matched[j]?.confidence,
      speaker: matched[j]?.speaker,
    }));

    return {
      originalIndex: i,
      start: seg.start,
      end: seg.end,
      originalText: seg.text,
      editedText,
      action,
      words,
    };
  });
}

export default function Home() {
  const [step, setStep] = useState<AppStep>("browse");
  const [filePath, setFilePath] = useState("");
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(30);
  const [segments, setSegments] = useState<SegmentGroup[]>([]);
  const [editableSegments, setEditableSegments] = useState<EditableSegment[]>(
    []
  );

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
    setEditableSegments(buildEditableSegments(transcript, decisions));
    setStep("edit");
  };

  const handleExport = () => {
    const finalSegments = editableSegments
      .filter((seg) => seg.action !== "remove")
      .map((seg) => {
        const keptWords = seg.words.filter((w) => !w.removed);
        const text = keptWords.map((w) => w.text).join(" ");
        if (!text.trim()) return null;

        const anyWordRemoved = seg.words.some((w) => w.removed);

        let start: number;
        let end: number;

        if (seg.action === "trim" || anyWordRemoved) {
          const firstWord = keptWords.find((w) => w.start != null);
          const lastWord = [...keptWords].reverse().find((w) => w.end != null);
          start = firstWord?.start ?? seg.start;
          end = lastWord?.end ?? seg.end;
        } else {
          start = seg.start;
          end = seg.end;
        }

        return { start, end, text };
      })
      .filter(Boolean) as { start: number; end: number; text: string }[];

    const xml = generateFCPXML(finalSegments, fileName, duration, fps);
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
          <span className="text-lg font-bold tracking-tight">
            ✂️ CLIPPER
          </span>
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
            onComplete={handlePromptComplete}
          />
        )}

        {step === "edit" && (
          <VideoEditor
            segments={editableSegments}
            onChange={setEditableSegments}
            onContinue={() => setStep("export")}
          />
        )}

        {step === "export" && (
          <ExportStep
            segments={editableSegments}
            fileName={fileName}
            duration={duration}
            onExport={handleExport}
          />
        )}
      </div>
    </main>
  );
}
