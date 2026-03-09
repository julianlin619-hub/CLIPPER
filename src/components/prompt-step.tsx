"use client";

import { useState, useCallback } from "react";
import { TranscriptEntry, SegmentGroup, LineDecision, SpeakerMap } from "@/lib/types";
import { processSegmentGroup } from "@/app/actions/process-single";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { DEFAULT_EDIT_PROMPT } from "@/prompts/default-edit";

interface Props {
  transcript: TranscriptEntry[];
  segments: SegmentGroup[];
  speakerMap?: SpeakerMap;
  onComplete: (decisions: LineDecision[]) => void;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Max segments processed at the same time. */
const MAX_CONCURRENT_SEGMENTS = 3;

/** Max 429-retry attempts per segment (after the first try). */
const MAX_RETRIES = 2;

/** Base delay for exponential backoff in ms (doubles each retry). */
const RETRY_BASE_MS = 1000;

type PromptMode = "default" | "custom";

interface SegGroupStatus {
  title: string;
  lineCount: number;
  state: "pending" | "processing" | "done" | "error";
  kept?: number;
  removed?: number;
  trimmed?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple counting semaphore. Limits how many async tasks run simultaneously.
 */
function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return {
    acquire(): Promise<void> {
      if (active < limit) {
        active++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => queue.push(resolve));
    },
    release() {
      active--;
      const next = queue.shift();
      if (next) {
        active++;
        next();
      }
    },
  };
}

/**
 * Calls fn(), retrying up to maxRetries times on HTTP 429 errors with
 * exponential backoff. Any other error is re-thrown immediately.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status =
        (err as { status?: number })?.status ??
        (err as { statusCode?: number })?.statusCode;
      const isRateLimit = status === 429;

      if (isRateLimit && attempt < maxRetries) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(
          `Rate-limited (429) on attempt ${attempt + 1}. Retrying in ${delayMs}ms…`
        );
        await new Promise((res) => setTimeout(res, delayMs));
        continue;
      }

      throw err;
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error("withRetry: exhausted retries");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PromptStep({
  transcript,
  segments,
  speakerMap,
  onComplete,
}: Props) {
  const [mode, setMode] = useState<PromptMode>("default");
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [groupStatuses, setGroupStatuses] = useState<SegGroupStatus[]>([]);

  const activePrompt = mode === "default" ? DEFAULT_EDIT_PROMPT : customPrompt;
  const hasSegments = segments.length > 0;

  const handleProcess = useCallback(async () => {
    if (!activePrompt.trim()) return;
    setLoading(true);

    // Results array sized to segment count; filled in as tasks complete.
    // We allocate it up front so we can write by index and then flatten in order.
    const resultsByIndex: LineDecision[][] = new Array(
      hasSegments ? segments.length : 1
    );

    if (hasSegments) {
      // ── Parallel path ──────────────────────────────────────────────────────

      const initialStatuses: SegGroupStatus[] = segments.map((g) => ({
        title: g.title || `Segment ${g.id || ""}`,
        lineCount: (g.endLine ?? 0) - (g.startLine ?? 0) + 1,
        state: "pending" as const,
      }));
      setGroupStatuses(initialStatuses);

      const semaphore = createSemaphore(MAX_CONCURRENT_SEGMENTS);

      /**
       * One task per segment. Acquires the semaphore, processes, releases.
       * Status updates use the functional form of setState so concurrent
       * tasks never clobber each other.
       */
      const tasks = segments.map((group, i) => async () => {
        const startLine = group.startLine ?? 0;
        const endLine = group.endLine ?? transcript.length - 1;
        const lines = transcript.slice(startLine, endLine + 1);

        await semaphore.acquire();

        // Mark as processing
        setGroupStatuses((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], state: "processing" };
          return next;
        });

        try {
          const decisions = await withRetry(() =>
            processSegmentGroup(
              lines,
              startLine,
              activePrompt,
              DEFAULT_MODEL,
              group.title,
              group.summary,
              speakerMap
            )
          );

          resultsByIndex[i] = decisions;

          setGroupStatuses((prev) => {
            const next = [...prev];
            next[i] = {
              ...next[i],
              state: "done",
              kept: decisions.filter((d) => d.action === "keep").length,
              removed: decisions.filter((d) => d.action === "remove").length,
              trimmed: decisions.filter((d) => d.action === "trim").length,
            };
            return next;
          });
        } catch (err) {
          console.error(`Segment ${i} ("${group.title}") failed:`, err);

          const message =
            err instanceof Error ? err.message : "Unknown error";

          // Fallback: keep all lines in the segment so nothing is lost
          resultsByIndex[i] = Array.from(
            { length: endLine - startLine + 1 },
            (_, j) => ({ index: startLine + j, action: "keep" as const })
          );

          setGroupStatuses((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], state: "error", errorMessage: message };
            return next;
          });
        } finally {
          semaphore.release();
        }
      });

      // Fire all tasks and wait for every one to settle (failures don't abort others)
      await Promise.allSettled(tasks.map((t) => t()));
    } else {
      // ── Single-transcript path (no segmentation) ───────────────────────────

      const initialStatuses: SegGroupStatus[] = [
        {
          title: "Full Transcript",
          lineCount: transcript.length,
          state: "processing",
        },
      ];
      setGroupStatuses(initialStatuses);

      try {
        const decisions = await withRetry(() =>
          processSegmentGroup(
            transcript,
            0,
            activePrompt,
            DEFAULT_MODEL,
            undefined,
            undefined,
            speakerMap
          )
        );

        resultsByIndex[0] = decisions;

        setGroupStatuses([
          {
            title: "Full Transcript",
            lineCount: transcript.length,
            state: "done",
            kept: decisions.filter((d) => d.action === "keep").length,
            removed: decisions.filter((d) => d.action === "remove").length,
            trimmed: decisions.filter((d) => d.action === "trim").length,
          },
        ]);
      } catch (err) {
        console.error("Full transcript processing failed:", err);

        const message = err instanceof Error ? err.message : "Unknown error";

        resultsByIndex[0] = transcript.map((_, j) => ({
          index: j,
          action: "keep" as const,
        }));

        setGroupStatuses([
          {
            title: "Full Transcript",
            lineCount: transcript.length,
            state: "error",
            errorMessage: message,
          },
        ]);
      }
    }

    // Flatten results in segment order and hand off
    const allDecisions = resultsByIndex.flat();
