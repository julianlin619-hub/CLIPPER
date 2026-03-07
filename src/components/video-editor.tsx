"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { EditableWord, SegmentGroup } from "@/lib/types";
import { computeFinalClips } from "@/lib/export";
import { Button } from "@/components/ui/button";

interface Props {
  words: EditableWord[];
  segments?: SegmentGroup[];
  onChange: (words: EditableWord[]) => void;
  onContinue: () => void;
  videoSrc?: string;
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

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const SEGMENT_BORDER_COLORS = [
  "border-violet-500/60","border-green-500/60","border-purple-500/60","border-orange-500/60",
  "border-pink-500/60","border-cyan-500/60","border-yellow-500/60","border-red-500/60",
];
const SEGMENT_TEXT_COLORS = [
  "text-violet-400","text-green-400","text-purple-400","text-orange-400",
  "text-pink-400","text-cyan-400","text-yellow-400","text-red-400",
];
const SEGMENT_BG_COLORS = [
  "bg-violet-500/10","bg-green-500/10","bg-purple-500/10","bg-orange-500/10",
  "bg-pink-500/10","bg-cyan-500/10","bg-yellow-500/10","bg-red-500/10",
];

export default function VideoEditor({ words, segments = [], onChange, onContinue, videoSrc }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activePage, setActivePage] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag selection state (refs to avoid stale closures in event handlers)
  const isDragging = useRef(false);
  const dragAnchorIdx = useRef<number>(-1);

  const hasSegments = segments.length > 0;

  // Flat word list for index lookups
  const wordList = useMemo(() => words, [words]);

