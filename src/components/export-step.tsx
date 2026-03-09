"use client";

import { useState } from "react";
import { EditableWord, SegmentGroup, TranscriptEntry } from "@/lib/types";
import { computeClipsPerSegment } from "@/lib/export";

interface Props {
  words: EditableWord[];
  segments?: SegmentGroup[];
  fileName: string;
  filePath?: string;
  duration: number;
  fps?: number;
  transcript?: TranscriptEntry[];
  fcpxmlPath?: string;
}

export default function ExportStep({ words, segments = [], fileName, duration, fps = 30, fcpxmlPath }: Props) {
  const segmentGroups = computeClipsPerSegment(words, segments);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const keptSegmentGroups = segmentGroups.map(group =>
    group.map(c => ({ start: c.start, end: c.end }))
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1">Export</h2>
        <p className="text-neutral-400 text-sm">Download your edited output.</p>
      </div>
      <div className="space-y-3">
        <button
          onClick={async () => {
            setLoading(true); setError(null);
            try {
              const res = await fetch("/api/patch-fcpxml", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fcpxmlPath, segmentGroups: keptSegmentGroups, gapSeconds: 60 }),
              });
              if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error); }
              const blob = new Blob([await res.text()], { type: "application/xml" });
              const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${baseName}_master.fcpxml` });
              a.click();
            } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
            finally { setLoading(false); }
          }}
          disabled={loading || !fcpxmlPath}
          className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-violet-500/50 bg-violet-950/30 hover:bg-violet-950/50 hover:border-violet-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
        >
          <div className="text-left">
            <p className="text-sm font-semibold text-violet-200">Export Multicam FCPXML</p>
            <p className="text-xs text-violet-400/70 mt-0.5">Original multicam FCPXML with cuts applied across all camera tracks</p>
          </div>
          <span className="text-violet-400 group-hover:text-violet-200 transition-colors text-lg">
            {loading ? "⏳" : "⬇"}
          </span>
        </button>

        {error && <p className="text-sm text-red-400 px-1">{error}</p>}
      </div>
    </div>
  );
}