setLoading(false);
    onComplete(allDecisions);
  }, [activePrompt, transcript, segments, hasSegments, speakerMap, onComplete]);

  const doneCount = groupStatuses.filter(
    (s) => s.state === "done" || s.state === "error"
  ).length;
  const processingCount = groupStatuses.filter(
    (s) => s.state === "processing"
  ).length;
  const totalGroups = groupStatuses.length;
  const errorCount = groupStatuses.filter((s) => s.state === "error").length;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">LLM Edit Prompt</h2>
      <p className="text-neutral-400 mb-6 text-sm">
        {hasSegments
          ? `${segments.length} segments will be processed in parallel (up to ${MAX_CONCURRENT_SEGMENTS} at a time).`
          : "The full transcript will be processed in one LLM call."}
      </p>

      <Card className="p-6 border-neutral-800 bg-neutral-900/50 mb-6">
        {/* Mode toggle */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setMode("default")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "default"
                ? "bg-violet-600 text-white"
                : "bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
            disabled={loading}
          >
            Default Prompt
          </button>
          <button
            onClick={() => setMode("custom")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "custom"
                ? "bg-violet-600 text-white"
                : "bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
            disabled={loading}
          >
            Custom Prompt
          </button>
        </div>

        {mode === "default" ? (
          <div className="bg-neutral-950 border border-neutral-700 rounded-md p-4 mb-4 max-h-[240px] overflow-y-auto">
            <p className="text-xs text-neutral-500 mb-2 uppercase tracking-wider font-medium">
              Default editing prompt
            </p>
            <pre className="text-sm text-neutral-300 whitespace-pre-wrap font-sans leading-relaxed">
              {DEFAULT_EDIT_PROMPT}
            </pre>
          </div>
        ) : (
          <>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Your editing instruction
            </label>
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g., Remove all filler content and small talk. Keep only substantive discussion."
              className="min-h-[160px] bg-neutral-950 border-neutral-700 text-white placeholder:text-neutral-600 mb-4"
              disabled={loading}
            />
          </>
        )}

        <Button
          onClick={handleProcess}
          disabled={loading || !activePrompt.trim()}
          className="px-6"
        >
          {loading
            ? `Processing… (${doneCount}/${totalGroups} done${processingCount > 0 ? `, ${processingCount} in flight` : ""})`
            : "Apply Prompt"}
        </Button>
      </Card>

      {/* Progress */}
      {groupStatuses.length > 0 && (
        <Card className="p-4 border-neutral-800 bg-neutral-900/30 mb-6">
          <h3 className="text-sm font-medium text-neutral-300 mb-3">
            Processing Progress
            {errorCount > 0 && (
              <span className="ml-2 text-xs text-red-400">
                ({errorCount} failed — content preserved as KEEP)
              </span>
            )}
          </h3>
          <div className="space-y-3">
            {groupStatuses.map((g, i) => (
              <div key={i} className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full shrink-0 ${
                    g.state === "pending"
                      ? "bg-neutral-700"
                      : g.state === "processing"
                      ? "bg-yellow-500 animate-pulse"
                      : g.state === "error"
                      ? "bg-red-500"
                      : "bg-green-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-neutral-200 truncate">
                      {g.title}
                    </span>
                    <span className="text-xs text-neutral-600">
                      {g.lineCount} lines
                    </span>
                  </div>
                  {g.state === "done" && (
                    <div className="flex gap-3 mt-0.5 text-xs">
                      <span className="text-green-500">{g.kept} kept</span>
                      <span className="text-yellow-500">{g.trimmed} trimmed</span>
                      <span className="text-red-500">{g.removed} removed</span>
                    </div>
                  )}
                  {g.state === "error" && g.errorMessage && (
                    <div className="mt-0.5 text-xs text-red-400 truncate">
                      {g.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 border-neutral-800 bg-neutral-900/30">
        <p className="text-xs text-neutral-500">
          <strong className="text-neutral-400">How it works:</strong> Each
          segment is sent to the LLM with all its transcript lines. The LLM
          decides to keep, remove, or trim each line. Timecodes are never
          changed. You&apos;ll review every word on the next step.
        </p>
      </Card>
    </div>
  );
}