  // Skip removed regions during playback
  const removedRanges = useMemo(() =>
    words.filter((w) => w.removed).map((w) => ({ start: w.start, end: w.end })).sort((a, b) => a.start - b.start),
    [words]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handle = () => {
      if (video.paused) return;
      const t = video.currentTime;
      for (const r of removedRanges) {
        if (t >= r.start - 0.1 && t < r.end) { video.currentTime = r.end; break; }
      }
    };
    video.addEventListener("timeupdate", handle);
    return () => video.removeEventListener("timeupdate", handle);
  }, [removedRanges]);

  // Keyboard: Backspace = cut, Escape = deselect, Cmd+Z handled by browser
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        cutSelection();
      } else if (e.key === "Escape") {
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, words]);

  const seekTo = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  };

  // Groups
  const groups = useMemo<WordGroup[]>(() => {
    const map = new Map<number, EditableWord[]>();
    for (const w of words) {
      if (!map.has(w.utteranceIdx)) map.set(w.utteranceIdx, []);
      map.get(w.utteranceIdx)!.push(w);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b).map(([utteranceIdx, ws]) => ({
      utteranceIdx, speaker: ws[0]?.speaker, words: ws,
    }));
  }, [words]);

  const pageGroups = useMemo<WordGroup[]>(() => {
    if (!hasSegments) return groups;
    const seg = segments[activePage];
    if (!seg) return groups;
    return groups.filter((g) => g.utteranceIdx >= seg.startLine && g.utteranceIdx <= seg.endLine);
  }, [groups, segments, activePage, hasSegments]);

  const keptCount = useMemo(() => words.filter((w) => !w.removed).length, [words]);
  const exportDuration = useMemo(() => computeFinalClips(words).reduce((a, c) => a + (c.end - c.start), 0), [words]);

  // ── Selection actions ─────────────────────────────────────────────────────

  const cutSelection = useCallback(() => {
    if (!selectedIds.size) return;
    onChange(words.map((w) => selectedIds.has(w.id) ? { ...w, removed: true } : w));
    setSelectedIds(new Set());
  }, [selectedIds, words, onChange]);

  const restoreSelection = useCallback(() => {
    if (!selectedIds.size) return;
    onChange(words.map((w) => selectedIds.has(w.id) ? { ...w, removed: false } : w));
    setSelectedIds(new Set());
  }, [selectedIds, words, onChange]);

  const selectionHasRemoved = useMemo(() =>
    selectedIds.size > 0 && words.some((w) => selectedIds.has(w.id) && w.removed),
    [selectedIds, words]
  );

  // ── Drag selection ────────────────────────────────────────────────────────

  const getIdxFromId = useCallback((id: string) => wordList.findIndex((w) => w.id === id), [wordList]);

  const buildRangeIds = (anchorIdx: number, currentIdx: number): Set<string> => {
    const [lo, hi] = anchorIdx <= currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
    return new Set(wordList.slice(lo, hi + 1).map((w) => w.id));
  };

  const onWordMouseDown = (e: React.MouseEvent, wordId: string) => {
    e.preventDefault();
    const idx = getIdxFromId(wordId);
    isDragging.current = true;
    dragAnchorIdx.current = idx;
    // Single click: select just this word (or shift-extend)
    if (e.shiftKey && selectedIds.size > 0) {
      // Find current selection boundary and extend
      const existingIdxes = Array.from(selectedIds).map(getIdxFromId).filter((i) => i >= 0);
      const anchorIdx = existingIdxes[0]; // use first as anchor
      setSelectedIds(buildRangeIds(anchorIdx, idx));
    } else {
      setSelectedIds(new Set([wordId]));
    }
    // Seek on click
    const word = wordList[idx];
    if (word) seekTo(word.start);
  };

  const onWordMouseEnter = (e: React.MouseEvent, wordId: string) => {
    if (!isDragging.current) return;
    const idx = getIdxFromId(wordId);
    setSelectedIds(buildRangeIds(dragAnchorIdx.current, idx));
  };

  useEffect(() => {
    const up = () => { isDragging.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const goToPage = (idx: number) => {
    setActivePage(idx);
    setSelectedIds(new Set());
  };

  const activeSeg = hasSegments ? segments[activePage] : null;
  const activeSegIdx = activePage;

  return (
    <div className="flex flex-col select-none" style={{ height: "calc(100vh - 160px)" }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Stats */}
          <span className="text-sm text-neutral-300 font-medium">
            {keptCount.toLocaleString()} words kept
          </span>
          <span className="text-neutral-700">·</span>
          <span className="text-sm text-neutral-400">~{fmtDuration(exportDuration)}</span>

          {/* Selection actions */}
          {selectedIds.size > 0 && (
            <>
              <span className="text-neutral-700">·</span>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={cutSelection}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Delete
              </button>
              {selectionHasRemoved && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={restoreSelection}
                  className="text-sm text-green-400 hover:text-green-300 transition-colors"
                >
                  Restore
                </button>
              )}
            </>
          )}
        </div>
        <Button onClick={onContinue} className="bg-violet-600 text-white hover:bg-violet-500 font-semibold shrink-0">
          Export →
        </Button>
      </div>

      {/* Main content */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Video panel */}
        {videoSrc && (
          <div className="w-[36%] shrink-0 sticky top-0 self-start">
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              className="w-full rounded-lg bg-black border border-neutral-800"
              style={{ maxHeight: "calc(100vh - 260px)" }}
            />
          </div>
        )}

        {/* Transcript */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">

          {/* Segment tabs */}
          {hasSegments && (
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {segments.map((seg, i) => {
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
                  </button>
                );
              })}
            </div>
          )}

          {/* Active segment header */}
          {activeSeg && (
            <div className={`flex items-center justify-between px-4 py-2 rounded-t-lg border-l-4 ${SEGMENT_BORDER_COLORS[activeSegIdx % SEGMENT_BORDER_COLORS.length]} ${SEGMENT_BG_COLORS[activeSegIdx % SEGMENT_BG_COLORS.length]}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${SEGMENT_TEXT_COLORS[activeSegIdx % SEGMENT_TEXT_COLORS.length]}`}>
                  {activeSegIdx + 1}
                </span>
                <span className="text-sm font-medium text-white">{activeSeg.title}</span>
                <span className="text-xs text-neutral-500">{fmt(activeSeg.start)} – {fmt(activeSeg.end)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(Math.max(0, activePage - 1))} disabled={activePage === 0}
                  className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-white disabled:opacity-30 transition-colors text-xs">←</button>
                <span className="text-neutral-600 text-xs px-1">{activePage + 1}/{segments.length}</span>
                <button onClick={() => goToPage(Math.min(segments.length - 1, activePage + 1))} disabled={activePage === segments.length - 1}
                  className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-white disabled:opacity-30 transition-colors text-xs">→</button>
              </div>
            </div>
          )}

          {/* Transcript scroll area */}
          <div
            ref={containerRef}
            className={`overflow-y-auto bg-neutral-900/20 px-4 py-4 flex-1 cursor-text ${
              activeSeg
                ? `border border-t-0 rounded-b-lg ${SEGMENT_BORDER_COLORS[activeSegIdx % SEGMENT_BORDER_COLORS.length]}`
                : "rounded-lg border border-neutral-800"
            }`}
          >
            <div className="space-y-5">
              {pageGroups.map((group) => {
                const groupStart = group.words[0]?.start ?? 0;
                const groupEnd = group.words[group.words.length - 1]?.end ?? 0;
                const allRemoved = group.words.every((w) => w.removed);

                return (
                  <div key={group.utteranceIdx}>
                    {/* Timestamp + speaker label */}
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => seekTo(groupStart)}
                        className="text-[11px] font-mono text-neutral-600 hover:text-neutral-400 transition-colors"
                      >
                        {fmt(groupStart)} – {fmt(groupEnd)}
                      </button>
                      {group.speaker != null && (
                        <span className="text-[11px] text-neutral-700">Speaker {group.speaker}</span>
                      )}
                    </div>

                    {/* Words */}
                    <div className={`flex flex-wrap gap-x-[2px] gap-y-0.5 leading-relaxed ${allRemoved ? "opacity-30" : ""}`}>
                      {group.words.map((word) => {
                        const isSelected = selectedIds.has(word.id);
                        return (
                          <span
                            key={word.id}
                            onMouseDown={(e) => onWordMouseDown(e, word.id)}
                            onMouseEnter={(e) => onWordMouseEnter(e, word.id)}
                            className={`
                              px-[3px] py-[1px] rounded text-[15px] leading-7 transition-colors cursor-pointer
                              ${word.removed
                                ? "text-neutral-700 line-through decoration-neutral-700/50"
                                : isSelected
                                  ? "bg-violet-500/30 text-white"
                                  : "text-neutral-200 hover:bg-neutral-700/30"
                              }
                              ${isSelected && word.removed ? "bg-red-500/20 text-neutral-500" : ""}
                            `}
                          >
                            {word.text}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
