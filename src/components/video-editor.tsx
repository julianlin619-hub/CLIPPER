"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { EditableSegment, EditableWord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  segments: EditableSegment[];
  onChange: (segments: EditableSegment[]) => void;
  onContinue: () => void;
}

/** All words flattened with their segment/word indices for quick lookup */
interface FlatWord {
  segIdx: number;
  wordIdx: number;
  word: EditableWord;
  segRemoved: boolean;
}

function formatTimePrecise(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoEditor({ segments, onChange, onContinue }: Props) {
  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Highlight / selection state
  const [activeWordKey, setActiveWordKey] = useState<string | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<Set<string>>(new Set());

  // Scroll ref for transcript auto-scroll
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLButtonElement>(null);

  // Build flat word list for efficient time-based lookups
  const flatWords = useMemo(() => {
    const result: FlatWord[] = [];
    segments.forEach((seg, si) => {
      seg.words.forEach((w, wi) => {
        result.push({
          segIdx: si,
          wordIdx: wi,
          word: w,
          segRemoved: seg.action === "remove",
        });
      });
    });
    return result;
  }, [segments]);

  // Build skip regions: contiguous removed time ranges
  const skipRegions = useMemo(() => {
    const regions: { start: number; end: number }[] = [];
    let regionStart: number | null = null;
    let regionEnd: number | null = null;
    for (const fw of flatWords) {
      const isRemoved = fw.segRemoved || fw.word.removed;
      if (isRemoved && fw.word.start != null && fw.word.end != null) {
        if (regionStart === null) regionStart = fw.word.start;
        regionEnd = fw.word.end;
      } else {
        if (regionStart !== null && regionEnd !== null) {
          regions.push({ start: regionStart, end: regionEnd });
          regionStart = null;
          regionEnd = null;
        }
      }
    }
    if (regionStart !== null && regionEnd !== null) {
      regions.push({ start: regionStart, end: regionEnd });
    }
    return regions;
  }, [flatWords]);

  // Playback: sync time + skip removed regions
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrame: number;

    const tick = () => {
      const t = video.currentTime;
      setCurrentTime(t);

      // Find current word for highlighting
      let found = false;
      for (const fw of flatWords) {
        if (fw.word.start != null && fw.word.end != null && t >= fw.word.start && t < fw.word.end) {
          setActiveWordKey(fw.word.id);
          found = true;
          break;
        }
      }
      if (!found) setActiveWordKey(null);

      // Skip removed regions during playback
      if (!video.paused) {
        for (const region of skipRegions) {
          if (t >= region.start && t < region.end) {
            video.currentTime = region.end;
            break;
          }
        }
      }

      animFrame = requestAnimationFrame(tick);
    };

    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, [flatWords, skipRegions]);

  // Auto-scroll active word into view
  useEffect(() => {
    if (activeWordRef.current) {
      activeWordRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeWordKey]);

  // Video event handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setVideoFileName(file.name);
  };

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlayback();
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime -= 2;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime += 2;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePlayback]);

  // Click word → seek
  const handleWordClick = (fw: FlatWord, e: React.MouseEvent) => {
    if (e.shiftKey && selectionAnchor) {
      // Shift-click: extend selection range
      const anchorIdx = flatWords.findIndex((f) => f.word.id === selectionAnchor);
      const clickIdx = flatWords.findIndex((f) => f.word.id === fw.word.id);
      const [startIdx, endIdx] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
      const newRange = new Set<string>();
      for (let i = startIdx; i <= endIdx; i++) {
        newRange.add(flatWords[i].word.id);
      }
      setSelectionRange(newRange);
    } else {
      // Normal click: seek to word and set anchor
      if (videoRef.current && fw.word.start != null) {
        videoRef.current.currentTime = fw.word.start;
      }
      setSelectionAnchor(fw.word.id);
      setSelectionRange(new Set([fw.word.id]));
    }
  };

  // Toggle word removed state
  const toggleWord = (segIdx: number, wordIdx: number) => {
    const updated = [...segments];
    const seg = { ...updated[segIdx] };
    const words = [...seg.words];
    words[wordIdx] = { ...words[wordIdx], removed: !words[wordIdx].removed };
    seg.words = words;
    updated[segIdx] = seg;
    onChange(updated);
  };

  // Toggle entire segment
  const toggleSegment = (segIdx: number) => {
    const updated = [...segments];
    const seg = { ...updated[segIdx] };
    seg.action = seg.action === "remove" ? "keep" : "remove";
    updated[segIdx] = seg;
    onChange(updated);
  };

  // Cut selection (remove all selected words)
  const cutSelection = () => {
    if (selectionRange.size === 0) return;
    const updated = [...segments];
    for (const fw of flatWords) {
      if (selectionRange.has(fw.word.id) && !fw.segRemoved) {
        const seg = { ...updated[fw.segIdx] };
        const words = [...seg.words];
        words[fw.wordIdx] = { ...words[fw.wordIdx], removed: true };
        seg.words = words;
        updated[fw.segIdx] = seg;
      }
    }
    onChange(updated);
    setSelectionRange(new Set());
    setSelectionAnchor(null);
  };

  // Restore selection
  const restoreSelection = () => {
    if (selectionRange.size === 0) return;
    const updated = [...segments];
    for (const fw of flatWords) {
      if (selectionRange.has(fw.word.id)) {
        const seg = { ...updated[fw.segIdx] };
        const words = [...seg.words];
        words[fw.wordIdx] = { ...words[fw.wordIdx], removed: false };
        seg.words = words;
        updated[fw.segIdx] = seg;
      }
    }
    onChange(updated);
    setSelectionRange(new Set());
    setSelectionAnchor(null);
  };

  // Stats
  const activeSegments = segments.filter((s) => s.action !== "remove");
  const removedCount = segments.filter((s) => s.action === "remove").length;
  const totalWords = segments.reduce((acc, s) => acc + s.words.length, 0);
  const activeWords = segments
    .filter((s) => s.action !== "remove")
    .reduce((acc, s) => acc + s.words.filter((w) => !w.removed).length, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Edit Transcript</h2>
          <p className="text-neutral-400 text-sm mt-1">
            Load your video, click words to seek, shift-click to select ranges, then cut.
            Space to play/pause. ← → to scrub.
          </p>
        </div>
        <Button onClick={onContinue}>Continue to Export →</Button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 mb-4 text-sm flex-wrap">
        <Badge variant="outline" className="bg-neutral-900 border-neutral-700">
          {activeSegments.length}/{segments.length} segments
        </Badge>
        <Badge variant="outline" className="bg-neutral-900 border-neutral-700">
          {activeWords}/{totalWords} words
        </Badge>
        <Badge variant="outline" className="bg-red-950/50 border-red-900/50 text-red-400">
          {removedCount} removed
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

      {/* Main layout: video left, transcript right */}
      <div className="grid grid-cols-[1fr_1fr] gap-4" style={{ height: "calc(100vh - 260px)" }}>
        {/* Left: Video player */}
        <div className="flex flex-col gap-3">
          {!videoSrc ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-neutral-700 rounded-xl cursor-pointer hover:border-neutral-500 transition-colors"
            >
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-neutral-400 text-sm">Click to load video file</p>
              <p className="text-neutral-600 text-xs mt-1">Stays on your machine — nothing uploaded</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          ) : (
            <>
              <div className="relative bg-black rounded-lg overflow-hidden flex-shrink-0">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="w-full"
                  onLoadedMetadata={() => {
                    if (videoRef.current) setDuration(videoRef.current.duration);
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              </div>

              {/* Transport controls */}
              <div className="flex items-center gap-3 bg-neutral-900 rounded-lg px-4 py-2 border border-neutral-800">
                <button
                  onClick={togglePlayback}
                  className="text-xl hover:text-white text-neutral-400 transition-colors w-8"
                >
                  {isPlaying ? "⏸" : "▶️"}
                </button>

                <span className="text-xs font-mono text-neutral-400 w-20">
                  {formatTimePrecise(currentTime)}
                </span>

                {/* Scrubber */}
                <div className="flex-1 relative h-2 group">
                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.01}
                    value={currentTime}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      if (videoRef.current) videoRef.current.currentTime = t;
                    }}
                    className="w-full h-2 appearance-none bg-neutral-700 rounded-full cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                      [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  {/* Skip region markers */}
                  {duration > 0 && skipRegions.map((r, i) => (
                    <div
                      key={i}
                      className="absolute top-0 h-2 bg-red-900/60 rounded pointer-events-none"
                      style={{
                        left: `${(r.start / duration) * 100}%`,
                        width: `${((r.end - r.start) / duration) * 100}%`,
                      }}
                    />
                  ))}
                </div>

                <span className="text-xs font-mono text-neutral-400 w-20 text-right">
                  {formatTimePrecise(duration)}
                </span>

                {/* Re-load video */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors ml-2"
                  title="Load different video"
                >
                  📂
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {videoFileName && (
                <p className="text-xs text-neutral-600 truncate">
                  📎 {videoFileName}
                </p>
              )}
            </>
          )}
        </div>

        {/* Right: Synced transcript */}
        <div
          ref={transcriptRef}
          className="overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/20 px-1"
        >
          <div className="space-y-2 py-3">
            {segments.map((seg, si) => {
              const isRemoved = seg.action === "remove";
              return (
                <div
                  key={si}
                  className={`rounded-lg border px-3 py-2 transition-colors ${
                    isRemoved
                      ? "border-red-900/30 bg-red-950/10 opacity-40"
                      : "border-neutral-800/50 bg-neutral-900/30"
                  }`}
                >
                  {/* Segment header */}
                  <button
                    onClick={() => toggleSegment(si)}
                    className={`text-[11px] font-mono mb-1.5 block transition-colors ${
                      isRemoved
                        ? "text-red-800 line-through"
                        : "text-neutral-600 hover:text-neutral-300"
                    }`}
                    title={isRemoved ? "Click to restore segment" : "Click to remove entire segment"}
                  >
                    {formatTime(seg.start)} – {formatTime(seg.end)}
                    {seg.words[0]?.speaker != null && (
                      <span className="ml-2 text-neutral-700">Speaker {seg.words[0].speaker}</span>
                    )}
                  </button>

                  {/* Words */}
                  <div className="flex flex-wrap gap-[2px] leading-relaxed">
                    {seg.words.map((word, wi) => {
                      const wordRemoved = word.removed || isRemoved;
                      const isActive = activeWordKey === word.id;
                      const isSelected = selectionRange.has(word.id);
                      const fw: FlatWord = { segIdx: si, wordIdx: wi, word, segRemoved: isRemoved };

                      return (
                        <button
                          key={word.id}
                          ref={isActive ? activeWordRef : undefined}
                          onClick={(e) => handleWordClick(fw, e)}
                          onDoubleClick={() => !isRemoved && toggleWord(si, wi)}
                          disabled={false}
                          title={
                            word.start != null
                              ? `${formatTimePrecise(word.start)} → ${formatTimePrecise(word.end!)}` +
                                (wordRemoved ? " [removed]" : "") +
                                "\nClick to seek · Shift-click to select · Double-click to toggle"
                              : undefined
                          }
                          className={`
                            px-1 py-0.5 rounded text-sm transition-all cursor-pointer select-none
                            ${wordRemoved
                              ? "text-red-800 line-through decoration-red-700/50"
                              : "text-neutral-200"
                            }
                            ${isActive && !wordRemoved
                              ? "bg-blue-600/40 text-white ring-1 ring-blue-500/60"
                              : ""
                            }
                            ${isSelected && !isActive
                              ? "bg-blue-900/40 ring-1 ring-blue-700/40"
                              : ""
                            }
                            ${!isActive && !isSelected && !wordRemoved
                              ? "hover:bg-neutral-700/40"
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
    </div>
  );
}
