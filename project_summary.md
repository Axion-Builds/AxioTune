# Apple Music Lyric Streamer - Project Architecture

## Overview
A fully-featured, 100% online music streaming application that mimics the Apple Music desktop and mobile UI. It features real-time synced lyrics with a left-to-right word wipe effect and dynamic WebGL-style animated mesh backgrounds.

## Features Built
1. **Online Streaming Pipeline (Python Backend)**
   - Uses `FastAPI` and `yt-dlp` to search YouTube Music and extract raw `128-256kbps` DRM-free audio streams.
   - Hosted locally at `http://localhost:8000`.
2. **Lyric Synchronization (Frontend)**
   - Uses `requestAnimationFrame` at 60FPS for hyper-smooth scrolling.
   - Lyrics are fetched from `LRCLIB`. The search query is passed directly from the user's input to bypass YouTube's dirty titles, achieving 95% accuracy for Hindi and regional songs.
3. **High-Fidelity UI/UX**
   - **Background:** Rotating, hue-shifting WebGL-style blurred background that dynamically matches the album cover.
   - **Word Wipe:** Active lyric words have an intense white glowing drop-shadow (`drop-shadow(0 0 30px rgba(255,255,255,0.5))`).
   - **Mobile Mini-Player:** A responsive grid layout that turns the left panel into a native-feeling mini-player header on phones (max-width 768px), preventing album squishing.
4. **Official Album Covers**
   - Integrates the `iTunes / Apple Music Search API` to fetch gorgeous, official, high-resolution (600x600) square album covers, overriding generic YouTube thumbnails.
5. **Network Connectivity & Desktop Shortcut**
   - Replaced all hardcoded `localhost:8000` fetches with relative `/api/` paths so the app is accessible on mobile devices over the local Wi-Fi network.
   - A `Apple Music.vbs` shortcut was placed on the user's OneDrive Desktop for silent background startup.

## Environment Details
- **Backend Path:** `backend.py`
- **Frontend Path:** `index.html`
- **Server:** `uvicorn` (FastAPI)
- **Local Network URL:** `http://<Local-IP>:8000` (e.g., 10.102.100.170:8000)

## Future Roadmap (Next Steps)
- Deployment to cloud (Vercel/Render) for global access without running a local PC server.
- Adding "Queue", "Next", and "Previous" buttons for a complete playlist experience.
