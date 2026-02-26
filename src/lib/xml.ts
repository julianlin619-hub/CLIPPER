function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * FCPXML frame duration and time format.
 * NTSC rates use 1001/30000s (29.97) or 1001/60000s (59.94) per Apple spec.
 * Integer fps use 100/(fps*100)s = 1/fps (e.g. 100/3000s for 30fps).
 */
function getFrameTimeFormat(fps: number): {
  frameDuration: string;
  frameNum: number;
  frameDenom: number;
} {
  const ntsc2997 = Math.abs(fps - 29.97) < 0.02;
  const ntsc5994 = Math.abs(fps - 59.94) < 0.02;
  if (ntsc2997) {
    return {
      frameDuration: "1001/30000s",
      frameNum: 1001,
      frameDenom: 30000,
    };
  }
  if (ntsc5994) {
    return {
      frameDuration: "1001/60000s",
      frameNum: 1001,
      frameDenom: 60000,
    };
  }
  const effectiveFps = Math.round(fps);
  const denom = effectiveFps * 100;
  return {
    frameDuration: `100/${denom}s`,
    frameNum: 100,
    frameDenom: denom,
  };
}

/**
 * Generate FCPXML 1.8 from segments.
 * DaVinci Resolve natively imports this format (versions 1.3–1.10).
 *
 * Key design decisions:
 * - Frame rate from actual video (ffprobe); frameDuration matches video for accurate cuts.
 * - Use round for start (avoids clipping word beginnings), ceil for end (never cut off content).
 * - Offset accumulated in integer frame units to prevent floating-point drift.
 * - Duration from ffprobe when available; timecodes start at 0.
 */
export function generateFCPXML(
  segments: { start: number; end: number; text: string }[],
  sourceName: string,
  duration: number,
  fps: number = 30
): string {
  const { frameDuration, frameNum, frameDenom } = getFrameTimeFormat(fps);
  const cleanName = sourceName.replace(/\.\w+$/, "");

  let offsetFrames = 0;

  const clipElements = segments
    .map((seg) => {
      // Round start to avoid clipping word beginnings; ceil end to never cut off content
      const startFrame = Math.round(seg.start * fps);
      const endFrame = Math.ceil(seg.end * fps);
      const durFrames = Math.max(1, endFrame - startFrame);

      const offsetStr = `${offsetFrames * frameNum}/${frameDenom}s`;
      const startStr = `${startFrame * frameNum}/${frameDenom}s`;
      const durStr = `${durFrames * frameNum}/${frameDenom}s`;

      offsetFrames += durFrames;

      return `            <asset-clip ref="r1" offset="${offsetStr}" name="${escapeXml(seg.text.substring(0, 60))}" start="${startStr}" duration="${durStr}" tcFormat="NDF">
              <note>${escapeXml(seg.text)}</note>
            </asset-clip>`;
    })
    .join("\n");

  const totalDurStr = `${offsetFrames * frameNum}/${frameDenom}s`;
  const assetDurFrames = Math.ceil(duration * fps);
  const assetDurStr = `${assetDurFrames * frameNum}/${frameDenom}s`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r0" frameDuration="${frameDuration}" width="1920" height="1080" />
    <asset id="r1" name="${escapeXml(cleanName)}" src="file://./${escapeXml(sourceName)}" start="0/${frameDenom}s" duration="${assetDurStr}" hasVideo="1" hasAudio="1" format="r0" />
  </resources>
  <library>
    <event name="${escapeXml(cleanName)}">
      <project name="${escapeXml(cleanName)} - Edited">
        <sequence format="r0" duration="${totalDurStr}" tcStart="0/${frameDenom}s" tcFormat="NDF">
          <spine>
${clipElements}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}
