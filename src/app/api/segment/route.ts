import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { transcript, prompt } = await req.json();

    if (!transcript || !prompt) {
      return NextResponse.json(
        { error: "transcript and prompt are required" },
        { status: 400 }
      );
    }

    const transcriptText = transcript
      .map(
        (t: { start: number; end: number; text: string }, i: number) =>
          `[LINE ${i}] [${t.start}s - ${t.end}s] ${t.text}`
      )
      .join("\n");

    const systemPrompt = `You are a video segmentation assistant. Given a timestamped transcript of a video, identify where logical segment breaks should occur based on the user's instructions.

For each segment, return:
- "id": sequential number starting from 1
- "title": short descriptive title for this segment
- "startLine": the LINE number where this segment begins (from the [LINE X] markers)
- "summary": brief 1-2 sentence summary of what this segment covers

The first segment should always start at line 0. Every line of the transcript must belong to exactly one segment (no gaps, no overlaps). The next segment starts where the previous one ends.

Return ONLY a valid JSON object like {"segments": [...]}, no markdown or explanation.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here is the timestamped transcript:\n\n${transcriptText}\n\nSegmentation instructions: ${prompt}`,
        },
      ],
    });

    const content = response.content[0];
    const text = content.type === "text" ? content.text : "";

    let segments: any[] = [];
    try {
      const parsed = JSON.parse(text);
      segments = Array.isArray(parsed) ? parsed : parsed.segments || [];
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        segments = Array.isArray(parsed) ? parsed : parsed.segments || [];
      }
    }

    // Enrich segments with start/end timestamps from transcript lines
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const startIdx = seg.startLine ?? 0;
      const endIdx =
        i + 1 < segments.length
          ? segments[i + 1].startLine - 1
          : transcript.length - 1;
      seg.startLine = startIdx;
      seg.endLine = endIdx;
      seg.start = transcript[startIdx]?.start ?? 0;
      seg.end = transcript[endIdx]?.end ?? 0;
    }

    return NextResponse.json({ segments });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Segmentation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
