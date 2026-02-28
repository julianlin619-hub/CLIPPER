"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TranscriptEntry, SpeakerMap } from "@/lib/types";

interface Props {
  transcript: TranscriptEntry[];
  onComplete: (speakerMap: SpeakerMap) => void;
  onSkip: () => void;
}

function detectSpeakers(transcript: TranscriptEntry[]): number[] {
  const ids = new Set<number>();
  for (const entry of transcript) {
    for (const word of entry.words ?? []) {
      if (word.speaker != null) ids.add(word.speaker);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

const PLACEHOLDER_NAMES = ["Host", "Guest", "Interviewer", "Co-host", "Speaker 4"];

export default function SpeakerLabelStep({ transcript, onComplete, onSkip }: Props) {
  const speakerIds = detectSpeakers(transcript);
  const [names, setNames] = useState<Record<number, string>>(() =>
    Object.fromEntries(speakerIds.map((id) => [id, ""]))
  );

  // Auto-skip if 0 or 1 speaker — no labeling needed
  useEffect(() => {
    if (speakerIds.length <= 1) onSkip();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (id: number, value: string) => {
    setNames((prev) => ({ ...prev, [id]: value }));
  };

  const handleConfirm = () => {
    // Fill in any blanks with the default "Speaker N" label
    const resolved: SpeakerMap = {};
    for (const id of speakerIds) {
      resolved[id] = names[id]?.trim() || `Speaker ${id}`;
    }
    onComplete(resolved);
  };

  if (speakerIds.length <= 1) return null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Name Speakers</h2>
        <p className="text-neutral-400 text-sm">
          Deepgram found {speakerIds.length} speakers. Give them names so the AI editor
          understands who's talking.
        </p>
      </div>

      <Card className="p-6 border-neutral-800 bg-neutral-900/50 mb-6 space-y-4">
        {speakerIds.map((id, i) => (
          <div key={id} className="flex items-center gap-4">
            <span className="text-sm text-neutral-500 w-24 shrink-0 font-mono">
              Speaker {id}
            </span>
            <input
              type="text"
              value={names[id]}
              onChange={(e) => handleChange(id, e.target.value)}
              placeholder={PLACEHOLDER_NAMES[i] ?? `Speaker ${id}`}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
            />
          </div>
        ))}
      </Card>

      <div className="flex gap-3">
        <Button onClick={handleConfirm}>Confirm Names →</Button>
        <Button variant="ghost" onClick={onSkip} className="text-neutral-400">
          Skip
        </Button>
      </div>
    </div>
  );
}
