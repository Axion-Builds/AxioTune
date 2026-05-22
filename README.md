# 🎵 Apple Music Clone (Web Player)

Welcome to the **Apple Music Clone**! This is a fully functional, highly optimized, and visually stunning web-based music streaming application built to mimic the premium "Liquid Glass" design language of Apple Music. 

It uses a custom-built, anti-bot streaming architecture to fetch and play songs instantly without any lag or 0:00 playback errors!

### 🚀 Live Demo
**Try it out here:** [https://apple-music-clone-y0sq.onrender.com](https://apple-music-clone-y0sq.onrender.com)

---

## ✨ Features

- **Liquid Glass UI:** Beautiful animated background blurs, glassmorphism UI, and smooth 60fps transitions optimized for both Mobile and Desktop.
- **Instant Streaming:** Races multiple Invidious Proxy APIs to find the fastest server in real-time, bypassing datacenter bot-blocks completely.
- **Synced Lyrics:** Real-time synced lyrics with karaoke-style highlighting and lerped scrolling.
- **Infinite Queue & Radio:** Queue management with auto-generated infinite radio playback when your queue ends.
- **Search & Library:** Fast searching with suggestions, and a library to save your liked songs.
- **Responsive Design:** Converts perfectly from a desktop sidebar layout to a mobile bottom-nav layout.

---

## 📸 Screenshots

*(Upload your screenshots to a folder named `screenshots` in your GitHub repo, and they will appear here!)*

| Home Screen | Player View |
| :---: | :---: |
| ![Home](https://github.com/Axion-Builds/Apple-Music-Clone/blob/main/screenshots/Home.png.png) | ![Player](https://github.com/Axion-Builds/Apple-Music-Clone/blob/main/screenshots/player.png.png) |

| Search & Suggestions | Synced Lyrics |
| :---: | :---: |
| ![Search](shttps://github.com/Axion-Builds/Apple-Music-Clone/blob/main/screenshots/search.png.png) | ![Lyrics](shttps://github.com/Axion-Builds/Apple-Music-Clone/blob/main/screenshots/lyrics.png.png) |

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla HTML, CSS (Glassmorphism), JavaScript
- **Backend:** Python (FastAPI), Uvicorn
- **APIs Used:** 
  - `ytmusicapi` (for rich metadata and search)
  - `Invidious` (Proxy array for blazing fast audio streaming)
  - `lrclib` (for time-synced lyrics)

---

## ⚙️ How to Run Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/apple-music-clone.git
   cd apple-music-clone
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the backend server:**
   ```bash
   python backend.py
   ```

4. **Open your browser:**
   Go to `http://localhost:8000` to enjoy the music!

---

*Made with ❤️ for music lovers.*
