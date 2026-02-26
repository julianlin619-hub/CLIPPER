"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptEntry, SegmentGroup } from "@/lib/types";

interface Props {
  transcript: TranscriptEntry[];
  onComplete: (segments: SegmentGroup[]) => void;
  onSkip: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SEGMENT_COLORS = [
  "border-l-blue-500 bg-blue-500/5",
  "border-l-green-500 bg-green-500/5",
  "border-l-purple-500 bg-purple-500/5",
  "border-l-orange-500 bg-orange-500/5",
  "border-l-pink-500 bg-pink-500/5",
  "border-l-cyan-500 bg-cyan-500/5",
  "border-l-yellow-500 bg-yellow-500/5",
  "border-l-red-500 bg-red-500/5",
];

const BADGE_COLORS = [
  "bg-blue-500/20 text-blue-400",
  "bg-green-500/20 text-green-400",
  "bg-purple-500/20 text-purple-400",
  "bg-orange-500/20 text-orange-400",
  "bg-pink-500/20 text-pink-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-yellow-500/20 text-yellow-400",
  "bg-red-500/20 text-red-400",
];

const DEFAULT_PROMPT =
  "Identify logical topic changes and create segments based on subject matter shifts. Each segment should cover one coherent topic or theme.";

export default function SegmentStep({ transcript, onComplete, onSkip }: Props) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [segments, setSegments] = useState<SegmentGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Word timings toggle
  const [showWordTimings, setShowWordTimings] = useState(false);

  // Inline segment editing
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");

  // ── API ─────────────────────────────────────────────────────────────────────

