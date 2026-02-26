"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TranscriptEntry } from "@/lib/types";

interface Props {
  filePath: string;
  fileName: string;
  onComplete: (transcript: TranscriptEntry[], duration: number, fps: number) => void;
}

type TranscribeStatus =
  | "idle"
  | "extracting_audio"
  | "chunking_audio"
  | "transcribing"
  | "done"
  | "error";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TranscribeStep({ filePath, fileName, onComplete }: Props) {
  const [status, setStatus] = useState<TranscribeStatus>("idle");
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewLines, setPreviewLines] = useState<TranscriptEntry[]>([]);
  const [totalLines, setTotalLines] = useState(0);

  const startTranscription = async () => {
    setStatus("extracting_audio");
    setStatusText("Extracting audio from video...");
    setProgress(10);
    setError(null);

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
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
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const msg = JSON.parse(raw);

              if (msg.error) {
                setStatus("error");
                setError(msg.error);
                return;
              }

              if (msg.status === "extracting_audio") {
                setStatus("extracting_audio");
                setStatusText("Extracting audio from video...");
                setProgress(20);
              } else if (msg.status === "audio_extracted") {
                setStatusText(`Audio extracted (${msg.size_mb} MB)`);
                setProgress(35);
              } else if (msg.status === "chunking_audio") {
                setStatus("chunking_audio");
                setStatusText("Audio too large — splitting into chunks...");
                setProgress(40);
              } else if (msg.status === "chunking_complete") {
                setStatusText(`Split into ${msg.chunks} chunks`);
                setProgress(45);
              } else if (msg.status === "transcribing_chunk") {
                setStatus("transcribing");
                const pct = msg.total > 1
                  ? Math.round(45 + (msg.chunk / msg.total) * 45)
                  : 60;
                setProgress(pct);
                setStatusText(
                  msg.total > 1
                    ? `Transcribing chunk ${msg.chunk} / ${msg.total}...`
                    : "Transcribing with Deepgram nova-3..."
                );
              } else if (msg.status === "done" && msg.transcript) {
                setStatus("done");
                setProgress(100);

                const transcript: TranscriptEntry[] = msg.transcript;
                const duration =
                  typeof msg.duration === "number" && msg.duration > 0
                    ? msg.duration
                    : transcript.length > 0
                      ? transcript[transcript.length - 1].end
                      : 0;
                const fps =
                  typeof msg.fps === "number" && msg.fps > 0 ? msg.fps : 30;

                setTotalLines(transcript.length);
                setPreviewLines(transcript.slice(0, 5));
                setStatusText(
                  `Done — ${transcript.length} utterances, ${formatTime(duration)}`
                );

                onComplete(transcript, duration, fps);
              }
            } catch {
              // non-JSON lines (keepalive, stderr noise) — ignore
            }
          }
        }
      }
    } catch (e: any) {
      setStatus("error");
      setError(e.message);
    }
  };

  const statusColors: Record<TranscribeStatus, string> = {
    idle: "bg-neutral-700",
    extracting_audio: "bg-yellow-500 animate-pulse",
    chunking_audio: "bg-yellow-500 animate-pulse",
    transcribing: "bg-blue-500 animate-pulse",
    done: "bg-green-500",
    error: "bg-red-500",
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Transcribe</h2>
        <p className="text-neutral-400 text-sm">
          Deepgram nova-3 — word-level timestamps, speaker diarization, auto-chunking for large files.
        </p>
      </div>

      {/* File info card */}
      <Card className="p-4 border-neutral-800 bg-neutral-900/50 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎬</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-white truncate">{fileName}</p>
            <p className="text-xs text-neutral-500 font-mono truncate">{filePath}</p>
          </div>
          {status === "idle" && (
            <Button onClick={startTranscription} className="shrink-0">
              Start Transcription
            </Button>
          )}
        </div>
      </Card>

      {/* Progress */}
      {status !== "idle" && (
        <Card className="p-5 border-neutral-800 bg-neutral-900/30 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-3 h-3 rounded-full shrink-0 ${statusColors[status]}`} />
            <span className="text-sm text-neutral-200">{statusText}</span>
            {status === "done" && (
              <Badge className="ml-auto bg-green-900/50 text-green-400 border-green-800">
                ✓ Complete
              </Badge>
            )}
          </div>

          {status !== "done" && status !== "error" && (
            <Progress value={progress} className="h-1.5 mb-1" />
          )}

          {status === "error" && error && (
            <div className="text-red-400 text-sm mt-2 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
              {error}
            </div>
          )}
        </Card>
      )}

      {/* Transcript preview */}
      {status === "done" && previewLines.length > 0 && (
        <Card className="p-4 border-neutral-800 bg-neutral-900/30">
          <p className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-3">
            Transcript Preview ({totalLines} utterances)
          </p>
          <div className="space-y-2">
            {previewLines.map((line, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-neutral-600 font-mono text-xs shrink-0 pt-0.5">
                  {formatTime(line.start)}
                </span>
                <span className="text-neutral-300 leading-relaxed">{line.text}</span>
              </div>
            ))}
            {totalLines > 5 && (
              <p className="text-xs text-neutral-600 pt-1">
                + {totalLines - 5} more utterances...
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
