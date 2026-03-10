"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TranscriptEntry, SegmentGroup, LineDecision, SpeakerMap } from "@/lib/types";
import { parseIndexedDecisions } from "@/lib/llm";
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

interface PreviewMessage {
  speaker: number | null;
  text: string;
}

type PromptMode = "default" | "custom";
type SubStep = "prompt" | "preview";

/** Decision line regex — matches [N] KEEP / REMOVE / TRIM: text */
const DECISION_RE = /^\[(\d+)\]\s+(KEEP|REMOVE|TRIM)(?:\s*:\s*(.*))?$/i;

/** Milliseconds between each revealed word */
const WORD_INTERVAL_MS = 35;

export default function PromptStep({
  transcript,
  segments: _segments,
  speakerMap,
  onComplete,
}: Props) {
  const [mode, setMode] = useState<PromptMode>("default");
  const [customPrompt, setCustomPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [subStep, setSubStep] = useState<SubStep>("prompt");
  const [streaming, setStreaming] = useState(false);
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([]);
  /** Animated display text per bubble — may lag behind previewMessages during reveal. */
  const [displayTexts, setDisplayTexts] = useState<string[]>([]);
  /** Full raw LLM response accumulated during streaming — parsed on confirm. */
  const [rawDecisions, setRawDecisions] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePrompt = mode === "default" ? DEFAULT_EDIT_PROMPT : customPrompt;

  const isDone = !streaming && previewMessages.length > 0;

  const wordCount = previewMessages.reduce(
    (acc, m) => acc + m.text.trim().split(/\s+/).filter(Boolean).length,
    0
  );
  const origWordCount = transcript
    .map((t) => t.text.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);

  // Scroll to bottom when a new bubble appears
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [previewMessages.length]);

  // Word-by-word reveal: fires when a new message is appended
  useEffect(() => {
    if (previewMessages.length === 0) {
      setDisplayTexts([]);
      return;
    }

    // Cancel any in-progress word animation
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }

    const newIdx = previewMessages.length - 1;
    const words = previewMessages[newIdx].text.split(/\s+/).filter(Boolean);
    let wordIdx = 0;

    // Finalise all previous bubbles immediately, start new one empty
    setDisplayTexts(previewMessages.map((m, i) => (i < newIdx ? m.text : "")));

    const tick = () => {
      wordIdx++;
      setDisplayTexts((prev) => {
        const next = [...prev];
        next[newIdx] = words.slice(0, wordIdx).join(" ");
        return next;
      });
      if (wordIdx < words.length) {
        animTimerRef.current = setTimeout(tick, WORD_INTERVAL_MS);
      } else {
        animTimerRef.current = null;
      }
    };

    animTimerRef.current = setTimeout(tick, WORD_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMessages.length]);

  // When streaming ends, snap any mid-animation bubble to its full text
  useEffect(() => {
    if (!streaming && previewMessages.length > 0) {
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
      setDisplayTexts(previewMessages.map((m) => m.text));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // ── Stream structured decisions from Claude ──────────────────────────────
  const handleApplyPrompt = useCallback(async () => {
    if (!activePrompt.trim()) return;
    setError(null);
    setPreviewMessages([]);
    setDisplayTexts([]);
    setRawDecisions("");
    setStreaming(true);
    setSubStep("preview");

    try {
      const res = await fetch("/api/clip-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, prompt: activePrompt, speakerMap }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let accumulated = "";

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const match = trimmed.match(DECISION_RE);
        if (!match) return;

        const idx = parseInt(match[1], 10);
        const action = match[2].toUpperCase();
        const trimText = match[3]?.trim();
        const speaker = idx < transcript.length ? (transcript[idx].words?.[0]?.speaker ?? null) : null;

        if (action === "KEEP" && idx < transcript.length) {
          setPreviewMessages((prev) => [...prev, { speaker, text: transcript[idx].text }]);
        } else if (action === "TRIM" && trimText) {
          setPreviewMessages((prev) => [...prev, { speaker, text: trimText }]);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        lineBuffer += chunk;

        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }

      if (lineBuffer.trim()) processLine(lineBuffer);

      setRawDecisions(accumulated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubStep("prompt");
    } finally {
      setStreaming(false);
    }
  }, [activePrompt, transcript, speakerMap]);

  // ── Confirm: parse accumulated decisions directly (no paragraph matching) ─
  const handleConfirmPreview = useCallback(() => {
    const { decisions } = parseIndexedDecisions(rawDecisions, transcript.length, 0);

    const keep   = decisions.filter((d) => d.action === "keep").length;
    const remove = decisions.filter((d) => d.action === "remove").length;
    const trim   = decisions.filter((d) => d.action === "trim").length;

    onComplete(decisions);
  }, [rawDecisions, transcript, onComplete]);

  const handleRerun = useCallback(() => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    setSubStep("prompt");
    setPreviewMessages([]);
    setDisplayTexts([]);
    setRawDecisions("");
    setError(null);
  }, []);

  // ── Render: prompt entry ──────────────────────────────────────────────────
  if (subStep === "prompt") {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-1">LLM Edit Prompt</h2>
        <p className="text-neutral-400 mb-6 text-sm">
          The transcript will be sent as numbered utterances. The LLM returns
          per-line keep/remove/trim decisions.
        </p>

        <Card className="p-6 border-neutral-800 bg-neutral-900/50 mb-6">
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setMode("default")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === "default"
                  ? "bg-violet-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}
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
              />
            </>
          )}

          {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

          <Button
            onClick={handleApplyPrompt}
            disabled={!activePrompt.trim()}
            className="px-6"
          >
            Apply Prompt
          </Button>
        </Card>

        <Card className="p-4 border-neutral-800 bg-neutral-900/30">
          <p className="text-xs text-neutral-500">
            <strong className="text-neutral-400">How it works:</strong> You&apos;ll
            see the clip generate live as a conversation before moving to
            line-by-line editing.
          </p>
        </Card>
      </div>
    );
  }

  // ── Render: iMessage-style streaming preview ──────────────────────────────
  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Clip Preview</h2>
      <p className="text-neutral-400 mb-4 text-sm">
        {streaming
          ? "Generating your clip…"
          : "Review the clip, then continue to line-by-line editing."}
      </p>

      {/* Chat window */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden mb-5">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 bg-neutral-900">
          <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            Your clip
          </span>
          {isDone && (
            <span className="text-xs text-neutral-600">
              {wordCount} / {origWordCount} words&nbsp;(
              {origWordCount > 0 ? Math.round((wordCount / origWordCount) * 100) : 0}%)
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="p-4 space-y-2 max-h-[480px] overflow-y-auto">
          {previewMessages.length === 0 ? (
            <div className="flex items-center gap-2 text-neutral-600 text-sm py-2">
              <span className="inline-block w-0.5 h-4 bg-violet-400 animate-pulse align-middle" />
              <span>Waiting for model…</span>
            </div>
          ) : (
            previewMessages.map((msg, i) => {
              const isRight = msg.speaker === 1;
              const isLast = i === previewMessages.length - 1;
              const text = displayTexts[i] ?? "";
              const speakerLabel =
                msg.speaker != null
                  ? (speakerMap?.[msg.speaker] ?? `Speaker ${msg.speaker}`)
                  : "Speaker";
              const isAnimating = text.length < msg.text.length;

              return (
                <div
                  key={i}
                  className={`flex flex-col gap-0.5 ${isRight ? "items-end" : "items-start"}`}
                >
                  <span className="text-[10px] text-neutral-600 px-1">{speakerLabel}</span>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      isRight
                        ? "bg-violet-600 text-white rounded-br-sm"
                        : "bg-neutral-700 text-neutral-100 rounded-bl-sm"
                    }`}
                  >
                    {text}
                    {(isAnimating || (isLast && streaming)) && (
                      <span className="inline-block w-0.5 h-3.5 bg-current animate-pulse ml-1 align-middle opacity-70" />
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Actions fade in once streaming is done */}
      <div
        className="flex gap-3 transition-opacity duration-500"
        style={{ opacity: isDone ? 1 : 0, pointerEvents: isDone ? "auto" : "none" }}
      >
        <Button
          onClick={handleConfirmPreview}
          disabled={!rawDecisions}
          className="px-6"
        >
          Looks good — continue to edit
        </Button>
        <Button
          variant="outline"
          onClick={handleRerun}
          className="px-6 border-neutral-700 text-neutral-300 hover:text-white"
        >
          Re-run with different prompt
        </Button>
      </div>

      <p
        className="text-xs text-neutral-600 mt-4 transition-opacity duration-500"
        style={{ opacity: isDone ? 1 : 0 }}
      >
        On the next step you can fine-tune individual words before exporting.
      </p>
    </div>
  );
}
