"use client";

import { useMemo, useState } from "react";
import { EditableWord } from "@/lib/types";
import { computeFinalClips } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  words: EditableWord[];
  onChange: (words: EditableWord[]) => void;
  onContinue: () => void;
}

interface WordGroup {
  utteranceIdx: number;
  speaker?: number | null;
  words: EditableWord[];
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtPrecise(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export default function VideoEditor({ words, onChange, onContinue }: Props) {
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<Set<string>>(new Set());

  // Group words by utteranceIdx for display
  const groups = useMemo<WordGroup[]>(() => {
    const map = new Map<number, EditableWord[]>();
    for (const w of words) {
      if (!map.has(w.utteranceIdx)) map.set(w.utteranceIdx, []);
      map.get(w.utteranceIdx)!.push(w);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([utteranceIdx, ws]) => ({
        utteranceIdx,
        speaker: ws[0]?.speaker,
        words: ws,
      }));
  }, [words]);

  // Stats
  const keptCount = useMemo(() => words.filter((w) => !w.removed).length, [words]);
  const exportDuration = useMemo(
    () => computeFinalClips(words).reduce((a, c) => a + (c.end - c.start), 0),
    [words]
  );

  // Toggle a single word
  const toggleWord = (id: string) => {
    onChange(words.map((w) => (w.id === id ? { ...w, removed: !w.removed } : w)));
  };

  // Toggle all words in a group
  const toggleGroup = (utteranceIdx: number) => {
    const groupWords = words.filter((w) => w.utteranceIdx === utteranceIdx);
    const allRemoved = groupWords.every((w) => w.removed);
    onChange(
      words.map((w) =>
        w.utteranceIdx === utteranceIdx ? { ...w, removed: !allRemoved } : w
      )
    );
  };

  // Click a word (select or shift-extend)
  const handleWordClick = (word: EditableWord, e: React.MouseEvent) => {
    if (e.shiftKey && selectionAnchor) {
      const anchorIdx = words.findIndex((w) => w.id === selectionAnchor);
      const clickIdx = words.findIndex((w) => w.id === word.id);
      const [lo, hi] =
        anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
      setSelectionRange(new Set(words.slice(lo, hi + 1).map((w) => w.id)));
    } else {
      setSelectionAnchor(word.id);
      setSelectionRange(new Set([word.id]));
    }
  };

  // Batch cut / restore selection
  const cutSelection = () => {
    if (!selectionRange.size) return;
    onChange(words.map((w) => (selectionRange.has(w.id) ? { ...w, removed: true } : w)));
    setSelectionRange(new Set());
    setSelectionAnchor(null);
  };

  const restoreSelection = () => {
    if (!selectionRange.size) return;
    onChange(words.map((w) => (selectionRange.has(w.id) ? { ...w, removed: false } : w)));
    setSelectionRange(new Set());
    setSelectionAnchor(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Edit Transcript</h2>
          <p className="text-neutral-400 text-sm mt-1">
            Click a word to toggle it. Shift-click to select a range. Click a
            timestamp to toggle the whole utterance.
          </p>
        </div>
        <Button onClick={onContinue}>Continue to Export →</Button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 mb-4 text-sm flex-wrap">
        <Badge variant="outline" className="bg-neutral-900 border-neutral-700">
          {keptCount}/{words.length} words kept
        </Badge>
        <Badge variant="outline" className="bg-green-950/50 border-green-900/50 text-green-400">
          ~{fmtDuration(exportDuration)} export
        </Badge>
        <Badge variant="outline" className="bg-red-950/50 border-red-900/50 text-red-400">
          {words.length - keptCount} removed
        </Badge>
        {selectionRange.size > 0 && (
          <>
            <Badge
              variant="outline"
              className="bg-blue-950/50 border-blue-900/50 text-blue-400"
            >
              {selectionRange.size} selected
            </Badge>
            <button
              onClick={cutSelection}
              className="text-xs px-2 py-1 rounded bg-red-900/50 text-red-300 border border-red-800 hover:bg-red-900 transition-colors"
            >
              ✂️ Cut Selection
            </button>
            <button
              onClick={restoreSelection}
              className="text-xs px-2 py-1 rounded bg-green-900/50 text-green-300 border border-green-800 hover:bg-green-900 transition-colors"
            >
              ↩ Restore Selection
            </button>
          </>
        )}
      </div>

      {/* Transcript */}
      <div
        className="overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/20 px-1"
        style={{ height: "calc(100vh - 260px)" }}
      >
        <div className="space-y-2 py-3">
          {groups.map((group) => {
            const groupKept = group.words.filter((w) => !w.removed);
            const allRemoved = groupKept.length === 0;
            const groupStart = group.words[0]?.start ?? 0;
            const groupEnd = group.words[group.words.length - 1]?.end ?? 0;

            return (
              <div
                key={group.utteranceIdx}
                className={`rounded-lg border px-3 py-2 transition-colors ${
                  allRemoved
                    ? "border-red-900/30 bg-red-950/10 opacity-40"
                    : "border-neutral-800/50 bg-neutral-900/30"
                }`}
              >
                {/* Group header — click to toggle whole utterance */}
                <button
                  onClick={() => toggleGroup(group.utteranceIdx)}
                  className={`text-[11px] font-mono mb-1.5 block transition-colors ${
                    allRemoved
                      ? "text-red-800 line-through"
                      : "text-neutral-600 hover:text-neutral-300"
                  }`}
                  title={allRemoved ? "Click to restore utterance" : "Click to remove entire utterance"}
                >
                  {fmt(groupStart)} – {fmt(groupEnd)}
                  {group.speaker != null && (
                    <span className="ml-2 text-neutral-700">
                      Speaker {group.speaker}
                    </span>
                  )}
                </button>

                {/* Words */}
                <div className="flex flex-wrap gap-[2px] leading-relaxed">
                  {group.words.map((word) => {
                    const isSelected = selectionRange.has(word.id);

                    return (
                      <button
                        key={word.id}
                        onClick={(e) => {
                          if (e.shiftKey) {
                            handleWordClick(word, e); // extend range selection only
                          } else {
                            handleWordClick(word, e); // update anchor
                            toggleWord(word.id);       // immediately toggle
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault(); // prevent double-click from triggering twice
                        }}
                        title={`${fmtPrecise(word.start)} → ${fmtPrecise(word.end)}${word.removed ? " [removed]" : ""}\nClick to toggle · Shift-click to select range`}
                        className={`
                          px-1 py-0.5 rounded text-sm transition-all cursor-pointer select-none
                          ${word.removed
                            ? "text-red-800 line-through decoration-red-700/50"
                            : "text-neutral-200 hover:bg-neutral-700/40"
                          }
                          ${isSelected && !word.removed
                            ? "bg-blue-900/40 ring-1 ring-blue-700/40"
                            : ""
                          }
                        `}
                      >
                        {word.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
