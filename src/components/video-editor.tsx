"use client";

import { useMemo, useState } from "react";
import { EditableWord, SegmentGroup } from "@/lib/types";
import { computeFinalClips } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  words: EditableWord[];
  segments?: SegmentGroup[];
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

const SEGMENT_BORDER_COLORS = [
  "border-blue-500/60",
  "border-green-500/60",
  "border-purple-500/60",
  "border-orange-500/60",
  "border-pink-500/60",
  "border-cyan-500/60",
  "border-yellow-500/60",
  "border-red-500/60",
];

const SEGMENT_TEXT_COLORS = [
  "text-blue-400",
  "text-green-400",
  "text-purple-400",
  "text-orange-400",
  "text-pink-400",
  "text-cyan-400",
  "text-yellow-400",
  "text-red-400",
];

const SEGMENT_BG_COLORS = [
  "bg-blue-500/10",
  "bg-green-500/10",
  "bg-purple-500/10",
  "bg-orange-500/10",
  "bg-pink-500/10",
  "bg-cyan-500/10",
  "bg-yellow-500/10",
  "bg-red-500/10",
];

export default function VideoEditor({ words, segments = [], onChange, onContinue }: Props) {
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<Set<string>>(new Set());
  const [activePage, setActivePage] = useState(0);

  const hasSegments = segments.length > 0;

  // Group words by utteranceIdx
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

  // Groups visible on the current page
  const pageGroups = useMemo<WordGroup[]>(() => {
    if (!hasSegments) return groups;
    const seg = segments[activePage];
    if (!seg) return groups;
    return groups.filter(
      (g) => g.utteranceIdx >= seg.startLine && g.utteranceIdx <= seg.endLine
    );
  }, [groups, segments, activePage, hasSegments]);

  // Global stats (across all words)
  const keptCount = useMemo(() => words.filter((w) => !w.removed).length, [words]);
  const exportDuration = useMemo(
    () => computeFinalClips(words).reduce((a, c) => a + (c.end - c.start), 0),
    [words]
  );

  // Per-page stats
  const pageWords = useMemo(
    () => pageGroups.flatMap((g) => g.words),
    [pageGroups]
  );
  const pageKept = useMemo(() => pageWords.filter((w) => !w.removed).length, [pageWords]);
  const pageRemoved = pageWords.length - pageKept;

  const toggleWord = (id: string) => {
    onChange(words.map((w) => (w.id === id ? { ...w, removed: !w.removed } : w)));
  };

  const toggleGroup = (utteranceIdx: number) => {
    const groupWords = words.filter((w) => w.utteranceIdx === utteranceIdx);
    const allRemoved = groupWords.every((w) => w.removed);
    onChange(
      words.map((w) =>
        w.utteranceIdx === utteranceIdx ? { ...w, removed: !allRemoved } : w
      )
    );
  };

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

  const goToPage = (idx: number) => {
    setActivePage(idx);
    setSelectionRange(new Set());
    setSelectionAnchor(null);
  };

  const activeSeg = hasSegments ? segments[activePage] : null;
  const activeSegIdx = activePage;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 160px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-2xl font-bold">Edit Transcript</h2>
          <p className="text-neutral-400 text-sm mt-0.5">
            Click a word to toggle it. Shift-click to select a range. Click a timestamp to toggle the whole utterance.
          </p>
        </div>
        <Button onClick={onContinue}>Continue to Export →</Button>
      </div>

      {/* Global stats */}
      <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
        <Badge variant="outline" className="bg-neutral-900 border-neutral-700">
          {keptCount}/{words.length} words kept (total)
        </Badge>
        <Badge variant="outline" className="bg-green-950/50 border-green-900/50 text-green-400">
          ~{fmtDuration(exportDuration)} export
        </Badge>
        <Badge variant="outline" className="bg-red-950/50 border-red-900/50 text-red-400">
          {words.length - keptCount} removed
        </Badge>
        {selectionRange.size > 0 && (
          <>
            <Badge variant="outline" className="bg-blue-950/50 border-blue-900/50 text-blue-400">
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

      {/* Segment tab bar */}
      {hasSegments && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {segments.map((seg, i) => {
            const segWords = groups
              .filter((g) => g.utteranceIdx >= seg.startLine && g.utteranceIdx <= seg.endLine)
              .flatMap((g) => g.words);
            const segRemoved = segWords.filter((w) => w.removed).length;
            const isActive = i === activePage;

            return (
              <button
                key={i}
                onClick={() => goToPage(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  isActive
                    ? `${SEGMENT_BG_COLORS[i % SEGMENT_BG_COLORS.length]} ${SEGMENT_BORDER_COLORS[i % SEGMENT_BORDER_COLORS.length]} ${SEGMENT_TEXT_COLORS[i % SEGMENT_TEXT_COLORS.length]}`
                    : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
                }`}
              >
                <span className={`font-bold ${isActive ? "" : "text-neutral-600"}`}>{i + 1}</span>
                <span className="max-w-[120px] truncate">{seg.title}</span>
                {segRemoved > 0 && (
                  <span className={`${isActive ? "opacity-70" : "text-red-500/60"}`}>
                    −{segRemoved}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Active segment header */}
      {activeSeg && (
        <div
          className={`flex items-center justify-between px-4 py-2 rounded-t-lg border-l-4 mb-0 ${
            SEGMENT_BORDER_COLORS[activeSegIdx % SEGMENT_BORDER_COLORS.length]
          } ${SEGMENT_BG_COLORS[activeSegIdx % SEGMENT_BG_COLORS.length]}`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${SEGMENT_TEXT_COLORS[activeSegIdx % SEGMENT_TEXT_COLORS.length]}`}>
              Segment {activeSegIdx + 1}
            </span>
            <span className="text-sm font-medium text-white">{activeSeg.title}</span>
            <span className="text-xs text-neutral-500">{fmt(activeSeg.start)} – {fmt(activeSeg.end)}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-400">{pageKept} kept</span>
            <span className="text-red-400">{pageRemoved} removed</span>
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => goToPage(Math.max(0, activePage - 1))}
                disabled={activePage === 0}
                className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ←
              </button>
              <span className="text-neutral-600 text-xs px-1">{activePage + 1}/{segments.length}</span>
              <button
                onClick={() => goToPage(Math.min(segments.length - 1, activePage + 1))}
                disabled={activePage === segments.length - 1}
                className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transcript for current page */}
      <div
        className={`overflow-y-auto bg-neutral-900/20 px-1 flex-1 ${
          activeSeg
            ? `border border-t-0 rounded-b-lg ${SEGMENT_BORDER_COLORS[activeSegIdx % SEGMENT_BORDER_COLORS.length]}`
            : "rounded-lg border border-neutral-800"
        }`}
      >
        <div className="space-y-2 py-3">
          {pageGroups.map((group) => {
            const groupKept = group.words.filter((w) => !w.removed);
            const allRemoved = groupKept.length === 0;
            const groupStart = group.words[0]?.start ?? 0;
            const groupEnd = group.words[group.words.length - 1]?.end ?? 0;

            return (
              <div
                key={group.utteranceIdx}
                className={`rounded-lg border px-3 py-2 transition-colors mx-1 ${
                  allRemoved
                    ? "border-red-900/30 bg-red-950/10 opacity-40"
                    : "border-neutral-800/50 bg-neutral-900/30"
                }`}
              >
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
                    <span className="ml-2 text-neutral-700">Speaker {group.speaker}</span>
                  )}
                </button>

                <div className="flex flex-wrap gap-[2px] leading-relaxed">
                  {group.words.map((word) => {
                    const isSelected = selectionRange.has(word.id);
                    return (
                      <button
                        key={word.id}
                        onClick={(e) => {
                          handleWordClick(word, e);
                          if (!e.shiftKey) toggleWord(word.id);
                        }}
                        onDoubleClick={(e) => e.preventDefault()}
                        title={`${fmtPrecise(word.start)} → ${fmtPrecise(word.end)}${word.removed ? " [removed]" : ""}\nClick to toggle · Shift-click to select range`}
                        className={`
                          px-1 py-0.5 rounded text-sm transition-all cursor-pointer select-none
                          ${word.removed
                            ? "text-red-800 line-through decoration-red-700/50"
                            : "text-neutral-200 hover:bg-neutral-700/40"
                          }
                          ${isSelected && !word.removed ? "bg-blue-900/40 ring-1 ring-blue-700/40" : ""}
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
