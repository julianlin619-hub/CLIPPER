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

const MODELS = [
  { value: "claude-opus-4-20250514", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4.6" },
];

type PromptMode = "default" | "custom";

interface SegGroupStatus {
  title: string;
  lineCount: number;
  state: "pending" | "processing" | "done" | "error";
  kept?: number;
  removed?: number;
  trimmed?: number;
}

export default function PromptStep({ transcript, segments, speakerMap, onComplete }: Props) {
  const [mode, setMode] = useState<PromptMode>("default");
  const [customPrompt, setCustomPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [loading, setLoading] = useState(false);
  const [groupStatuses, setGroupStatuses] = useState<SegGroupStatus[]>([]);

  const activePrompt = mode === "default" ? DEFAULT_EDIT_PROMPT : customPrompt;
  const hasSegments = segments.length > 0;

  const handleProcess = useCallback(async () => {
    if (!activePrompt.trim()) return;
    setLoading(true);

    const allDecisions: LineDecision[] = [];

    if (hasSegments) {
      const statuses: SegGroupStatus[] = segments.map((g) => ({
        title: g.title || `Segment ${g.id || ""}`,
        lineCount: (g.endLine ?? 0) - (g.startLine ?? 0) + 1,
        state: "pending" as const,
      }));
      setGroupStatuses([...statuses]);

      for (let i = 0; i < segments.length; i++) {
        const group = segments[i];
        const startLine = group.startLine ?? 0;
        const endLine = group.endLine ?? transcript.length - 1;
        const lines = transcript.slice(startLine, endLine + 1);

        statuses[i] = { ...statuses[i], state: "processing" };
        setGroupStatuses([...statuses]);

        try {
          const decisions = await processSegmentGroup(
            lines,
            startLine,
            activePrompt,
            model,
            group.title,
            group.summary,
            speakerMap
          );
          const kept = decisions.filter((d) => d.action === "keep").length;
          const removed = decisions.filter((d) => d.action === "remove").length;
          const trimmed = decisions.filter((d) => d.action === "trim").length;

          statuses[i] = { ...statuses[i], state: "done", kept, removed, trimmed };
          setGroupStatuses([...statuses]);
          allDecisions.push(...decisions);
        } catch (err) {
          console.error(`Segment ${i} error:`, err);
          statuses[i] = { ...statuses[i], state: "error" };
          setGroupStatuses([...statuses]);
          for (let j = startLine; j <= endLine; j++) {
            allDecisions.push({ index: j, action: "keep" });
          }
        }
      }
    } else {
      const statuses: SegGroupStatus[] = [
        {
          title: "Full Transcript",
          lineCount: transcript.length,
          state: "processing",
        },
      ];
      setGroupStatuses([...statuses]);

      try {
        const decisions = await processSegmentGroup(
          transcript,
          0,
          activePrompt,
          model,
          undefined,
          undefined,
          speakerMap
        );
        statuses[0] = {
          ...statuses[0],
          state: "done",
          kept: decisions.filter((d) => d.action === "keep").length,
          removed: decisions.filter((d) => d.action === "remove").length,
          trimmed: decisions.filter((d) => d.action === "trim").length,
        };
        setGroupStatuses([...statuses]);
        allDecisions.push(...decisions);
      } catch (err) {
        console.error("Processing error:", err);
        statuses[0] = { ...statuses[0], state: "error" };
        setGroupStatuses([...statuses]);
        for (let j = 0; j < transcript.length; j++) {
          allDecisions.push({ index: j, action: "keep" });
        }
      }
    }

    setLoading(false);
    onComplete(allDecisions);
  }, [activePrompt, model, transcript, segments, hasSegments, onComplete]);

  const doneCount = groupStatuses.filter(
    (s) => s.state === "done" || s.state === "error"
  ).length;
  const totalGroups = groupStatuses.length;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">LLM Edit Prompt</h2>
      <p className="text-neutral-400 mb-6 text-sm">
        {hasSegments
          ? `${segments.length} segments will each be processed as a separate LLM call.`
          : "The full transcript will be processed in one LLM call."}
      </p>

      <Card className="p-6 border-neutral-800 bg-neutral-900/50 mb-6">
        {/* Mode toggle */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setMode("default")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "default"
                ? "bg-white text-black"
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
                ? "bg-white text-black"
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

        <label className="block text-sm font-medium text-neutral-300 mb-2">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-700 text-white rounded-md px-3 py-2 text-sm mb-4"
          disabled={loading}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        <Button
          onClick={handleProcess}
          disabled={loading || !activePrompt.trim()}
          className="px-6"
        >
          {loading
            ? `Processing segment ${doneCount + 1}/${totalGroups}...`
            : "Apply Prompt"}
        </Button>
      </Card>

      {/* Progress */}
      {groupStatuses.length > 0 && (
        <Card className="p-4 border-neutral-800 bg-neutral-900/30 mb-6">
          <h3 className="text-sm font-medium text-neutral-300 mb-3">
            Processing Progress
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
