# Apple Music Lyric Streamer 🎵

A fully-featured, web-based music streaming application that brings the Apple Music aesthetic to your browser with real-time synchronized lyrics. 

## Features
- **Online Streaming Pipeline:** Powered by a Python (FastAPI) backend using `yt-dlp` to extract high-quality, DRM-free audio streams.
- **Real-Time Synchronized Lyrics:** Hyper-smooth scrolling (60FPS) with a left-to-right word wipe effect, powered by the LRCLIB API.
- **High-Fidelity UI/UX:** Rotating, hue-shifting WebGL-style blurred backgrounds that dynamically match the album cover.
- **Mobile Responsive Mini-Player:** Turns into a native-feeling mini-player on smaller screens.
- **High-Resolution Album Art:** Integration with Apple Music Search API for crisp 600x600 official album covers.

## 🚀 About the Development Process
*I conceptualized the architecture and logic for this full-stack application before starting my college degree to deeply understand how frontend and backend systems communicate. I utilized AI-assisted development tools to help write and structure the code, allowing me to focus on system design, API integrations, and cloud deployment at an early stage.*

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript, WebGL-style CSS properties.
- **Backend:** Python, FastAPI, Uvicorn, yt-dlp.

## Local Setup
1. Clone the repository.
2. Install dependencies: `pip install -r requirements.txt`
3. Run the server: `uvicorn backend:app --host 0.0.0.0 --port 8000`
4. Open `http://localhost:8000` in your browser.
