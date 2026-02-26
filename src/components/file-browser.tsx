"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BrowseEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

interface Props {
  onFileSelected: (path: string, fileName: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"];

function isVideo(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function FileBrowser({ onFileSelected }: Props) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parent, setParent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async (targetDir?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = targetDir ? `?dir=${encodeURIComponent(targetDir)}` : "";
      const res = await fetch(`/api/browse${params}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setDir(data.dir);
        setParent(data.parent);
        setEntries(data.entries || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    browse();
  }, []);

  const videoFiles = entries.filter((e) => e.type === "file" && isVideo(e.name));
  const dirs = entries.filter((e) => e.type === "directory" && !e.name.startsWith("."));
  const otherFiles = entries.filter(
    (e) => e.type === "file" && !isVideo(e.name) && !e.name.startsWith(".")
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Select Video</h2>
        <p className="text-neutral-400 text-sm">
          Browse your filesystem and select an MP4 or video file to process.
        </p>
      </div>

      {/* Path breadcrumb */}
      <Card className="p-3 mb-4 border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 font-mono truncate flex-1">{dir || "Loading..."}</span>
          {parent && parent !== dir && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => browse(parent)}
              disabled={loading}
              className="text-xs shrink-0 text-neutral-400 hover:text-white"
            >
              ↑ Up
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <div className="text-red-400 text-sm mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-lg">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-neutral-500 text-sm py-8 text-center">Loading...</div>
      )}

      {!loading && (
        <div className="space-y-1">
          {/* Video files first — highlighted */}
          {videoFiles.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-2 px-1">
                🎬 Video Files
              </p>
              {videoFiles.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => onFileSelected(entry.path, entry.name)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-neutral-700 bg-neutral-900/40 hover:bg-neutral-800/60 hover:border-neutral-600 transition-all text-left mb-1 group"
                >
                  <span className="text-lg">🎬</span>
                  <span className="flex-1 text-sm font-medium text-white truncate group-hover:text-white">
                    {entry.name}
                  </span>
                  {entry.size && (
                    <Badge variant="outline" className="text-xs border-neutral-700 text-neutral-400 shrink-0">
                      {formatSize(entry.size)}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Directories */}
          {dirs.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-neutral-500 uppercase tracking-wider font-medium mb-2 px-1">
                Folders
              </p>
              {dirs.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => browse(entry.path)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-800/40 transition-colors text-left mb-0.5"
                >
                  <span className="text-base">📁</span>
                  <span className="flex-1 text-sm text-neutral-300 truncate">
                    {entry.name}
                  </span>
                  <span className="text-neutral-600 text-xs">›</span>
                </button>
              ))}
            </div>
          )}

          {/* Other files (dimmed) */}
          {otherFiles.length > 0 && (
            <div>
              <p className="text-xs text-neutral-600 uppercase tracking-wider font-medium mb-2 px-1">
                Other Files
              </p>
              {otherFiles.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-neutral-700"
                >
                  <span className="text-base opacity-50">📄</span>
                  <span className="flex-1 text-sm truncate">{entry.name}</span>
                  {entry.size && (
                    <span className="text-xs">{formatSize(entry.size)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && dirs.length === 0 && videoFiles.length === 0 && otherFiles.length === 0 && (
            <div className="text-neutral-600 text-sm py-8 text-center">
              Empty directory
            </div>
          )}
        </div>
      )}
    </div>
  );
}
