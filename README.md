# 🎵 Apple Music Streamer

A premium, Apple Music-inspired web music streaming app that streams audio from YouTube Music — built with Python (FastAPI) backend and vanilla JS frontend.


---

## ✨ Features

- 🔍 **Smart Search** — Search any song, artist, or album
- 🎵 **HQ Streaming** — Streams best available audio quality from YouTube
- 🎨 **Dynamic Theming** — Album art colors the entire UI in real time
- 📝 **Synced Lyrics** — Real-time scrolling karaoke-style lyrics via lrclib
- 💿 **Queue System** — Full playback queue with drag-to-reorder
- 🏠 **Home Feed** — Trending & personalized sections (YouTube Music sync optional)
- 🎤 **Artist Pages** — Browse discography, top songs, albums
- ❤️ **Liked Songs** — Save your favorites locally
- 🔁 **Repeat & Shuffle** — Full playback controls
- 🌌 **Audio Visualizer** — Animated waveform visualizer
- ⋮ **Song Context Menu** — Play Next, Add to Queue, Share — right-click style
- 🌐 **Mini Player** — Persistent mini player while browsing

---

## 🚀 Quick Start

### 1. Install Requirements
```bash
pip install -r requirements.txt
```

### 2. (Optional) YouTube Music Sync
To get personalized home feed recommendations, sync your YouTube Music account:
- Open the app → Settings → Sync with YouTube Music
- This uses your browser cookies (stored **locally only**, never uploaded)

### 3. Run the Server
```bash
# Windows
start_server.bat

# Or directly
python backend.py
```

### 4. Open the App
Visit: **http://localhost:8000**

---

## 📁 Project Structure

```
apple_music_streamer/
├── backend.py          # FastAPI server — search, stream, home feed
├── index.html          # Main app shell
├── app.js              # All frontend logic (~3000 lines)
├── style.css           # Premium glassmorphism UI styles
├── requirements.txt    # Python dependencies
├── start_server.bat    # One-click server start (Windows)
└── default_cover.jpg   # Fallback album art
```

---

## 🔧 Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python, FastAPI, yt-dlp, ytmusicapi |
| Frontend | Vanilla JS, CSS (glassmorphism) |
| Lyrics | lrclib.net API |
| Cover Art | iTunes API + YouTube thumbnails |
| Streaming | yt-dlp (YouTube audio) |

---

## ⚠️ Important Notes

- `headers_auth.json` (your YouTube cookies) is **gitignored** — never commit this file
- This project is for **personal/educational use only**
- Streaming copyrighted content may violate YouTube's Terms of Service in your region

---

## 📸 Screenshots

> Search results, full-screen player with lyrics, home feed — all in a premium dark glassmorphism UI.

---

*Built with ❤️ using Antigravity AI*
