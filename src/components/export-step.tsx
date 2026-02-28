"use client";

import { EditableWord, TranscriptEntry } from "@/lib/types";
import {
  computeFinalClips,
  generateDebugTXT,
  generateRawTranscript,
  generateEditedTranscript,
  generateExampleTranscript,
  generateExampleDecisions,
} from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  words: EditableWord[];
  fileName: string;
  duration: number;
  onExport: () => void;
  transcript?: TranscriptEntry[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ExportStep({ words, fileName, duration, onExport, transcript }: Props) {
  const clips = computeFinalClips(words);

  const totalDuration = clips.reduce((acc, c) => acc + (c.end - c.start), 0);
  const cutPercentage =
    duration > 0 ? Math.round(((duration - totalDuration) / duration) * 100) : 0;

  const downloadFile = (content: string, name: string, mime = "text/plain") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const baseName = fileName.replace(/\.\w+$/, "");

  const handleDownloadRawTranscript = () => {
    downloadFile(generateRawTranscript(words), `${baseName}_raw_transcript.txt`);
  };

  const handleDownloadEditedTranscript = () => {
    downloadFile(generateEditedTranscript(words), `${baseName}_edited_transcript.txt`);
  };

  const handleDownloadTXT = () => {
    downloadFile(generateDebugTXT(words, fileName, duration), `${baseName}_debug.txt`);
  };

  const handleDownloadExampleTranscript = () => {
    if (!transcript) return;
    downloadFile(generateExampleTranscript(transcript, words), `${baseName}_example_transcript.txt`);
  };

  const handleDownloadExampleDecisions = () => {
    if (!transcript) return;
    downloadFile(generateExampleDecisions(words, transcript), `${baseName}_example_decisions.txt`);
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
        <Button onClick={handleDownloadRawTranscript} variant="outline" className="px-8" size="lg">
          Raw Transcript
        </Button>
        <Button onClick={handleDownloadEditedTranscript} variant="outline" className="px-8" size="lg">
          Edited Transcript
        </Button>
        <Button onClick={handleDownloadTXT} variant="outline" className="px-8" size="lg">
          Debug TXT
        </Button>
        <p className="text-xs text-neutral-500 self-center">
          FCPXML 1.8 · Compatible with DaVinci Resolve, Final Cut Pro, Premiere Pro
        </p>
      </div>

      {/* TEMPORARY: Prompt Example Export */}
      {transcript && (
        <div className="mt-4 pt-4 border-t border-neutral-800 flex gap-4 flex-wrap items-center">
          <Button onClick={handleDownloadExampleTranscript} variant="outline" className="px-8 border-yellow-700 text-yellow-400 hover:bg-yellow-950" size="lg">
            Example Transcript
          </Button>
          <Button onClick={handleDownloadExampleDecisions} variant="outline" className="px-8 border-yellow-700 text-yellow-400 hover:bg-yellow-950" size="lg">
            Example Decisions
          </Button>
          <p className="text-xs text-yellow-700 self-center">
            ⚗️ Temporary · for training example generation
          </p>
        </div>
      )}
    </div>
  );
}
