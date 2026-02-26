"use client";

import { EditableWord } from "@/lib/types";
import { computeFinalClips, generateDebugTXT } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  words: EditableWord[];
  fileName: string;
  duration: number;
  onExport: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ExportStep({ words, fileName, duration, onExport }: Props) {
  const clips = computeFinalClips(words);

  const totalDuration = clips.reduce((acc, c) => acc + (c.end - c.start), 0);
  const cutPercentage =
    duration > 0 ? Math.round(((duration - totalDuration) / duration) * 100) : 0;

  const handleDownloadTXT = () => {
    const txt = generateDebugTXT(words, fileName, duration);
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.\w+$/, "")}_debug.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Export</h2>
      <p className="text-neutral-400 mb-6 text-sm">
        Review the final output and download as FCP XML.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4 border-neutral-800 bg-neutral-900/50 text-center">
          <div className="text-2xl font-bold">{clips.length}</div>
          <div className="text-sm text-neutral-400">clips</div>
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
          {clips.map((clip, i) => (
            <div key={i} className="flex gap-3 py-1">
              <Badge
                variant="outline"
                className="bg-neutral-800 border-neutral-700 text-neutral-400 shrink-0"
              >
                {formatTime(clip.start)}
              </Badge>
              <span className="text-sm text-neutral-300">{clip.text}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex gap-4 flex-wrap items-center">
        <Button onClick={onExport} className="px-8" size="lg">
          Download XML
        </Button>
        <Button onClick={handleDownloadTXT} variant="outline" className="px-8" size="lg">
          Download Debug TXT
        </Button>
        <p className="text-xs text-neutral-500 self-center">
          FCPXML 1.8 · Compatible with DaVinci Resolve, Final Cut Pro, Premiere Pro
        </p>
      </div>
    </div>
  );
}
