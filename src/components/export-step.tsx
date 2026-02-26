"use client";

import { EditableSegment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  segments: EditableSegment[];
  fileName: string;
  duration: number;
  onExport: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ExportStep({ segments, fileName, duration, onExport }: Props) {
  const finalSegments = segments
    .filter((s) => s.action !== "remove")
    .map((seg) => {
      const keptWords = seg.words.filter((w) => !w.removed);
      const text = keptWords.map((w) => w.text).join(" ");
      if (!text.trim()) return null;

      const anyWordRemoved = seg.words.some((w) => w.removed);

      let start: number;
      let end: number;

      if (seg.action === "trim" || anyWordRemoved) {
        const firstWord = keptWords.find((w) => w.start != null);
        const lastWord = [...keptWords].reverse().find((w) => w.end != null);
        start = firstWord?.start ?? seg.start;
        end = lastWord?.end ?? seg.end;
      } else {
        start = seg.start;
        end = seg.end;
      }

      return { start, end, text };
    })
    .filter(Boolean) as { start: number; end: number; text: string }[];

  const totalDuration = finalSegments.reduce(
    (acc, s) => acc + (s.end - s.start),
    0
  );
  const cutPercentage = duration > 0
    ? Math.round(((duration - totalDuration) / duration) * 100)
    : 0;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Export</h2>
      <p className="text-neutral-400 mb-6 text-sm">
        Review the final output and download as FCP XML.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4 border-neutral-800 bg-neutral-900/50 text-center">
          <div className="text-2xl font-bold">{finalSegments.length}</div>
          <div className="text-sm text-neutral-400">segments</div>
        </Card>
        <Card className="p-4 border-neutral-800 bg-neutral-900/50 text-center">
          <div className="text-2xl font-bold">{formatTime(totalDuration)}</div>
          <div className="text-sm text-neutral-400">total duration</div>
        </Card>
        <Card className="p-4 border-neutral-800 bg-neutral-900/50 text-center">
          <div className="text-2xl font-bold text-red-400">{cutPercentage}%</div>
          <div className="text-sm text-neutral-400">cut</div>
        </Card>
      </div>

      {/* Preview */}
      <Card className="p-4 border-neutral-800 bg-neutral-900/30 mb-6">
        <h3 className="text-sm font-medium text-neutral-300 mb-3">
          Final Transcript Preview
        </h3>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {finalSegments.map((seg, i) => (
            <div key={i} className="flex gap-3 py-1">
              <Badge
                variant="outline"
                className="bg-neutral-800 border-neutral-700 text-neutral-400 shrink-0"
              >
                {formatTime(seg.start)}
              </Badge>
              <span className="text-sm text-neutral-300">{seg.text}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex gap-4">
        <Button onClick={onExport} className="px-8" size="lg">
          Download XML
        </Button>
        <p className="text-xs text-neutral-500 self-center">
          FCPXML 1.8 · Compatible with DaVinci Resolve, Final Cut Pro, Premiere
          Pro
        </p>
      </div>
    </div>
  );
}
