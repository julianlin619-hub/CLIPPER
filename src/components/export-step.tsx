"use client";

import { useState } from "react";
import { EditableWord, TranscriptEntry } from "@/lib/types";
import { computeFinalClips, generateSRT } from "@/lib/export";

interface Props {
  words: EditableWord[];
  fileName: string;
  duration: number;
  onExport: () => void;
  transcript?: TranscriptEntry[];
  fcpxmlPath?: string;
}

export default function ExportStep({ words, fileName, duration, fcpxmlPath }: Props) {
  const clips = computeFinalClips(words);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const baseName = fileName.replace(/\.\w+$/, "");

  const downloadFile = (content: string, name: string, mime = "text/plain") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleMasterXml = async () => {
    if (!fcpxmlPath) return;
    setPatchLoading(true);
    setPatchError(null);
    try {
      const { generateFCPXML } = await import("@/lib/xml");
      const editedXml = generateFCPXML(clips, fileName, duration, 30);
      const res = await fetch("/api/patch-fcpxml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fcpxmlPath, editedXml }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Patch failed");
      }
      const xml = await res.text();
      downloadFile(xml, `${baseName}_master.fcpxml`, "application/xml");
    } catch (e: unknown) {
      setPatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setPatchLoading(false);
    }
  };

  const handleSRT = () => {
    downloadFile(generateSRT(words), `${baseName}_captions.srt`);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1">Export</h2>
        <p className="text-neutral-400 text-sm">Download your edited output.</p>
      </div>

      <div className="space-y-3">
        <button
          onClick={handleMasterXml}
          disabled={patchLoading || !fcpxmlPath}
          className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-violet-500/50 bg-violet-950/30 hover:bg-violet-950/50 hover:border-violet-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
        >
          <div className="text-left">
            <p className="text-sm font-semibold text-violet-200">Master XML</p>
            <p className="text-xs text-violet-400/70 mt-0.5">Multicam FCPXML with cuts applied across all camera tracks</p>
          </div>
          <span className="text-violet-400 group-hover:text-violet-200 transition-colors text-lg">
            {patchLoading ? "⏳" : "⬇"}
          </span>
        </button>

        {patchError && <p className="text-sm text-red-400 px-1">{patchError}</p>}

        <button
          onClick={handleSRT}
          className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-neutral-700 bg-neutral-900/50 hover:bg-violet-950/30 hover:border-violet-500/60 transition-all group"
        >
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Captions SRT</p>
            <p className="text-xs text-neutral-500 mt-0.5">Subtitle file synced to the edited timeline</p>
          </div>
          <span className="text-neutral-500 group-hover:text-violet-300 transition-colors text-lg">⬇</span>
        </button>
      </div>
    </div>
  );
}
