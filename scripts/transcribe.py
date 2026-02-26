#!/usr/bin/env python3
"""Extract audio from video and transcribe with Deepgram (nova-3)."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

from deepgram import DeepgramClient

MAX_DEEPGRAM_FILE_SIZE = 25 * 1024 * 1024  # 25MB upload limit
CHUNK_DURATION_SECONDS = 600  # 10 minutes per chunk

FRAGMENT_TEMPLATE = "chunk-%03d.mp3"


def get_deepgram_client() -> DeepgramClient:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPGRAM_API_KEY not set")
    return DeepgramClient(api_key=api_key)  # v6: keyword-only


def run_command(cmd: List[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Command failed")
    return result.stdout.strip()


def get_video_metadata(video_path: str) -> tuple[float, float]:
    """Get frame rate (fps) and duration (seconds) from video via ffprobe."""
    output = run_command([
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-show_entries", "format=duration",
        "-of", "json",
        video_path,
    ])
    data = json.loads(output)
    stream = data.get("streams", [{}])[0] if data.get("streams") else {}
    fmt = data.get("format", {})

    # Parse r_frame_rate (e.g. "30000/1001" for 29.97, "30/1" for 30)
    r_fr = stream.get("r_frame_rate", "30/1")
    if "/" in str(r_fr):
        num, den = map(int, r_fr.split("/"))
        fps = num / den if den else 30.0
    else:
        fps = float(r_fr) if r_fr else 30.0

    duration = float(fmt.get("duration", 0) or 0)
    return (fps, duration)


def extract_audio(video_path: str, audio_path: str):
    """Extract audio from video using ffmpeg, compress to mp3 for API upload."""
    print(json.dumps({"status": "extracting_audio"}), flush=True)
    subprocess.run(
        [
            "ffmpeg",
            "-i",
            video_path,
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-b:a",
            "64k",
            audio_path,
            "-y",
        ],
        capture_output=True,
        check=True,
    )
    size_mb = os.path.getsize(audio_path) / (1024 * 1024)
    print(json.dumps({"status": "audio_extracted", "size_mb": round(size_mb, 1)}), flush=True)


def split_audio_if_needed(audio_path: str) -> (List[str], Optional[str]):
    size = os.path.getsize(audio_path)
    if size <= MAX_DEEPGRAM_FILE_SIZE:
        return [audio_path], None

    print(json.dumps({"status": "chunking_audio"}), flush=True)
    temp_dir = tempfile.mkdtemp(prefix="section1-chunks-")
    pattern = os.path.join(temp_dir, FRAGMENT_TEMPLATE)
    subprocess.run(
        [
            "ffmpeg",
            "-i",
            audio_path,
            "-f",
            "segment",
            "-segment_time",
            str(CHUNK_DURATION_SECONDS),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-ar",
            "16000",
            "-ac",
            "1",
            pattern,
            "-y",
        ],
        capture_output=True,
        check=True,
    )

    chunks = sorted(Path(temp_dir).glob("chunk-*.mp3"))
    if not chunks:
        raise RuntimeError("Chunking produced no files")

    chunk_paths = [str(chunk) for chunk in chunks]
    total_chunks = len(chunk_paths)
    print(json.dumps({"status": "chunking_complete", "chunks": total_chunks}), flush=True)
    return chunk_paths, temp_dir


def get_video_chunk_offsets(video_path: str, num_chunks: int) -> List[float]:
    """Pre-compute per-chunk time offsets from the original video using ffprobe.

    For each chunk index i, we probe the original video at
    i * CHUNK_DURATION_SECONDS to get the exact audio packet timestamp at that
    position.  This avoids the drift that accumulates when measuring re-encoded
    MP3 chunk durations — especially noticeable for long files where small
    per-chunk encoding errors stack up.
    """
    offsets: List[float] = []
    for i in range(num_chunks):
        target = i * CHUNK_DURATION_SECONDS
        if target == 0:
            offsets.append(0.0)
            continue
        try:
            output = run_command([
                "ffprobe",
                "-v", "error",
                "-read_intervals", f"{target}%+#1",
                "-show_entries", "packet=pts_time",
                "-select_streams", "a:0",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ])
            val = output.strip().split("\n")[0]
            offsets.append(float(val) if val and val != "N/A" else float(target))
        except Exception:
            # Fall back to the nominal boundary if ffprobe fails for this chunk
            offsets.append(float(target))
    return offsets


def build_transcript_entries(chunk_data: dict, offset: float) -> List[dict]:
    utterances = chunk_data.get("results", {}).get("utterances") or []
    if not utterances:
        channels = chunk_data.get("results", {}).get("channels", [])
        if channels:
            alt = (channels[0].get("alternatives") or [{}])[0]
            words = alt.get("words") or []
            utterances = [
                {
                    "start": words[0].get("start", 0) if words else 0,
                    "end": words[-1].get("end", 0) if words else 0,
                    "transcript": alt.get("transcript", ""),
                    "words": words,
                }
            ]

    entries: List[dict] = []
    for utt in utterances:
        raw_words = utt.get("words") or []
        entries.append(
            {
                "start": round((utt.get("start") or 0) + offset, 2),
                "end": round((utt.get("end") or 0) + offset, 2),
                "text": (utt.get("transcript") or "").strip(),
                "words": [
                    {
                        "word": word.get("punctuated_word") or word.get("word") or "",
                        "start": round((word.get("start") or 0) + offset, 3),
                        "end": round((word.get("end") or 0) + offset, 3),
                        "confidence": word.get("confidence"),
                        "speaker": word.get("speaker"),
                    }
                    for word in raw_words
                ],
            }
        )
    return entries


def transcribe(audio_path: str, video_path: str):
    """Transcribe audio using Deepgram nova-3 with word-level timestamps."""

    fps, video_duration = get_video_metadata(video_path)
    client = get_deepgram_client()
    chunk_paths, chunk_dir = split_audio_if_needed(audio_path)

    # Pre-compute offsets from the original video before entering the transcription
    # loop.  Using chunk_index * CHUNK_DURATION_SECONDS probed against the source
    # file avoids accumulated drift from measuring re-encoded MP3 chunk durations.
    total_chunks = len(chunk_paths)
    if total_chunks > 1:
        offsets = get_video_chunk_offsets(video_path, total_chunks)
    else:
        offsets = [0.0]

    transcript: List[dict] = []
    detected_language: Optional[str] = None

    try:
        for idx, chunk_path in enumerate(chunk_paths, start=1):
            print(
                json.dumps(
                    {
                        "status": "transcribing_chunk",
                        "chunk": idx,
                        "total": total_chunks,
                    }
                ),
                flush=True,
            )

            offset = offsets[idx - 1]

            with open(chunk_path, "rb") as chunk_file:
                audio_bytes = chunk_file.read()

            response = client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                model="nova-3",
                smart_format=True,
                punctuate=True,
                utterances=True,
                diarize=True,
                paragraphs=True,
            )

            chunk_data = response.model_dump()
            transcript.extend(build_transcript_entries(chunk_data, offset))

            if not detected_language:
                channels = chunk_data.get("results", {}).get("channels", [])
                if channels:
                    detected_language = channels[0].get("detected_language")
    finally:
        if chunk_dir and os.path.exists(chunk_dir):
            shutil.rmtree(chunk_dir)

    # Use video duration from ffprobe (authoritative); fall back to transcript end if probe fails
    duration = video_duration if video_duration > 0 else (transcript[-1]["end"] if transcript else 0)

    print(
        json.dumps(
            {
                "status": "done",
                "transcript": transcript,
                "duration": duration,
                "fps": round(fps, 4),
                "language": detected_language or "en",
                "model": "deepgram:nova-3",
            }
        ),
        flush=True,
    )


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <video_path>"}), flush=True)
        sys.exit(1)

    video_path = sys.argv[1]

    if not os.path.exists(video_path):
        print(json.dumps({"error": f"File not found: {video_path}"}), flush=True)
        sys.exit(1)

    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print(json.dumps({"error": "DEEPGRAM_API_KEY not set"}), flush=True)
        sys.exit(1)

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        audio_path = tmp.name

    try:
        extract_audio(video_path, audio_path)
        transcribe(audio_path, video_path)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
        sys.exit(1)
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)


if __name__ == "__main__":
    main()
