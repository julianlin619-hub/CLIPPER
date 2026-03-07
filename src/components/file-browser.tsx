"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptEntry, SegmentGroup } from "@/lib/types";

interface BrowseEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

interface Props {
  onComplete: (
    transcript: TranscriptEntry[],
    duration: number,
    fps: number,
    videoPath: string,
    segments: SegmentGroup[]
  ) => void;
  fcpxmlPath: string;
  onFcpxmlSelected: (path: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];
const XML_EXTENSIONS = [".xml", ".fcpxml"];

function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}
function isXml(name: string): boolean {
  return XML_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

type Phase = "browse" | "transcribing" | "segmenting" | "review";
type TxStatus = "extracting_audio" | "chunking_audio" | "transcribing" | "done" | "error";

const SEGMENT_COLORS = [
  "border-l-violet-500 bg-violet-500/5",
  "border-l-green-500 bg-green-500/5",
  "border-l-purple-500 bg-purple-500/5",
  "border-l-orange-500 bg-orange-500/5",
  "border-l-pink-500 bg-pink-500/5",
  "border-l-cyan-500 bg-cyan-500/5",
  "border-l-yellow-500 bg-yellow-500/5",
  "border-l-red-500 bg-red-500/5",
];
const BADGE_COLORS = [
  "bg-violet-500/20 text-violet-400",
  "bg-green-500/20 text-green-400",
  "bg-purple-500/20 text-purple-400",
  "bg-orange-500/20 text-orange-400",
  "bg-pink-500/20 text-pink-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-yellow-500/20 text-yellow-400",
  "bg-red-500/20 text-red-400",
];

const CALLER_SEGMENT_PROMPT =
  "This is a call-in show where a host takes live callers (similar to Dave Ramsey). " +
  "Using the speaker diarization data, identify distinct caller interactions. " +
  "Each segment should represent one caller's conversation with the host — from the moment the caller first speaks until their call ends. " +
  "The host may have brief solo segments between callers (intros, transitions, recaps) — treat those as their own segments. " +
  "Label each segment clearly: use the caller's name if mentioned, or a short description of their topic/situation (e.g. 'Caller – Credit card debt', 'Host intro', 'Host – Post-call recap'). " +
  "Prioritize speaker changes and natural call boundaries over topic changes within a single call.";

export default function FileBrowser({ onComplete, fcpxmlPath, onFcpxmlSelected }: Props) {
  // Browse state
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parent, setParent] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // File selection
  const [videoPath, setVideoPath] = useState("");
  const [videoName, setVideoName] = useState("");

  // Phase
  const [phase, setPhase] = useState<Phase>("browse");

  // Transcription state
  const [txStatus, setTxStatus] = useState<TxStatus>("extracting_audio");
  const [txStatusText, setTxStatusText] = useState("");
  const [txProgress, setTxProgress] = useState(0);
  const [txError, setTxError] = useState<string | null>(null);

  // Results
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(30);

  // Segmentation state
  const [segError, setSegError] = useState<string | null>(null);
  const [segments, setSegments] = useState<SegmentGroup[]>([]);

  // Segment editing
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");

  const browse = async (targetDir?: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const params = targetDir ? `?dir=${encodeURIComponent(targetDir)}` : "";
      const res = await fetch(`/api/browse${params}`);
      const data = await res.json();
      if (data.error) setBrowseError(data.error);
      else {
        setDir(data.dir);
        setParent(data.parent);
        setEntries(data.entries || []);
      }
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : "Browse failed");
    } finally {
      setBrowseLoading(false);
    }
  };

  useEffect(() => { browse(); }, []);

  const handleFileClick = (entry: BrowseEntry) => {
    if (isXml(entry.name)) onFcpxmlSelected(entry.path);
    else if (isVideo(entry.name)) { setVideoPath(entry.path); setVideoName(entry.name); }
  };

  // ── Transcription ────────────────────────────────────────────────────────────

  const startTranscription = async () => {
    setPhase("transcribing");
    setTxStatus("extracting_audio");
    setTxStatusText("Extracting audio from video...");
    setTxProgress(10);
    setTxError(null);

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: videoPath }),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const msg = JSON.parse(raw);
            if (msg.error) { setTxStatus("error"); setTxError(msg.error); return; }
            if (msg.status === "extracting_audio") { setTxStatus("extracting_audio"); setTxStatusText("Extracting audio..."); setTxProgress(20); }
            else if (msg.status === "audio_extracted") { setTxStatusText(`Audio extracted (${msg.size_mb} MB)`); setTxProgress(35); }
            else if (msg.status === "chunking_audio") { setTxStatus("chunking_audio"); setTxStatusText("Splitting into chunks..."); setTxProgress(40); }
            else if (msg.status === "chunking_complete") { setTxStatusText(`Split into ${msg.chunks} chunks`); setTxProgress(45); }
            else if (msg.status === "transcribing_chunk") {
              setTxStatus("transcribing");
              const pct = msg.total > 1 ? Math.round(45 + (msg.chunk / msg.total) * 45) : 60;
              setTxProgress(pct);
              setTxStatusText(msg.total > 1 ? `Transcribing chunk ${msg.chunk} / ${msg.total}...` : "Transcribing with Deepgram nova-3...");
            }
            else if (msg.status === "done" && msg.transcript) {
              setTxStatus("done");
              setTxProgress(100);
              const t: TranscriptEntry[] = msg.transcript;
              const d = typeof msg.duration === "number" && msg.duration > 0 ? msg.duration : t.length > 0 ? t[t.length - 1].end : 0;
              const f = typeof msg.fps === "number" && msg.fps > 0 ? msg.fps : 30;
              setTranscript(t);
              setDuration(d);
              setFps(f);
              setTxStatusText(`Done — ${t.length} utterances, ${formatTime(d)}`);
              // Auto-trigger segmentation
              await runSegmentation(t);
            }
          } catch { /* ignore non-JSON */ }
        }
      }
    } catch (e: unknown) {
      setTxStatus("error");
      setTxError(e instanceof Error ? e.message : "Transcription failed");
    }
  };

  // ── Segmentation ─────────────────────────────────────────────────────────────

  const runSegmentation = async (t: TranscriptEntry[]) => {
    setPhase("segmenting");
    setSegError(null);
    try {
      const res = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: t, prompt: CALLER_SEGMENT_PROMPT }),
      });
      const data = await res.json();
      if (data.error) setSegError(data.error);
      else setSegments(data.segments ?? []);
    } catch (e: unknown) {
      setSegError(e instanceof Error ? e.message : "Segmentation failed");
    } finally {
      setPhase("review");
    }
  };

  // ── Segment editing ──────────────────────────────────────────────────────────

  const getSegmentForLine = (lineIdx: number): number => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (lineIdx >= segments[i].startLine) return i;
    }
    return 0;
  };

  const addBreakBefore = (lineIdx: number) => {
    if (lineIdx === 0 || segments.some((s) => s.startLine === lineIdx)) return;
    const updated = [...segments];
    const segIdx = getSegmentForLine(lineIdx);
    const oldSeg = updated[segIdx];
    const newSeg: SegmentGroup = {
      id: 0, title: "New Segment", startLine: lineIdx, endLine: oldSeg.endLine,
      start: transcript[lineIdx].start, end: oldSeg.end, summary: "",
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
    updated[segIdx - 1].endLine = updated[segIdx].endLine;
    updated[segIdx - 1].end = updated[segIdx].end;
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

  // ── Render helpers ───────────────────────────────────────────────────────────

  const videoFiles = entries.filter((e) => e.type === "file" && isVideo(e.name));
  const xmlFiles = entries.filter((e) => e.type === "file" && isXml(e.name));
  const dirs = entries.filter((e) => e.type === "directory" && !e.name.startsWith("."));
  const hasRelevantFiles = videoFiles.length > 0 || xmlFiles.length > 0 || dirs.length > 0;

  const canTranscribe = !!(videoPath && fcpxmlPath);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── BROWSE PHASE ── */}
      {phase === "browse" && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1">Select &amp; Transcribe</h2>
            <p className="text-neutral-400 text-sm">Select both inputs, then transcribe. Caller segments are identified automatically.</p>
          </div>

          {/* Input slots */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className={`rounded-xl border-2 p-4 transition-colors ${fcpxmlPath ? "border-violet-500 bg-violet-950/30" : "border-dashed border-neutral-700 bg-neutral-900/30"}`}>
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Input 1</span>
                {fcpxmlPath && <button onClick={() => onFcpxmlSelected("")} className="text-neutral-500 hover:text-neutral-300 text-xs">✕</button>}
              </div>
              <p className="text-sm font-semibold text-white mb-1">Multi-Cam XML</p>
              <p className="text-xs text-neutral-500 mb-3">All cameras + final audio track</p>
              {fcpxmlPath ? (
                <div className="flex items-center gap-2"><span className="text-lg">📋</span><span className="text-xs text-violet-300 font-mono truncate">{fcpxmlPath.split("/").pop()}</span></div>
              ) : (
                <div className="flex items-center gap-2 text-neutral-600"><span className="text-lg">📋</span><span className="text-xs">No file selected</span></div>
              )}
            </div>

            <div className={`rounded-xl border-2 p-4 transition-colors ${videoPath ? "border-emerald-500 bg-emerald-950/30" : "border-dashed border-neutral-700 bg-neutral-900/30"}`}>
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Input 2</span>
                {videoPath && <button onClick={() => { setVideoPath(""); setVideoName(""); }} className="text-neutral-500 hover:text-neutral-300 text-xs">✕</button>}
              </div>
              <p className="text-sm font-semibold text-white mb-1">Final MP4</p>
              <p className="text-xs text-neutral-500 mb-3">Final video with mixed audio</p>
              {videoPath ? (
                <div className="flex items-center gap-2"><span className="text-lg">🎬</span><span className="text-xs text-emerald-300 font-mono truncate">{videoName}</span></div>
              ) : (
                <div className="flex items-center gap-2 text-neutral-600"><span className="text-lg">🎬</span><span className="text-xs">No file selected</span></div>
              )}
            </div>
          </div>

          <div className="mb-8">
            <Button
              onClick={startTranscription}
              disabled={!canTranscribe}
              className="w-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed font-semibold"
            >
              {canTranscribe ? "Transcribe →" : "Select both files to transcribe"}
            </Button>
          </div>

          {/* File browser */}
          <div className="border border-neutral-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900/60 border-b border-neutral-800">
              <span className="text-xs text-neutral-500 font-mono truncate flex-1">{dir || "Loading..."}</span>
              {parent && parent !== dir && (
                <button onClick={() => browse(parent)} disabled={browseLoading} className="text-xs text-neutral-400 hover:text-white shrink-0">↑ Up</button>
              )}
            </div>
            {browseError && <div className="text-red-400 text-xs p-4 bg-red-950/20">{browseError}</div>}
            {browseLoading && <div className="text-neutral-500 text-sm py-10 text-center">Loading...</div>}
            {!browseLoading && (
              <div className="divide-y divide-neutral-800/50">
                {dirs.map((entry) => (
                  <button key={entry.path} onClick={() => browse(entry.path)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/40 transition-colors text-left">
                    <span className="text-base">📁</span>
                    <span className="flex-1 text-sm text-neutral-300 truncate">{entry.name}</span>
                    <span className="text-neutral-600 text-xs">›</span>
                  </button>
                ))}
                {xmlFiles.map((entry) => (
                  <button key={entry.path} onClick={() => handleFileClick(entry)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left ${fcpxmlPath === entry.path ? "bg-violet-950/40 hover:bg-violet-950/60" : "hover:bg-neutral-800/40"}`}>
                    <span className="text-base">📋</span>
                    <span className="flex-1 text-sm text-white truncate">{entry.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {fcpxmlPath === entry.path
                        ? <span className="text-xs text-violet-400">Selected ✓</span>
                        : <Badge variant="outline" className="text-xs border-violet-800/50 text-violet-500 bg-violet-950/20">XML</Badge>}
                      {entry.size && <span className="text-xs text-neutral-500">{formatSize(entry.size)}</span>}
                    </div>
                  </button>
                ))}
                {videoFiles.map((entry) => (
                  <button key={entry.path} onClick={() => handleFileClick(entry)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left ${videoPath === entry.path ? "bg-emerald-950/40 hover:bg-emerald-950/60" : "hover:bg-neutral-800/40"}`}>
                    <span className="text-base">🎬</span>
                    <span className="flex-1 text-sm text-white truncate">{entry.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {videoPath === entry.path
                        ? <span className="text-xs text-emerald-400">Selected ✓</span>
                        : <Badge variant="outline" className="text-xs border-emerald-800/50 text-emerald-500 bg-emerald-950/20">MP4</Badge>}
                      {entry.size && <span className="text-xs text-neutral-500">{formatSize(entry.size)}</span>}
                    </div>
                  </button>
                ))}
                {!hasRelevantFiles && <div className="text-neutral-600 text-sm py-10 text-center">No relevant files here</div>}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TRANSCRIBING PHASE ── */}
      {phase === "transcribing" && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1">Transcribing</h2>
            <p className="text-neutral-400 text-sm">Deepgram nova-3 · word-level timestamps · speaker diarization</p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-5 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${txStatus === "done" ? "bg-green-500" : txStatus === "error" ? "bg-red-500" : "bg-violet-500 animate-pulse"}`} />
              <span className="text-sm text-neutral-200 flex-1">{txStatusText}</span>
            </div>
            {txStatus !== "error" && <Progress value={txProgress} className="h-1.5" />}
            {txStatus === "error" && txError && (
              <div className="text-red-400 text-sm mt-2 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">{txError}</div>
            )}
          </div>

          {/* Input summary */}
          <div className="grid grid-cols-2 gap-3 text-xs text-neutral-500">
            <div className="rounded-lg border border-neutral-800 px-3 py-2 flex items-center gap-2">
              <span>📋</span><span className="truncate font-mono">{fcpxmlPath.split("/").pop()}</span>
            </div>
            <div className="rounded-lg border border-neutral-800 px-3 py-2 flex items-center gap-2">
              <span>🎬</span><span className="truncate font-mono">{videoName}</span>
            </div>
          </div>
        </>
      )}

      {/* ── SEGMENTING PHASE ── */}
      {phase === "segmenting" && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1">Identifying Caller Segments</h2>
            <p className="text-neutral-400 text-sm">Claude is mapping caller interactions using speaker diarization...</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse shrink-0" />
              <span className="text-sm text-neutral-200">Analyzing {transcript.length} utterances · {formatTime(duration)} total</span>
            </div>
          </div>
          {segError && (
            <div className="text-red-400 text-sm mt-3 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">{segError}</div>
          )}
        </>
      )}

      {/* ── REVIEW PHASE ── */}
      {phase === "review" && (
        <>
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-1">Review Segments</h2>
              <p className="text-neutral-400 text-sm">
                {segments.length} caller segments identified · {formatTime(duration)} · Click a segment header to rename. Hover a line and click ✂️ to split. Click ✕ on a header to merge.
              </p>
            </div>
            <Button
              onClick={() => onComplete(transcript, duration, fps, videoPath, segments)}
              className="shrink-0 bg-violet-600 text-white hover:bg-violet-500 font-semibold ml-4"
            >
              LLM Edit →
            </Button>
          </div>

          {segError && (
            <div className="text-red-400 text-sm mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">{segError}</div>
          )}

          <div className="border border-neutral-800 rounded-xl overflow-hidden">
            <ScrollArea className="h-[600px]">
              <div className="p-4 space-y-1">
                {segments.map((seg, segIdx) => (
                  <div key={`seg-${segIdx}`} className="mb-1">
                    {/* Segment header */}
                    <div className={`flex items-center justify-between p-3 rounded-t-lg border-l-4 ${SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length]}`}>
                      {editingSegment === segIdx ? (
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
                            placeholder="Summary (optional)..."
                            className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-400"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveEdit}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingSegment(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-1 cursor-pointer hover:opacity-80" onClick={() => startEditing(segIdx)}>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${BADGE_COLORS[segIdx % BADGE_COLORS.length]}`}>{seg.id}</span>
                            <span className="font-medium text-sm text-white">{seg.title}</span>
                            <span className="text-xs text-neutral-400">{formatTime(seg.start)} → {formatTime(seg.end)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {seg.summary && <span className="text-xs text-neutral-500 max-w-[240px] truncate">{seg.summary}</span>}
                            {segIdx > 0 && (
                              <button onClick={() => removeBreak(segIdx)} className="text-neutral-500 hover:text-red-400 ml-2 text-sm" title="Merge with previous">✕</button>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Transcript lines */}
                    <div className={`border-l-4 ${SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length]} pl-1`}>
                      {transcript.slice(seg.startLine, seg.endLine + 1).map((entry, lineOffset) => {
                        const lineIdx = seg.startLine + lineOffset;
                        return (
                          <div key={lineIdx} className="group relative">
                            <div className="text-sm py-1 px-3 hover:bg-neutral-800/30 flex gap-3">
                              <span className="text-neutral-500 font-mono whitespace-nowrap min-w-[90px] text-xs pt-0.5">
                                {formatTime(entry.start)} → {formatTime(entry.end)}
                              </span>
                              {entry.words?.[0]?.speaker != null && (
                                <span className="text-xs text-neutral-600 shrink-0 pt-0.5">spk {entry.words?.[0]?.speaker}</span>
                              )}
                              <span className="flex-1 text-neutral-200">{entry.text}</span>
                              {lineOffset > 0 && (
                                <button
                                  onClick={() => addBreakBefore(lineIdx)}
                                  className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-primary text-xs transition-opacity shrink-0"
                                  title="Split segment here"
                                >✂️</button>
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
          </div>
        </>
      )}
    </div>
  );
}
