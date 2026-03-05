# ✂️ CLIPPER

AI-powered video transcript editor. Transcribe a video, segment it by topic, use an LLM to cut filler and fluff, then export a clean FCPXML timeline for Final Cut Pro.

## What it does

1. **Select** a video file from your local filesystem
2. **Transcribe** with Deepgram (word-level timestamps)
3. **Segment** the transcript into topic sections with Claude
4. **LLM Edit** — Claude reviews each segment and marks lines to keep, trim, or remove
5. **Edit** — word-level editor to fine-tune cuts per segment
6. **Export** — downloads an FCPXML file ready for Final Cut Pro

## Requirements

- Node.js 18+
- Python 3.9+
- ffmpeg (for audio extraction)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd CLIPPER
npm install
```

### 2. Python dependencies

```bash
pip3 install -r requirements.txt
```

### 3. Install ffmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

### 4. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your API keys:

| Key | Where to get it |
|-----|----------------|
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) (optional) |

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Basic Auth (optional)

By default the app is open with no login. If you want to protect it (e.g. when sharing via Tailscale), set these in `.env.local`:

```
ACCESS_USERNAME=admin
ACCESS_PASSWORD=yourpassword
```

To disable auth entirely, delete `src/proxy.ts`.

## Notes

- Video files are read directly from your local filesystem — nothing is uploaded to external storage
- API calls go to Deepgram (transcription) and Anthropic (segmentation + editing)
- FCPXML export works with Final Cut Pro 10.6+