  const handleSegment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, prompt }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSegments(data.segments ?? []);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Segmentation failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Manual editing helpers ───────────────────────────────────────────────────

  const getSegmentForLine = (lineIdx: number): number => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (lineIdx >= segments[i].startLine) return i;
    }
    return 0;
  };

  const addBreakBefore = (lineIdx: number) => {
    if (lineIdx === 0) return;
    if (segments.some((s) => s.startLine === lineIdx)) return;

    const updated = [...segments];
    const segIdx = getSegmentForLine(lineIdx);
    const oldSeg = updated[segIdx];

    const newSeg: SegmentGroup = {
      id: 0,
      title: "New Segment",
      startLine: lineIdx,
      endLine: oldSeg.endLine,
      start: transcript[lineIdx].start,
      end: oldSeg.end,
      summary: "",
    };

    oldSeg.endLine = lineIdx - 1;
    oldSeg.end = transcript[lineIdx - 1].end;

    updated.splice(segIdx + 1, 0, newSeg);
    updated.forEach((s, i) => (s.id = i + 1));
    setSegments(updated);
  };

  const removeBreak = (segIdx: number) => {
    if (segIdx === 0) return;
    const updated = [...segments];
    const prev = updated[segIdx - 1];
    const curr = updated[segIdx];

    prev.endLine = curr.endLine;
    prev.end = curr.end;

    updated.splice(segIdx, 1);
    updated.forEach((s, i) => (s.id = i + 1));
    setSegments(updated);
  };

  const startEditing = (segIdx: number) => {
    setEditingSegment(segIdx);
    setEditTitle(segments[segIdx].title);
    setEditSummary(segments[segIdx].summary);
  };

  const saveEdit = () => {
    if (editingSegment === null) return;
    const updated = [...segments];
    updated[editingSegment].title = editTitle;
    updated[editingSegment].summary = editSummary;
    setSegments(updated);
    setEditingSegment(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Segment</h2>
        <p className="text-neutral-400 text-sm">
          Claude AI will identify logical segments in your {transcript.length}-line transcript.
          Then you&apos;ll apply your editing prompt to each segment.
        </p>
      </div>

      {/* ── Segmentation prompt (only before first run) ── */}
      {segments.length === 0 && (
        <Card className="p-5 border-neutral-800 bg-neutral-900/50 mb-6">
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            Segmentation instruction
          </label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-[80px] bg-neutral-950 border-neutral-700 text-white placeholder:text-neutral-600 mb-4 resize-none"
            disabled={loading}
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleSegment} disabled={loading || !prompt.trim()}>
              {loading ? "Segmenting..." : "Segment with Claude"}
            </Button>
            <button
              onClick={onSkip}
              disabled={loading}
              className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              Skip → process as single segment
            </button>
          </div>

          {error && (
            <div className="text-red-400 text-sm mt-3 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
              {error}
            </div>
          )}
        </Card>
      )}

      {/* ── Editable segmented transcript ── */}
      {segments.length > 0 && (
        <Card className="border-neutral-800 bg-neutral-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-green-800 text-green-400 bg-green-950/20"
                >
                  ✓ {segments.length} segments
                </Badge>
                <span className="text-xs text-neutral-500 font-normal">
                  {formatTime(segments[0]?.start ?? 0)} –{" "}
                  {formatTime(segments[segments.length - 1]?.end ?? 0)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Word timings toggle */}
                <button
                  onClick={() => setShowWordTimings((v) => !v)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    showWordTimings
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-neutral-800 text-neutral-400 border-neutral-700 hover:border-primary hover:text-white"
                  }`}
                  title="Toggle word-level timestamps"
                >
                  🕐 Word Timings
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSegments([]); setEditingSegment(null); }}
                  className="text-xs border-neutral-700 text-neutral-400"
                >
                  Re-segment
                </Button>
                <Button size="sm" onClick={() => onComplete(segments)}>
                  Continue →
                </Button>
              </div>
            </CardTitle>
            <p className="text-xs text-neutral-500">
              Click a segment header to edit title &amp; summary. Hover a line and click ✂️ to add
              a break. Click ✕ on a header to merge with the previous segment.
            </p>
          </CardHeader>

          <CardContent className="pt-0">
            <ScrollArea className="h-[600px] rounded-md border border-neutral-800">
              <div className="p-4 space-y-1">
                {segments.map((seg, segIdx) => (
                  <div key={`seg-${segIdx}`} className="mb-1">
                    {/* ── Segment header ── */}
                    <div
                      className={`flex items-center justify-between p-3 rounded-t-lg border-l-4 ${SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length]} ${
                        editingSegment === segIdx ? "" : "cursor-pointer hover:opacity-80"
                      }`}
                    >
                      {editingSegment === segIdx ? (
                        /* Inline edit form */
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm font-medium text-white"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={editSummary}
                            onChange={(e) => setEditSummary(e.target.value)}
                            placeholder="Summary..."
                            className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-400"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveEdit}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingSegment(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            className="flex items-center gap-2 flex-1"
                            onClick={() => startEditing(segIdx)}
                          >
                            <span
                              className={`text-xs font-bold px-2 py-0.5 rounded ${
                                BADGE_COLORS[segIdx % BADGE_COLORS.length]
                              }`}
                            >
                              {seg.id}
                            </span>
                            <span className="font-medium text-sm text-white">{seg.title}</span>
                            <span className="text-xs text-neutral-400">
                              {formatTime(seg.start)} → {formatTime(seg.end)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {seg.summary && (
                              <span className="text-xs text-neutral-500 max-w-[280px] truncate">
                                {seg.summary}
                              </span>
                            )}
                            {segIdx > 0 && (
                              <button
                                onClick={() => removeBreak(segIdx)}
                                className="text-neutral-500 hover:text-red-400 ml-2 text-sm transition-colors"
                                title="Remove this break (merge with previous)"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── Transcript lines ── */}
                    <div
                      className={`border-l-4 ${SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length]} pl-1`}
                    >
                      {transcript
                        .slice(seg.startLine, seg.endLine + 1)
                        .map((entry, lineOffset) => {
                          const lineIdx = seg.startLine + lineOffset;
                          return (
                            <div key={lineIdx} className="group relative">
                              <div className="text-sm py-1 px-3 hover:bg-neutral-800/30">
                                {showWordTimings && entry.words?.length ? (
                                  /* ── Word-level view ── */
                                  <div className="space-y-1">
                                    <div className="text-xs text-neutral-500 font-mono">
                                      {formatTime(entry.start)} → {formatTime(entry.end)}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {entry.words.map((w, wi) => (
                                        <div
                                          key={wi}
                                          className="inline-flex flex-col items-center bg-neutral-800/50 hover:bg-primary/10 border border-neutral-700 hover:border-primary/40 rounded px-1.5 py-0.5 cursor-default transition-colors"
                                          title={`${formatTime(w.start)} → ${formatTime(w.end)}${
                                            w.confidence != null
                                              ? ` · ${Math.round(w.confidence * 100)}%`
                                              : ""
                                          }${w.speaker != null ? ` · spk ${w.speaker}` : ""}`}
                                        >
                                          <span className="font-medium text-xs text-white">
                                            {w.word}
                                          </span>
                                          <span className="text-[10px] text-neutral-500 font-mono leading-tight">
                                            {formatTime(w.start)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  /* ── Sentence-level view ── */
                                  <div className="flex gap-3">
                                    <span className="text-neutral-500 font-mono whitespace-nowrap min-w-[100px] text-xs pt-0.5">
                                      {formatTime(entry.start)} → {formatTime(entry.end)}
                                    </span>
                                    <span className="flex-1 text-neutral-200">{entry.text}</span>
                                    {/* ✂️ only on non-first lines */}
                                    {lineOffset > 0 && (
                                      <button
                                        onClick={() => addBreakBefore(lineIdx)}
                                        className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-primary text-xs transition-opacity shrink-0"
                                        title="Add segment break here"
                                      >
                                        ✂️
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
