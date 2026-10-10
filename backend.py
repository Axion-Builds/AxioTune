from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
import yt_dlp
import uvicorn
import asyncio
import httpx
import json
import os
import sys
import time
import hashlib
import re
import threading
import subprocess
import base64
from ytmusicapi import YTMusic
try:
    from ytmusicapi.navigation import nav, TAB_CONTENT
    from ytmusicapi.parsers.watch import parse_watch_playlist
except ImportError:
    nav = None
    TAB_CONTENT = None
    parse_watch_playlist = None
from typing import Dict, List, Any, Optional
from pydantic import BaseModel
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
import gc
import sqlite3
import random
import socket

# --- Memory-Safe LRU Caching & Concurrency (Tuned for Render 512MB RAM) ---
class LRUCacheDict(OrderedDict):
    """Memory-safe LRU dictionary with strict item cap and self-pruning."""
    def __init__(self, maxsize=150, *args, **kwargs):
        self.maxsize = maxsize
        super().__init__(*args, **kwargs)

    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value

    def __setitem__(self, key, value):
        if key in self:
            self.move_to_end(key)
        super().__setitem__(key, value)
        if len(self) > self.maxsize:
            self.popitem(last=False)

API_CACHE = LRUCacheDict(maxsize=150)
API_CACHE_TTL = 600  # 10 minutes cache for API responses

# ThreadPool worker pool for concurrent backend I/O requests
executor = ThreadPoolExecutor(max_workers=12)
async def run_sync(func, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, lambda: func(*args, **kwargs))

app = FastAPI()
AUTH_FILE = "headers_auth.json"
ytmusic = None

def init_db():
    conn = sqlite3.connect("music_db.sqlite")
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS liked_songs (video_id TEXT PRIMARY KEY, title TEXT, artist TEXT, cover TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS playlist_tracks (playlist_id INTEGER, video_id TEXT, title TEXT, artist TEXT, cover TEXT, position INTEGER)''')
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect("music_db.sqlite")
    conn.row_factory = sqlite3.Row
    return conn

# Caches configuration
STREAM_CACHE = LRUCacheDict(maxsize=100)
STREAM_CACHE_TTL = 600  # 10 minutes — YouTube stream URLs expire; frontend retries on error
COVER_CACHE_DIR = ".cover_cache"

if not os.path.exists(COVER_CACHE_DIR):
    os.makedirs(COVER_CACHE_DIR)

USER_PROFILE_CACHE = {"data": None, "timestamp": 0}

def configure_ytmusic_timeout(instance, timeout_secs=20.0):
    try:
        if instance and hasattr(instance, '_session') and instance._session:
            instance._session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Origin': 'https://music.youtube.com',
                'Referer': 'https://music.youtube.com/',
                'X-YouTube-Client-Name': '67',
                'X-YouTube-Client-Version': '1.20240815.01.00',
                'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8'
            })
            orig_send = instance._session.send
            def timeout_send(request, **kwargs):
                if 'timeout' not in kwargs or kwargs['timeout'] is None:
                    kwargs['timeout'] = timeout_secs
                return orig_send(request, **kwargs)
            instance._session.send = timeout_send
    except Exception:
        pass

def init_ytmusic():
    global ytmusic, USER_PROFILE_CACHE
    USER_PROFILE_CACHE = {"data": None, "timestamp": 0}
    loaded_auth = False
    if os.path.exists(AUTH_FILE):
        try:
            candidate = YTMusic(AUTH_FILE, language='en', location='IN')
            # Verify session validity by attempting to get account info
            info = candidate.get_account_info()
            ytmusic = candidate
            configure_ytmusic_timeout(ytmusic, 20.0)
            USER_PROFILE_CACHE["data"] = {
                "name": info.get("accountName", "Google User"),
                "handle": info.get("channelHandle", ""),
                "avatar": info.get("accountPhotoUrl", "")
            }
            USER_PROFILE_CACHE["timestamp"] = time.time()
            print("=== Success: Authenticated YTMusic session loaded ===")
            loaded_auth = True
        except Exception as e:
            print(f"=== Stale/expired session detected: {e}. Removing stale auth file. Falling back to guest. ===")
            try:
                os.remove(AUTH_FILE)
            except Exception:
                pass
            ytmusic = YTMusic(language='en', location='IN')
            configure_ytmusic_timeout(ytmusic, 20.0)
            loaded_auth = False
    else:
        print("=== No authenticated session found. Running as Guest. ===")
        ytmusic = YTMusic(language='en', location='IN')
        configure_ytmusic_timeout(ytmusic, 20.0)
        loaded_auth = False
    return loaded_auth

# Initialize
init_ytmusic()

def get_user_account_info(force_refresh=False):
    global USER_PROFILE_CACHE
    if not ytmusic or not os.path.exists(AUTH_FILE):
        return None
    now = time.time()
    if not force_refresh and USER_PROFILE_CACHE["data"] and (now - USER_PROFILE_CACHE["timestamp"] < 3600):
        return USER_PROFILE_CACHE["data"]
    try:
        info = ytmusic.get_account_info()
        USER_PROFILE_CACHE["data"] = {
            "name": info.get("accountName", "Google User"),
            "handle": info.get("channelHandle", ""),
            "avatar": info.get("accountPhotoUrl", "")
        }
        USER_PROFILE_CACHE["timestamp"] = now
        return USER_PROFILE_CACHE["data"]
    except Exception as e:
        print(f"Error fetching account info: {e}")
        return None


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the frontend UI
@app.get("/")
def read_root():
    return FileResponse("index.html")

@app.get("/{filename}.jpg")
def get_jpg(filename: str):
    if os.path.exists(f"{filename}.jpg"):
        return FileResponse(f"{filename}.jpg")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.svg")
def get_svg(filename: str):
    if os.path.exists(f"{filename}.svg"):
        return FileResponse(f"{filename}.svg", media_type="image/svg+xml")
    return {"error": "Not found"}

@app.get("/{filename}.png")
def get_png(filename: str):
    if os.path.exists(f"{filename}.png"):
        return FileResponse(f"{filename}.png")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.gif")
def get_gif(filename: str):
    if os.path.exists(f"{filename}.gif"):
        return FileResponse(f"{filename}.gif")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.mp4")
def get_mp4(filename: str):
    if os.path.exists(f"{filename}.mp4"):
        return FileResponse(f"{filename}.mp4", media_type="video/mp4")
    return {"error": "Not found"}

@app.get("/{filename}.css")
def get_css(filename: str):
    if os.path.exists(f"{filename}.css"):
        return FileResponse(f"{filename}.css")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.js")
def get_js(filename: str):
    if os.path.exists(f"{filename}.js"):
        return FileResponse(f"{filename}.js")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.json")
def get_json(filename: str):
    if os.path.exists(f"{filename}.json"):
        return FileResponse(f"{filename}.json", media_type="application/json")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.webp")
def get_webp(filename: str):
    if os.path.exists(f"{filename}.webp"):
        return FileResponse(f"{filename}.webp", media_type="image/webp")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.html")
def get_html(filename: str):
    if os.path.exists(f"{filename}.html"):
        return FileResponse(f"{filename}.html", media_type="text/html")
    raise HTTPException(status_code=404, detail="File not found")

def clean_cover_search_term(q: str) -> str:
    if not q:
        return ""
    # Strip brackets & parentheses content e.g. (Official Music Video), [Lyrical]
    q = re.sub(r'\[.*?\]|\(.*?\)', ' ', q)
    # Strip common record label channel names that YouTube songs are uploaded under
    q = re.sub(r'(?i)\b(t-series|tseries|zee music( company)?|sony music( india)?|speed records|tips( official)?|saregama( music)?|yrf|coke studio( india)?|white hill music|geet mp3)\b', ' ', q)
    # Strip common YouTube title noise
    q = re.sub(r'(?i)\b(official|music\s+video|video|lyrical|full\s+song|audio|hd|4k|mv|remix|lofi|slowed|reverb|teaser|trailer)\b', ' ', q)
    q = re.sub(r'\s+', ' ', q).strip()
    return q[:120]


def is_valid_yt_thumb(url: str) -> bool:
    if not url or not url.startswith('http'):
        return False
    if '/api/cover' in url or 'localhost' in url or '127.0.0.1' in url:
        return False
    return True


def extract_yt_video_id(url: str) -> str:
    if not url:
        return ""
    match = re.search(r'/vi(?:_webp)?/([^/?#]+)', url)
    if match:
        return match.group(1)
    return ""


def _is_verified_cover_match(query: str, track_name: str, artist_name: str = "") -> bool:
    if not query or not track_name:
        return False
    clean_q = re.sub(r'[^\w\s]', ' ', query).lower()
    clean_track = re.sub(r'[^\w\s]', ' ', track_name).lower()
    q_words = set(clean_q.split())
    track_words = set(clean_track.split())
    if not track_words or not q_words:
        return False
    # Exact or substring match
    if clean_track in clean_q or clean_q in clean_track:
        return True
    # Word overlap match
    overlap = q_words.intersection(track_words)
    return len(overlap) >= max(1, len(track_words) // 2)


# Persistent pooled client for lightning-fast cover lookups with keepalive (tuned for low RAM)
_COVER_CLIENT = httpx.AsyncClient(
    timeout=httpx.Timeout(3.0, connect=2.0),
    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
    limits=httpx.Limits(max_keepalive_connections=15, max_connections=30)
)

def _cache_cover_bytes(cache_path: str, data: bytes):
    if not cache_path or not data or len(data) < 800:
        return
    try:
        with open(cache_path, "wb") as f:
            f.write(data)
    except Exception:
        pass

@app.get("/api/cover")
async def get_cover(q: str = "", yt_thumb: str = "", vid: str = "", hd: bool = False):
    """
    High-performance, ultra-accurate album artwork proxy.
    1. Checks disk cache.
    2. If yt_thumb is an official Google/YTMusic square cover: upgrade to 1200x1200, cache and serve directly (100% accurate, no wrong iTunes match!).
    3. If raw video/hqdefault or yt_thumb missing, and q is provided: query iTunes with limit=5 and ONLY accept VERIFIED title matches.
    4. Fallback to YouTube maxresdefault / hqdefault of the actual video.
    5. Ultimate fallback to default_cover.jpg.
    """
    cache_key = ""
    if q:
        cache_key = hashlib.md5(f"q_{q}_{hd}_{vid}".encode('utf-8')).hexdigest()
    elif vid:
        cache_key = hashlib.md5(f"vid_{vid}_{hd}".encode('utf-8')).hexdigest()
    elif yt_thumb:
        cache_key = hashlib.md5(f"thumb_{yt_thumb}".encode('utf-8')).hexdigest()

    default_cover_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "default_cover.jpg")

    # 1. Disk Cache Hit
    cache_path = os.path.join(COVER_CACHE_DIR, f"{cache_key}.jpg") if cache_key else ""
    if cache_path and os.path.exists(cache_path) and os.path.getsize(cache_path) > 800:
        return FileResponse(cache_path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=31536000"})

    # 2. Clean inputs
    if yt_thumb and not is_valid_yt_thumb(yt_thumb):
        yt_thumb = ""

    # 3. PRIORITY 1: Authentic Google User Content / Spotify Square Album Artwork
    # If yt_thumb comes from YouTube Music (googleusercontent.com, ggpht.com, scdn.co), it is ALREADY the official album artwork!
    if yt_thumb and ("googleusercontent.com" in yt_thumb or "ggpht.com" in yt_thumb or "scdn.co" in yt_thumb):
        hd_yt_thumb = yt_thumb
        if "=" in yt_thumb and ("googleusercontent.com" in yt_thumb or "ggpht.com" in yt_thumb):
            hd_yt_thumb = yt_thumb.split("=")[0] + "=w1200-h1200-l90-rj"
        elif "ab67616d0000b273" in yt_thumb:
            hd_yt_thumb = yt_thumb.replace("ab67616d0000b273", "ab67616d00001e02")

        try:
            img_r = await _COVER_CLIENT.get(hd_yt_thumb, timeout=3.0)
            if img_r.status_code == 200 and len(img_r.content) > 1000:
                if cache_path:
                    _cache_cover_bytes(cache_path, img_r.content)
                return Response(content=img_r.content, media_type="image/jpeg",
                                headers={"Cache-Control": "public, max-age=31536000"})
        except Exception:
            pass

    # 4. Fast path for video cards when query is not provided
    target_vid = vid or extract_yt_video_id(yt_thumb)
    if target_vid and not hd and not q:
        hq_url = f"https://i.ytimg.com/vi/{target_vid}/hqdefault.jpg"
        try:
            img_r = await _COVER_CLIENT.get(hq_url, timeout=2.5)
            if img_r.status_code == 200 and len(img_r.content) > 1000:
                if cache_path:
                    _cache_cover_bytes(cache_path, img_r.content)
                return Response(content=img_r.content, media_type="image/jpeg",
                                headers={"Cache-Control": "public, max-age=86400"})
        except Exception:
            pass

    # 5. PRIORITY 2: iTunes Apple Music 1400x1400 lookup ONLY WITH VERIFIED MATCH
    # Only attempted if we don't have an official YouTube Music square cover, and query is present
    if q:
        term = clean_cover_search_term(q)
        if term:
            try:
                r = await _COVER_CLIENT.get(
                    "https://itunes.apple.com/search",
                    params={"term": term, "media": "music", "entity": "song", "limit": 5},
                    timeout=2.5
                )
                if r.status_code == 200:
                    data = r.json()
                    results = data.get("results", [])
                    # Look for the first result that actually matches the song title!
                    matched_result = None
                    for candidate in results:
                        cand_title = candidate.get("trackName", "")
                        cand_artist = candidate.get("artistName", "")
                        if _is_verified_cover_match(term, cand_title, cand_artist):
                            matched_result = candidate
                            break

                    if matched_result and matched_result.get("artworkUrl100"):
                        art_url = matched_result["artworkUrl100"].replace("100x100bb", "1400x1400bb")
                        img_r = await _COVER_CLIENT.get(art_url, timeout=3.0)
                        if img_r.status_code == 200 and len(img_r.content) > 2000:
                            if cache_path:
                                _cache_cover_bytes(cache_path, img_r.content)
                            return Response(content=img_r.content, media_type="image/jpeg",
                                            headers={"Cache-Control": "public, max-age=31536000"})
            except Exception:
                pass

    # 6. Fallback to YouTube thumbnail by videoId or yt_thumb (Guaranteed to be the actual video!)
    if yt_thumb and is_valid_yt_thumb(yt_thumb):
        try:
            img_r = await _COVER_CLIENT.get(yt_thumb, timeout=2.5)
            if img_r.status_code == 200 and len(img_r.content) > 1000:
                if cache_path:
                    _cache_cover_bytes(cache_path, img_r.content)
                return Response(content=img_r.content, media_type="image/jpeg",
                                headers={"Cache-Control": "public, max-age=86400"})
        except Exception:
            pass

    if target_vid:
        candidate_urls = []
        if hd:
            candidate_urls.append(f"https://i.ytimg.com/vi/{target_vid}/maxresdefault.jpg")
        candidate_urls.append(f"https://i.ytimg.com/vi/{target_vid}/hqdefault.jpg")

        for url in candidate_urls:
            try:
                img_r = await _COVER_CLIENT.get(url, timeout=2.0)
                if img_r.status_code == 200:
                    if len(img_r.content) < 2000 and "maxresdefault" in url:
                        continue
                    if cache_path:
                        _cache_cover_bytes(cache_path, img_r.content)
                    return Response(content=img_r.content, media_type="image/jpeg",
                                    headers={"Cache-Control": "public, max-age=86400"})
            except Exception:
                continue

    # 7. Ultimate fallback: default_cover.jpg
    if os.path.exists(default_cover_path):
        return FileResponse(default_cover_path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})
    if os.path.exists("default_cover.jpg"):
        return FileResponse("default_cover.jpg", media_type="image/jpeg")
    return Response(status_code=404)

# Live search suggestions — returns songs, artists, albums mixed
@app.get("/api/suggest")
async def suggest(q: str, filter: str = "all"):
    if not q or len(q.strip()) < 2:
        return {"results": []}
        
    cache_key = f"suggest_{q}_{filter}"
    now = time.time()
    if cache_key in API_CACHE and (now - API_CACHE[cache_key]['time']) < API_CACHE_TTL:
        return API_CACHE[cache_key]['data']
        
    try:
        results = []
        def do_search():
            if filter == "all":
                return ytmusic.search(q, limit=10)
            elif filter == "song":
                return ytmusic.search(q, filter="songs", limit=10)
            elif filter == "artist":
                return ytmusic.search(q, filter="artists", limit=10)
            elif filter == "album":
                return ytmusic.search(q, filter="albums", limit=10)
            elif filter == "video":
                return ytmusic.search(q, filter="videos", limit=10)
            return []

        search_res = await run_sync(do_search)
        
        for item in search_res:
            r_type = item.get("resultType", filter if filter != "all" else None)
            
            if r_type == "song":
                artist = item["artists"][0]["name"] if item.get("artists") else "Unknown"
                thumbnails = item.get("thumbnails", [])
                thumb = thumbnails[-1]["url"] if thumbnails else ""
                results.append({
                    "type": "song", "title": item["title"], "artist": artist,
                    "cover": thumb, "thumbnails": thumbnails, "videoId": item.get("videoId", ""),
                    "query": f"{item['title']} {artist}"
                })
            elif r_type == "artist":
                thumbnails = item.get("thumbnails", [])
                thumb = thumbnails[-1]["url"] if thumbnails else ""
                artist_name = item.get("artist")
                browse_id = item.get("browseId")
                
                if not artist_name and item.get("artists") and len(item["artists"]) > 0:
                    artist_name = item["artists"][0].get("name")
                    if not browse_id:
                        browse_id = item["artists"][0].get("id")
                        
                if not artist_name:
                    artist_name = item.get("title", "Unknown")
                    
                results.append({
                    "type": "artist", "title": artist_name, "artist": "",
                    "cover": thumb, "thumbnails": thumbnails, "browseId": browse_id or "",
                    "query": artist_name
                })
            elif r_type == "album":
                artist = item["artists"][0]["name"] if item.get("artists") else "Unknown"
                thumbnails = item.get("thumbnails", [])
                thumb = thumbnails[-1]["url"] if thumbnails else ""
                results.append({
                    "type": "album", "title": item["title"], "artist": artist,
                    "cover": thumb, "thumbnails": thumbnails, "browseId": item.get("browseId", ""),
                    "query": f"{item['title']} {artist} album"
                })
            elif r_type == "video":
                artist = item["artists"][0]["name"] if item.get("artists") else "Unknown"
                thumbnails = item.get("thumbnails", [])
                thumb = thumbnails[-1]["url"] if thumbnails else ""
                results.append({
                    "type": "video", "title": item["title"], "artist": artist,
                    "cover": thumb, "thumbnails": thumbnails, "videoId": item.get("videoId", ""),
                    "query": f"{item['title']} {artist} official music video"
                })

        res_data = {"results": results[:10]}
        API_CACHE[cache_key] = {'time': time.time(), 'data': res_data}
        return res_data
    except Exception as e:
        return {"results": [], "error": str(e)}

@app.get("/api/multi_search")
async def multi_search(q: str):
    """Fetch songs, videos, albums, and artists simultaneously for the search results page."""
    if not q or len(q.strip()) < 2:
        return {"songs": [], "videos": [], "albums": [], "artists": []}
    
    def _safe_thumb(item):
        if not item.get("thumbnails"):
            vid = item.get("videoId")
            if vid:
                return f"https://img.youtube.com/vi/{vid}/maxresdefault.jpg"
            return ""
        url = item["thumbnails"][-1]["url"]
        if "googleusercontent.com" in url or "ggpht.com" in url:
            if "=" in url:
                base = url.split("=")[0]
                return f"{base}=w800-h800-l90-rj"
        elif "img.youtube.com/vi/" in url or "i.ytimg.com/vi/" in url:
            url = url.replace('/hqdefault.jpg', '/maxresdefault.jpg').replace('/mqdefault.jpg', '/maxresdefault.jpg').replace('/sddefault.jpg', '/maxresdefault.jpg')
        return url

    def fetch_songs():
        try:
            res = ytmusic.search(q, filter="songs", limit=5)
            return [{"type": "song", "title": r["title"],
                     "artist": r["artists"][0]["name"] if r.get("artists") else "Unknown",
                     "cover": _safe_thumb(r), "videoId": r.get("videoId", ""),
                     "query": f"{r['title']} {r['artists'][0]['name'] if r.get('artists') else ''}"} for r in res]
        except Exception:
            return []

    def fetch_videos():
        try:
            res = ytmusic.search(q, filter="videos", limit=5)
            return [{"type": "video", "title": r["title"],
                     "artist": r["artists"][0]["name"] if r.get("artists") else "Unknown",
                     "cover": _safe_thumb(r), "videoId": r.get("videoId", ""),
                     "query": f"{r['title']} {r['artists'][0]['name'] if r.get('artists') else ''} official video"} for r in res]
        except Exception:
            return []

    def fetch_albums():
        try:
            res = ytmusic.search(q, filter="albums", limit=5)
            return [{"type": "album", "title": r["title"],
                     "artist": r["artists"][0]["name"] if r.get("artists") else "Unknown",
                     "cover": _safe_thumb(r), "browseId": r.get("browseId", ""),
                     "query": f"{r['title']}"} for r in res]
        except Exception:
            return []

    def fetch_artists():
        try:
            res = ytmusic.search(q, filter="artists", limit=15)
            out = []
            for r in res:
                name = r.get("artist") or (r["artists"][0]["name"] if r.get("artists") else r.get("title", "Unknown"))
                bid = r.get("browseId") or (r["artists"][0].get("id") if r.get("artists") else "")
                out.append({"type": "artist", "title": name, "artist": "",
                            "cover": _safe_thumb(r), "browseId": bid or "",
                            "query": name})
            return out
        except Exception:
            return []

    cache_key = f"multi_{q}"
    now = time.time()
    if cache_key in API_CACHE and (now - API_CACHE[cache_key]['time']) < API_CACHE_TTL:
        return API_CACHE[cache_key]['data']
        
    songs, videos, albums, artists = await asyncio.gather(
        run_sync(fetch_songs),
        run_sync(fetch_videos),
        run_sync(fetch_albums),
        run_sync(fetch_artists),
    )
    res_data = {"songs": songs, "videos": videos, "albums": albums, "artists": artists}
    API_CACHE[cache_key] = {'time': time.time(), 'data': res_data}
    return res_data

@app.get("/api/search_category")
async def search_category(q: str, type: str):
    """Fetch expanded results for a specific category."""
    if not q or len(q.strip()) < 2 or type not in ["songs", "videos", "albums", "artists"]:
        return {"results": []}
    
    cache_key = f"search_cat_{q}_{type}"
    now = time.time()
    if cache_key in API_CACHE and (now - API_CACHE[cache_key]['time']) < API_CACHE_TTL:
        return API_CACHE[cache_key]['data']
        
    def _safe_thumb(item):
        return item["thumbnails"][-1]["url"] if item.get("thumbnails") else ""

    def fetch_cat():
        try:
            res = ytmusic.search(q, filter=type, limit=20)
            out = []
            for r in res:
                title = r.get("title") or r.get("artist") or "Unknown"
                artist_name = r["artists"][0]["name"] if r.get("artists") else "Unknown"
                if type == "artists":
                    title = r.get("artist") or (r["artists"][0]["name"] if r.get("artists") else r.get("title", "Unknown"))
                    artist_name = ""
                out.append({
                    "type": type[:-1], 
                    "title": title,
                    "artist": artist_name,
                    "cover": _safe_thumb(r),
                    "videoId": r.get("videoId", ""),
                    "browseId": r.get("browseId") or (r["artists"][0].get("id") if r.get("artists") else ""),
                    "query": f"{title} {artist_name}".strip()
                })
            return out
        except Exception:
            return []
            
    results = await run_sync(fetch_cat)
    res_data = {"results": results}
    API_CACHE[cache_key] = {'time': time.time(), 'data': res_data}
    return res_data

# Endpoint to search YouTube Music and get cover art + track info
@app.get("/api/search")
async def search(q: str):
    try:
        cache_key = f"search_{q}"
        now = time.time()
        if cache_key in API_CACHE and (now - API_CACHE[cache_key]['time']) < API_CACHE_TTL:
            return API_CACHE[cache_key]['data']
            
        # Use ytmusicapi to search strictly for songs. This is 10x faster and returns studio versions, fixing lyrics desync!
        def do_search():
            results = ytmusic.search(q, filter="songs", limit=1)
            # If no song found, try all filter
            if not results:
                results = ytmusic.search(q, limit=1)
            return results
            
        results = await run_sync(do_search)
        
        if results:
            entry = results[0]
            artist = entry["artists"][0]["name"] if entry.get("artists") else "Unknown"
            thumbnail = entry["thumbnails"][-1]["url"] if entry.get("thumbnails") else ""
            
            res_data = {
                "id": entry.get("videoId"),
                "title": entry.get("title"),
                "thumbnail": thumbnail,
                "uploader": artist
            }
            API_CACHE[cache_key] = {'time': time.time(), 'data': res_data}
            return res_data
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    raise HTTPException(status_code=404, detail="No results found")

# --- OFFICIAL YOUTUBE STREAM EXTRACTOR ---
@app.get("/api/stream")
async def stream(id: str, refresh: bool = False, title: str = "", artist: str = ""):
    now = time.time()
    cache_key = id
    if not refresh and cache_key in STREAM_CACHE:
        cached = STREAM_CACHE[cache_key]
        if now - cached["cached_at"] < STREAM_CACHE_TTL:
            return {
                "url": cached["url"],
                "quality": cached["quality"],
                "format_note": cached["format_note"],
                "duration": cached.get("duration", 0),
                "cached": True,
                "source": "youtube",
                "requires_proxy": cached.get("requires_proxy", True),
                "title": cached.get("title", ""),
                "artist": cached.get("artist", "")
            }

    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'socket_timeout': 8,
        'extractor_args': {'youtube': {'player_client': ['android', 'ios']}},
    }
    try:
        if os.path.exists(AUTH_FILE):
            with open(AUTH_FILE, "r", encoding="utf-8") as f:
                auth_data = json.load(f)
                cookie_str = auth_data.get("Cookie", "")
                if cookie_str:
                    ydl_opts['http_headers'] = {'Cookie': cookie_str}
    except Exception:
        pass

    def run_ytdlp(target_id: str):
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={target_id}", download=False)
                abr = info.get('abr') or info.get('tbr') or 128
                return {
                    "url": info['url'],
                    "quality": f"{int(abr)}kbps" if abr else "160kbps",
                    "format_note": info.get('ext', 'm4a'),
                    "duration": info.get('duration', 0),
                    "cached": False,
                    "source": "youtube",
                    "requires_proxy": True,
                    "title": info.get('title', ''),
                    "artist": info.get('uploader', '') or info.get('channel', '')
                }
        except Exception as e:
            print(f"[yt-dlp Error on {target_id}]: {type(e).__name__}: {str(e)[:200]}")
            return None

    yt_res = await asyncio.to_thread(run_ytdlp, id)

    # Fallback to search if initial videoId failed and we have title metadata
    if not yt_res and title:
        try:
            search_query = f"{title} {artist}".strip()
            def search_yt_alt():
                results = ytmusic.search(search_query, filter="songs")
                if results:
                    for r in results:
                        alt_vid = r.get('videoId')
                        if alt_vid and alt_vid != id:
                            return alt_vid
                return None
            alt_id = await run_sync(search_yt_alt)
            if alt_id:
                yt_res = await asyncio.to_thread(run_ytdlp, alt_id)
        except Exception as e:
            print(f"[YouTube Alt Search Fallback Error]: {e}")

    if yt_res and yt_res.get("url"):
        STREAM_CACHE[cache_key] = {
            **yt_res,
            "cached_at": time.time()
        }
        return yt_res

    raise HTTPException(status_code=404, detail="YouTube stream extraction failed.")

@app.get("/api/proxy_stream")
async def proxy_stream(request: Request, url: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header
        
    client = httpx.AsyncClient(follow_redirects=True, timeout=10.0)
    req = client.build_request("GET", url, headers=headers)
    
    try:
        r = await client.send(req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(status_code=500, detail=str(e))
        
    response_headers = {}
    for k, v in r.headers.items():
        if k.lower() in ["content-type", "content-length", "content-range", "accept-ranges"]:
            response_headers[k] = v
            
    async def stream_generator():
        try:
            async for chunk in r.aiter_bytes(chunk_size=65536):
                yield chunk
        except (asyncio.CancelledError, httpx.RemoteProtocolError, httpx.LocalProtocolError):
            pass # Client skipped song or disconnected; silent graceful exit
        finally:
            try:
                await r.aclose()
                await client.aclose()
            except Exception:
                pass

    return StreamingResponse(
        stream_generator(), 
        status_code=r.status_code, 
        headers=response_headers,
        media_type=response_headers.get("Content-Type", "audio/webm")
    )


# Endpoint to extract the raw live streaming audio URL from YouTube
@app.get("/api/trending")
async def get_trending():
    try:
        def fetch_trending():
            top = ytmusic.search("Top Songs India Hindi Punjabi", filter="songs", limit=15)
            trend = ytmusic.search("Trending Hits India", filter="songs", limit=15)
            return top, trend
            
        top_res, trend_res = await asyncio.to_thread(fetch_trending)
        
        top_songs = []
        for item in top_res:
            artist_name = item['artists'][0]['name'] if item.get('artists') else "Unknown"
            thumbnail = item['thumbnails'][-1]['url'] if item.get('thumbnails') else ""
            vid = item.get('videoId') or ""
            top_songs.append({"title": item['title'], "artist": artist_name, "cover": thumbnail, "videoId": vid, "id": vid})
                
        trending = []
        for item in trend_res:
            artist_name = item['artists'][0]['name'] if item.get('artists') else "Unknown"
            thumbnail = item['thumbnails'][-1]['url'] if item.get('thumbnails') else ""
            vid = item.get('videoId') or ""
            trending.append({"title": item['title'], "artist": artist_name, "cover": thumbnail, "videoId": vid, "id": vid})

        return {"status": "success", "top_songs": top_songs, "trending": trending, "results": top_songs + trending}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/recommendations")
async def get_recommendations(videoId: str = "", title: str = "", artist: str = ""):
    try:
        if not videoId and not title and not artist:
            return {"status": "success", "recommendations": []}
            
        cache_key = f"recs_{videoId}_{title}_{artist}"
        now = time.time()
        if cache_key in API_CACHE and (now - API_CACHE[cache_key]['time']) < API_CACHE_TTL:
            return API_CACHE[cache_key]['data']
            
        def _find_playlist_panel(obj):
            if not isinstance(obj, dict):
                return None
            if 'playlistPanelRenderer' in obj:
                return obj['playlistPanelRenderer']
            if 'playlistPanelContinuation' in obj:
                return obj['playlistPanelContinuation']
            for v in obj.values():
                if isinstance(v, dict):
                    found = _find_playlist_panel(v)
                    if found:
                        return found
                elif isinstance(v, list):
                    for item in v:
                        if isinstance(item, dict):
                            found = _find_playlist_panel(item)
                            if found:
                                return found
            return None

        def extract_radio_from_id(target_id: str):
            if not target_id or not ytmusic:
                return []
            try:
                is_playlist = target_id.startswith(('RD', 'VL', 'PL'))
                body = {
                    'enablePersistentPlaylistPanel': True,
                    'isAudioOnly': True
                }
                if is_playlist:
                    body['playlistId'] = target_id
                else:
                    body['videoId'] = target_id
                    body['playlistId'] = f'RDAMVM{target_id}'

                resp = ytmusic._send_request('next', body)
                panel = _find_playlist_panel(resp)
                if panel and 'contents' in panel:
                    items = []
                    for c in panel['contents']:
                        vr = c.get('playlistPanelVideoRenderer')
                        if not vr:
                            continue
                        vid = vr.get('videoId')
                        r_title = ''
                        if vr.get('title', {}).get('runs'):
                            r_title = vr['title']['runs'][0].get('text', '')
                        r_artist = ''
                        if vr.get('shortBylineText', {}).get('runs'):
                            r_artist = vr['shortBylineText']['runs'][0].get('text', '')
                        thumbs = vr.get('thumbnail', {}).get('thumbnails', [])
                        r_cover = thumbs[-1].get('url', '') if thumbs else ''
                        if vid and r_title:
                            items.append({'videoId': vid, 'title': r_title, 'artist': r_artist, 'cover': r_cover})
                    if len(items) > 1:
                        return items
            except Exception as e:
                print(f"[Recs Radio {target_id}]: {e}")
            return []

        def resolve_and_fetch():
            tracks = []
            target_vid = videoId

            # 1. Direct song radio if videoId provided
            if target_vid:
                try:
                    tracks = extract_radio_from_id(target_vid)
                except Exception as e:
                    print(f"[Recs direct radio error]: {e}")

            # 2. If radio not obtained, resolve official song on YouTube Music to get true videoId
            if len(tracks) <= 1 and (title or artist):
                try:
                    query = f"{title} {artist}".strip()
                    search_res = ytmusic.search(query, filter="songs", limit=1)
                    if search_res and search_res[0].get('videoId'):
                        resolved_vid = search_res[0]['videoId']
                        tracks = extract_radio_from_id(resolved_vid)
                except Exception as e:
                    print(f"[Recs song resolve error]: {e}")

            # 3. If still no radio, fetch official Artist Radio (similar vibe & related artists)
            if len(tracks) <= 1 and (artist or title):
                try:
                    search_artist = (artist or title).split(',')[0].strip()
                    a_results = ytmusic.search(search_artist, filter="artists", limit=1)
                    if a_results and a_results[0].get('browseId'):
                        a_data = ytmusic.get_artist(a_results[0]['browseId'])
                        if a_data.get('radioId'):
                            tracks = extract_radio_from_id(a_data['radioId'])
                except Exception as e:
                    print(f"[Recs artist radio error]: {e}")

            # 4. Final safety net: Top Trending Songs (never search raw title+artist string to avoid literal word matches)
            if len(tracks) <= 1:
                try:
                    clean_art = (artist or "").split(',')[0].strip()
                    fallback_query = f"{clean_art} Top Songs" if clean_art else "Top Trending Songs"
                    tracks = ytmusic.search(fallback_query, filter="songs", limit=25) or []
                except Exception as e:
                    print(f"[Recs fallback error]: {e}")

            return tracks

        tracks = await run_sync(resolve_and_fetch)

        recs = []
        seen_vids = set()
        seen_titles = set()
        artist_counts = {}
        
        norm_playing_title = title.lower().strip() if title else ""
        if videoId:
            seen_vids.add(videoId)

        spam_keywords = ["10 hour", "10hour", "1 hour", "bass boosted", "slowed reverb", "slowed + reverb", "ringtone", "whatsapp status"]

        for item in tracks:
            vid = item.get('videoId')
            if not vid or vid in seen_vids:
                continue

            raw_title = item.get('title', 'Unknown').strip()
            lower_title = raw_title.lower().strip()

            if any(k in lower_title for k in spam_keywords):
                continue

            # Anti-duplicate: Skip if title matches playing song or is a variant (e.g. "Song (Acoustic)", "Song (Live)")
            if norm_playing_title and (norm_playing_title == lower_title or 
                                       (len(norm_playing_title) > 3 and norm_playing_title in lower_title)):
                continue

            if lower_title in seen_titles:
                continue

            artist_name = "Unknown"
            artists_list = []
            if item.get('artists') and len(item['artists']) > 0:
                artists_list = [a['name'].strip() for a in item['artists'] if a.get('name')]
                artist_name = ", ".join(artists_list)
            elif item.get('artist'):
                artist_name = item['artist'].strip()
                artists_list = [a.strip() for a in artist_name.split(',') if a.strip()]
            elif item.get('author'):
                artist_name = item['author'].strip()
                artists_list = [artist_name]

            # Primary artist anti-monopoly: max 2 songs per artist across the recommendations!
            primary_artist = artists_list[0].lower() if artists_list else "unknown"
            if primary_artist != "unknown" and artist_counts.get(primary_artist, 0) >= 2:
                continue

            thumbnail = item.get('cover') or ''
            if not thumbnail:
                thumb_list = item.get('thumbnails') or item.get('thumbnail') or []
                if isinstance(thumb_list, list) and len(thumb_list) > 0:
                    thumbnail = thumb_list[-1].get('url', '')
                elif isinstance(thumb_list, str):
                    thumbnail = thumb_list
                
            if not thumbnail:
                thumbnail = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

            seen_vids.add(vid)
            seen_titles.add(lower_title)
            artist_counts[primary_artist] = artist_counts.get(primary_artist, 0) + 1
            
            recs.append({
                "title": raw_title, 
                "artist": artist_name, 
                "cover": thumbnail,
                "videoId": vid
            })
            if len(recs) >= 25:
                break
            
        res_data = {"status": "success", "recommendations": recs}
        if recs:
            API_CACHE[cache_key] = {'time': time.time(), 'data': res_data}
        return res_data
    except Exception as e:
        return {"status": "error", "message": str(e), "recommendations": []}

@app.get("/api/home")
async def get_home():
    try:
        def fetch_home():
            return ytmusic.get_home(limit=15)
        home_data = await asyncio.to_thread(fetch_home)
        
        # Clean up the data a bit to make it easier for frontend
        clean_feed = []
        for section in home_data:
            if not section.get("contents"):
                continue
            clean_section = {
                "title": section.get("title", "Recommended"),
                "contents": []
            }
            for item in section["contents"]:
                artist_name = "Unknown"
                if item.get("artists"):
                    artist_name = item["artists"][0]["name"]
                elif item.get("description"):
                    artist_name = item["description"]
                
                thumbnail = ""
                if item.get("thumbnails"):
                    thumbnail = item["thumbnails"][-1]["url"]
                
                # Check what type of content this is
                c_type = "song"
                p_id = item.get("playlistId", "")
                b_id = item.get("browseId", "")
                
                if not p_id and b_id.startswith("VL"):
                    p_id = b_id[2:]
                elif not p_id and b_id.startswith("PL"):
                    p_id = b_id
                
                if p_id:
                    c_type = "playlist"
                elif b_id:
                    c_type = "artist" if "artist" in b_id.lower() else "album"
                
                clean_section["contents"].append({
                    "title": item.get("title", ""),
                    "artist": artist_name,
                    "cover": thumbnail,
                    "type": c_type,
                    "videoId": item.get("videoId", ""),
                    "playlistId": p_id,
                    "browseId": b_id,
                    "query": f"{item.get('title', '')} {artist_name}"
                })
            clean_feed.append(clean_section)
            
        return {"status": "success", "feed": clean_feed}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/artist")
async def get_artist(id: str):
    try:
        # If 'id' does not look like a standard YouTube channel ID, search for the artist to get the browseId
        if not (id.startswith("UC") or id.startswith("HC") or len(id) > 20):
            def find_artist_id():
                results = ytmusic.search(id, filter="artists", limit=1)
                if results:
                    return results[0]['browseId']
                return None
            
            browseId = await run_sync(find_artist_id)
            if not browseId:
                raise Exception(f"Could not find artist: {id}")
            id = browseId

        def fetch_artist():
            return ytmusic.get_artist(id)

        artist = await run_sync(fetch_artist)
        return {"status": "success", "artist": artist}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/album")
async def get_album(id: str):
    try:
        album = await asyncio.to_thread(ytmusic.get_album, id)
        return {"status": "success", "album": album}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/playlist")
async def get_playlist(id: str):
    try:
        def fetch_pl():
            return ytmusic.get_playlist(id, limit=200)
        playlist = await asyncio.to_thread(fetch_pl)
        return {"status": "success", "playlist": playlist}
    except Exception as e:
        return {"status": "error", "message": str(e)}

LYRICS_CACHE = LRUCacheDict(maxsize=100)
LYRICS_CACHE_TTL = 86400  # 24 hours
TRANSLATION_CACHE = LRUCacheDict(maxsize=100)

def parse_time_str(t_str: str) -> float:
    """Parses timestamps like '00:01:23.456', '01:23.45', '12.34s' into float seconds."""
    if not t_str:
        return 0.0
    t_str = t_str.strip().rstrip('s')
    if ':' in t_str:
        parts = t_str.split(':')
        if len(parts) == 3:
            return round(int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2]), 2)
        elif len(parts) == 2:
            return round(int(parts[0]) * 60 + float(parts[1]), 2)
    try:
        return round(float(t_str), 2)
    except Exception:
        return 0.0

def parse_ttml_lyrics(ttml_text: str):
    """Parses Apple Music TTML (Timed Text Markup Language) into structured line and word objects."""
    if not ttml_text or '<tt' not in ttml_text.lower():
        return []
    lines = []
    # Match <p begin="..." end="..."> ... </p>
    p_matches = re.findall(r'<p\s+[^>]*begin="([^"]+)"[^>]*>(.*?)</p>', ttml_text, re.DOTALL | re.IGNORECASE)
    if not p_matches:
        # Alternative pattern with begin and end anywhere in <p>
        p_matches = re.findall(r'<p\s+[^>]*begin=["\']([^"\']+)["\'][^>]*>(.*?)</p>', ttml_text, re.DOTALL | re.IGNORECASE)

    for b_str, content in p_matches:
        line_start = parse_time_str(b_str)
        # Extract <span> word tags if available: <span begin="..." end="...">word</span>
        span_matches = re.findall(r'<span\s+[^>]*begin=["\']([^"\']+)["\'][^>]*>(.*?)</span>', content, re.DOTALL | re.IGNORECASE)
        words = []
        clean_text = re.sub(r'<[^>]+>', '', content).strip()
        if not clean_text:
            continue

        if span_matches:
            for s_begin, s_text in span_matches:
                w_clean = re.sub(r'<[^>]+>', '', s_text).strip()
                if w_clean:
                    words.append({
                        "word": w_clean,
                        "time": parse_time_str(s_begin)
                    })
        else:
            words = []

        lines.append({
            "time": line_start,
            "text": clean_text,
            "isInstrumental": False,
            "words": words
        })

    return lines

def parse_synced_lrc(lrc_text: str):
    """Parses LRC timestamped lyrics string into line and word objects with smart vocal timing & 3-dot instrumental indicators."""
    if not lrc_text:
        return []

    # Check if text is actually TTML XML
    if '<tt' in lrc_text.lower() or '<p begin=' in lrc_text.lower():
        ttml_res = parse_ttml_lyrics(lrc_text)
        if ttml_res:
            return ttml_res

    parsed_raw = []
    raw_lines = lrc_text.splitlines()
    for line in raw_lines:
        line = line.strip()
        if not line:
            continue
        match = re.match(r'^\[(\d+):(\d+(?:\.\d+)?)\](.*)', line)
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            timestamp = round(minutes * 60 + seconds, 2)
            content = match.group(3).strip()
            if content:
                # Check for inline word timestamps e.g. <00:12.34>word <00:13.00>word
                word_matches = re.findall(r'<(\d+):(\d+(?:\.\d+)?)>\s*([^<]+)', content)
                inline_words = []
                if word_matches:
                    for wm in word_matches:
                        w_time = round(int(wm[0]) * 60 + float(wm[1]), 2)
                        w_text = wm[2].strip()
                        if w_text:
                            inline_words.append({"word": w_text, "time": w_time})
                    clean_text = re.sub(r'<\d+:\d+(?:\.\d+)?>', '', content).strip()
                else:
                    clean_text = content
                parsed_raw.append({"time": timestamp, "text": clean_text, "inline_words": inline_words})

    if not parsed_raw:
        return []

    lines = []
    # 1. Intro Instrumental check (if song intro > 3s before first vocal line)
    if parsed_raw[0]["time"] >= 3.0:
        lines.append({
            "time": 0.0,
            "text": "• • •",
            "isInstrumental": True,
            "words": []
        })

    for idx, item in enumerate(parsed_raw):
        timestamp = item["time"]
        text = item["text"]
        inline_words = item.get("inline_words", [])

        # Next line timestamp
        next_time = timestamp + 3.5
        if idx + 1 < len(parsed_raw):
            next_time = parsed_raw[idx + 1]["time"]

        raw_gap = max(next_time - timestamp, 0.5)
        words_list = text.split()
        num_words = len(words_list)
        vocal_dur = min(num_words * 0.48, raw_gap * 0.75)
        if vocal_dur < 0.8:
            vocal_dur = min(raw_gap, 1.2)

        if inline_words:
            words = inline_words
        else:
            words = []

        lines.append({
            "time": timestamp,
            "text": text,
            "isInstrumental": False,
            "words": words
        })

        # 2. Mid-song Instrumental break check (if gap before next line is >= 2.8s)
        vocal_end = round(timestamp + vocal_dur + 0.2, 2)
        if (next_time - vocal_end) >= 2.6 and idx + 1 < len(parsed_raw):
            lines.append({
                "time": vocal_end,
                "text": "• • •",
                "isInstrumental": True,
                "words": []
            })

    return lines

# --- 8 LYRICS PROVIDERS (lrc.red, Musixmatch, LyricsPlus, BetterLyrics, PaxSenix, SimpMusic, KuGou, LRCLIB) ---

async def fetch_lrcred_lyrics(title: str, artist: str, client: httpx.AsyncClient):
    """lrc.red: Over 29.8M tracks with TTML word-by-word and syllable-synced LRC."""
    queries = [f"{title} {artist}".strip(), title]
    for q in queries:
        if not q:
            continue
        try:
            url = "https://lrc.red/search.json"
            r = await client.get(url, params={"q": q}, headers={"User-Agent": "Mozilla/5.0"}, timeout=5.0)
            if r.status_code == 200:
                data = r.json()
                hits = data.get("hits", [])
                if hits:
                    hit = hits[0]
                    isrc = hit.get("isrc")
                    artist_name = hit.get("artist") or artist
                    if isrc:
                        # 1. Try TTML for Apple Music spec word-by-word timing
                        try:
                            ttml_res = await client.get(f"https://lrc.red/s/{isrc}.ttml", headers={"User-Agent": "Mozilla/5.0"}, timeout=4.0)
                            if ttml_res.status_code == 200 and ttml_res.text:
                                parsed_ttml = parse_ttml_lyrics(ttml_res.text)
                                if parsed_ttml:
                                    has_words = any(len(l.get("words", [])) > 1 for l in parsed_ttml)
                                    return {
                                        "id": "lrcred",
                                        "provider": "lrc.red",
                                        "provider_badge": "lrc.red",
                                        "name": f"lrc.red • {artist_name}",
                                        "type": "word_synced" if has_words else "line_synced",
                                        "lines": parsed_ttml,
                                        "raw_lrc": ttml_res.text
                                    }
                        except Exception:
                            pass

                        # 2. Fallback to LRC
                        lrc_res = await client.get(f"https://lrc.red/s/{isrc}.lrc", headers={"User-Agent": "Mozilla/5.0"}, timeout=4.0)
                        if lrc_res.status_code == 200 and lrc_res.text:
                            parsed_lrc = parse_synced_lrc(lrc_res.text)
                            if parsed_lrc:
                                has_words = any(len(l.get("words", [])) > 1 for l in parsed_lrc)
                                return {
                                    "id": "lrcred",
                                    "provider": "lrc.red",
                                    "provider_badge": "lrc.red",
                                    "name": f"lrc.red • {artist_name}",
                                    "type": "word_synced" if has_words else "line_synced",
                                    "lines": parsed_lrc,
                                    "raw_lrc": lrc_res.text
                                }
        except Exception:
            continue
    return None

async def fetch_musixmatch_lyrics(title: str, artist: str, client: httpx.AsyncClient, token_or_key: str = ""):
    """Musixmatch: Official catalog, RichSync word-by-word and line-synced lyrics."""
    params = {
        "q_track": title,
        "q_artist": artist,
        "format": "json",
        "app_id": "community-app-v1.0"
    }
    tok = (token_or_key or "").strip()
    if tok:
        if len(tok) == 32 and tok.isalnum():
            params["apikey"] = tok
        else:
            params["usertoken"] = tok

    headers = {"User-Agent": "Mozilla/5.0"}
    bases = ["https://apic.musixmatch.com/ws/1.1/", "https://api.musixmatch.com/ws/1.1/"]

    # 1. Try track.search + track.richsync.get for true word-by-word lyrics
    for base in bases:
        try:
            r = await client.get(f"{base}track.search", params={**params, "page_size": 3, "page": 1}, headers=headers, timeout=4.0)
            if r.status_code == 200:
                t_list = r.json().get("message", {}).get("body", {}).get("track_list", [])
                if t_list:
                    t_item = t_list[0].get("track", {})
                    track_id = t_item.get("track_id")
                    artist_name = t_item.get("artist_name") or artist
                    if track_id:
                        rs_params = {"track_id": track_id, "app_id": params.get("app_id")}
                        if "usertoken" in params: rs_params["usertoken"] = params["usertoken"]
                        if "apikey" in params: rs_params["apikey"] = params["apikey"]
                        r_rs = await client.get(f"{base}track.richsync.get", params=rs_params, headers=headers, timeout=4.0)
                        if r_rs.status_code == 200:
                            rs_body = r_rs.json().get("message", {}).get("body", {}).get("richsync", {}).get("richsync_body")
                            if rs_body:
                                raw_lines = json.loads(rs_body)
                                lines = []
                                for item in raw_lines:
                                    ts = float(item.get("ts", 0))
                                    words = []
                                    words_text = []
                                    for w in item.get("l", []):
                                        c = w.get("c", "").strip()
                                        o = float(w.get("o", 0))
                                        if c:
                                            words.append({"word": c, "time": round(ts + o, 2)})
                                            words_text.append(c)
                                    lines.append({
                                        "time": ts,
                                        "text": " ".join(words_text),
                                        "isInstrumental": False,
                                        "words": words
                                    })
                                if lines:
                                    return {
                                        "id": "musixmatch",
                                        "provider": "Musixmatch",
                                        "provider_badge": "Musixmatch",
                                        "name": f"Musixmatch • {artist_name}",
                                        "type": "word_synced",
                                        "lines": lines
                                    }
        except Exception:
            continue

    # 2. Try matcher.subtitle.get for line-synced lyrics
    for base in bases:
        try:
            r = await client.get(f"{base}matcher.subtitle.get", params=params, headers=headers, timeout=4.0)
            if r.status_code == 200:
                body = r.json().get("message", {}).get("body", {})
                sub_body = body.get("subtitle", {}).get("subtitle_body", "")
                if sub_body:
                    parsed = parse_synced_lrc(sub_body)
                    if parsed:
                        has_words = any(len(l.get("words", [])) > 1 for l in parsed)
                        return {
                            "id": "musixmatch",
                            "provider": "Musixmatch",
                            "provider_badge": "Musixmatch",
                            "name": f"Musixmatch • {artist}",
                            "type": "word_synced" if has_words else "line_synced",
                            "lines": parsed,
                            "raw_lrc": sub_body
                        }
        except Exception:
            continue

    # 3. Try matcher.lyrics.get for plain text lyrics fallback
    for base in bases:
        try:
            r = await client.get(f"{base}matcher.lyrics.get", params=params, headers=headers, timeout=3.5)
            if r.status_code == 200:
                lyrics_body = r.json().get("message", {}).get("body", {}).get("lyrics", {}).get("lyrics_body", "")
                if lyrics_body:
                    clean_lyr = lyrics_body.split("******* This Lyrics is NOT for Commercial use")[0].strip()
                    if clean_lyr:
                        return {
                            "id": "musixmatch_plain",
                            "provider": "Musixmatch",
                            "provider_badge": "Musixmatch",
                            "name": f"Musixmatch (Plain) • {artist}",
                            "type": "plain_text",
                            "lyrics": clean_lyr
                        }
        except Exception:
            continue
    return None

async def fetch_lyricsplus_lyrics(title: str, artist: str, client: httpx.AsyncClient):
    """LyricsPlus: Syllable by syllable, community server (v2/lyrics/get)."""
    mirrors = [
        "https://lyricsplus.binimum.org",
        "https://lyricsplus.prjktla.my.id",
        "https://lyricsplus.atomix.one"
    ]
    for base in mirrors:
        try:
            url = f"{base}/v2/lyrics/get"
            r = await client.get(url, params={"title": title, "artist": artist}, timeout=2.0)
            if r.status_code == 200:
                data = r.json()
                raw_items = data.get("lyrics", [])
                if not raw_items:
                    continue
                l_type = (data.get("type") or "").lower()
                lines = []
                for item in raw_items:
                    start = round(item.get("time", 0) / 1000.0, 2)
                    dur = item.get("duration", 0) / 1000.0
                    words = []
                    if l_type == "word":
                        for syl in item.get("syllabus", []):
                            w_text = syl.get("text", "").strip()
                            if w_text:
                                words.append({
                                    "word": w_text,
                                    "time": round(syl.get("time", 0) / 1000.0, 2)
                                })
                    lines.append({
                        "time": start,
                        "text": item.get("text", "").strip(),
                        "isInstrumental": False,
                        "words": words
                    })
                if lines:
                    has_real_words = any(len(l.get("words", [])) > 1 for l in lines)
                    return {
                        "id": "lyricsplus",
                        "provider": "LyricsPlus",
                        "provider_badge": "LyricsPlus",
                        "name": f"LyricsPlus • {artist}",
                        "type": "word_synced" if (l_type == "word" and has_real_words) else "line_synced",
                        "lines": lines
                    }
        except Exception:
            continue
    return None

async def fetch_paxsenix_lyrics(title: str, artist: str, api_key: str, client: httpx.AsyncClient):
    """PaxSenix: Apple Music timings through third-party proxy."""
    headers = {"User-Agent": "Mozilla/5.0"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key
    try:
        url = "https://lyrics.paxsenix.org/lyrics/search"
        r = await client.get(url, params={"q": f"{title} {artist}"}, headers=headers, timeout=5.0)
        if r.status_code == 200:
            data = r.json()
            ttml = data.get("ttml") or data.get("lyrics")
            if ttml and isinstance(ttml, str):
                parsed = parse_synced_lrc(ttml)
                if parsed:
                    has_words = any(len(l.get("words", [])) > 1 for l in parsed)
                    return {
                        "id": "paxsenix",
                        "provider": "PaxSenix",
                        "provider_badge": "PaxSenix",
                        "name": f"PaxSenix • {artist}",
                        "type": "word_synced" if has_words else "line_synced",
                        "lines": parsed
                    }
    except Exception:
        pass
    return None

async def fetch_betterlyrics_lyrics(title: str, artist: str, client: httpx.AsyncClient, api_key: str = ""):
    """BetterLyrics: Apple Music timings, word by word (TTML)."""
    headers = {"User-Agent": "BetterLyrics/1.0"}
    if api_key:
        headers["X-API-Key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        url = "https://lyrics-api.boidu.dev/getLyrics"
        r = await client.get(url, params={"a": artist, "s": title}, headers=headers, timeout=6.0)
        if r.status_code == 200:
            data = r.json()
            ttml = data.get("ttml")
            if ttml:
                parsed = parse_ttml_lyrics(ttml)
                if parsed:
                    has_words = any(len(l.get("words", [])) > 1 for l in parsed)
                    return {
                        "id": "betterlyrics",
                        "provider": "BetterLyrics",
                        "provider_badge": "BetterLyrics",
                        "name": f"BetterLyrics • {artist}",
                        "type": "word_synced" if has_words else "line_synced",
                        "lines": parsed,
                        "raw_lrc": ttml
                    }
    except Exception:
        pass
    return None

async def fetch_simpmusic_lyrics(videoId: str, client: httpx.AsyncClient):
    """SimpMusic: Matched on the video, so never wrong."""
    if not videoId:
        return None
    try:
        url = f"https://api-lyrics.simpmusic.org/v1/{videoId}"
        r = await client.get(url, headers={"User-Agent": "SimpMusic/1.0"}, timeout=5.0)
        if r.status_code == 200:
            data = r.json()
            lrc = data.get("lyrics") or data.get("data", {}).get("lyrics")
            if lrc and isinstance(lrc, str):
                parsed = parse_synced_lrc(lrc)
                if parsed:
                    return {
                        "id": "simpmusic",
                        "provider": "SimpMusic",
                        "provider_badge": "SimpMusic",
                        "name": "SimpMusic (Video Matched)",
                        "type": "line_synced",
                        "lines": parsed,
                        "raw_lrc": lrc
                    }
    except Exception:
        pass
    return None

async def fetch_kugou_lyrics(title: str, artist: str, client: httpx.AsyncClient):
    """KuGou: Whole lines, strong outside the US/West."""
    try:
        kw = f"{title} {artist}".strip()
        search_url = "http://mobileservice.kugou.com/api/v3/search/song"
        r1 = await client.get(search_url, params={"keyword": kw, "page": 1, "pagesize": 2}, headers={"User-Agent": "KuGou/10.0"}, timeout=1.5)
        if r1.status_code != 200:
            return None
        info = r1.json().get("data", {}).get("info", [])
        if not info:
            return None
        hash_val = info[0].get("hash")
        if not hash_val:
            return None

        # Step 2: Search lyrics candidates by hash
        r2 = await client.get("http://lyrics.kugou.com/search", params={"ver": 1, "man": "yes", "client": "mobi", "hash": hash_val}, timeout=1.5)
        if r2.status_code != 200:
            return None
        cands = r2.json().get("candidates", [])
        if not cands:
            return None
        cand = cands[0]
        lrc_id = cand.get("id")
        accesskey = cand.get("accesskey")

        # Step 3: Download LRC
        r3 = await client.get("http://lyrics.kugou.com/download", params={"ver": 1, "client": "pc", "id": lrc_id, "accesskey": accesskey, "fmt": "lrc"}, timeout=1.5)
        if r3.status_code != 200:
            return None
        b64 = r3.json().get("content", "")
        if not b64:
            return None
        lrc_text = base64.b64decode(b64).decode("utf-8", errors="ignore")
        parsed = parse_synced_lrc(lrc_text)
        if parsed:
            return {
                "id": "kugou",
                "provider": "KuGou",
                "provider_badge": "KuGou",
                "name": f"KuGou • {artist}",
                "type": "line_synced",
                "lines": parsed,
                "raw_lrc": lrc_text
            }
    except Exception:
        pass
    return None

async def fetch_lrclib_lyrics(title: str, artist: str, client: httpx.AsyncClient):
    """LRCLIB: Synced and Plain lyrics provider."""
    queries = [f"{title} {artist}".strip(), title]
    found_sources = []
    for q in queries:
        if not q or found_sources:
            continue
        try:
            r = await client.get("https://lrclib.net/api/search", params={"q": q}, timeout=4.0)
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, list) and data:
                    has_synced = False
                    has_plain = False
                    for item in data:
                        synced = item.get("syncedLyrics")
                        plain = item.get("plainLyrics")
                        artist_name = item.get("artistName") or artist
                        if synced and not has_synced:
                            parsed = parse_synced_lrc(synced)
                            if parsed:
                                has_words = any(len(l.get("words", [])) > 1 for l in parsed)
                                found_sources.append({
                                    "id": "lrclib",
                                    "provider": "LRCLIB",
                                    "provider_badge": "LRCLIB",
                                    "name": f"LRCLIB (Synced) • {artist_name}",
                                    "type": "word_synced" if has_words else "line_synced",
                                    "lines": parsed,
                                    "raw_lrc": synced
                                })
                                has_synced = True
                        if plain and not has_plain:
                            found_sources.append({
                                "id": "lrclib_plain",
                                "provider": "LRCLIB",
                                "provider_badge": "LRCLIB",
                                "name": f"LRCLIB (Plain) • {artist_name}",
                                "type": "plain_text",
                                "lyrics": plain
                            })
                            has_plain = True
                        if has_synced and has_plain:
                            break
        except Exception:
            continue
    return found_sources if found_sources else None

@app.get("/api/lyrics")
async def get_lyrics(
    videoId: str = "",
    title: str = "",
    artist: str = "",
    order: str = "lrcred,musixmatch,lyricsplus,betterlyrics,paxsenix,simpmusic,kugou,lrclib",
    prioritize_syllable: bool = True,
    paxsenix_key: str = "",
    betterlyrics_key: str = "",
    musixmatch_key: str = ""
):
    cache_key = f"lyrics_{videoId}_{title}_{artist}_{order}_{prioritize_syllable}_{bool(paxsenix_key)}_{bool(betterlyrics_key)}_{bool(musixmatch_key)}"
    now = time.time()
    if cache_key in LYRICS_CACHE and (now - LYRICS_CACHE[cache_key]['time']) < LYRICS_CACHE_TTL:
        return LYRICS_CACHE[cache_key]['data']

    c_title = clean_cover_search_term(title or "")
    c_artist = clean_cover_search_term((artist or "").split(',')[0].split('&')[0])

    provider_keys = [k.strip().lower() for k in (order or "").split(",") if k.strip()]
    if not provider_keys:
        provider_keys = ["lrcred", "musixmatch", "lyricsplus", "betterlyrics", "paxsenix", "simpmusic", "kugou", "lrclib"]

    sources = []
    active_source = None

    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}, timeout=4.5) as client:
        # Build tasks for enabled providers in user's priority order
        tasks = []
        for p_key in provider_keys:
            if p_key in ("lrcred", "lrc_red", "lrc.red"):
                tasks.append(("lrcred", fetch_lrcred_lyrics(c_title, c_artist, client)))
            elif p_key in ("musixmatch", "musicxmatch"):
                if musixmatch_key:
                    tasks.append(("musixmatch", fetch_musixmatch_lyrics(c_title, c_artist, client, musixmatch_key)))
            elif p_key == "lyricsplus":
                tasks.append(("lyricsplus", fetch_lyricsplus_lyrics(c_title, c_artist, client)))
            elif p_key == "betterlyrics":
                tasks.append(("betterlyrics", fetch_betterlyrics_lyrics(c_title, c_artist, client, betterlyrics_key)))
            elif p_key == "paxsenix":
                if paxsenix_key:
                    tasks.append(("paxsenix", fetch_paxsenix_lyrics(c_title, c_artist, paxsenix_key, client)))
            elif p_key == "simpmusic":
                tasks.append(("simpmusic", fetch_simpmusic_lyrics(videoId, client)))
            elif p_key == "kugou":
                tasks.append(("kugou", fetch_kugou_lyrics(c_title, c_artist, client)))
            elif p_key == "lrclib":
                tasks.append(("lrclib", fetch_lrclib_lyrics(c_title, c_artist, client)))

        # Also fetch YouTube Music official lyrics concurrently
        yt_task = None
        if ytmusic and (videoId or c_title or c_artist):
            def fetch_yt_lyrics():
                target_ids = []
                if videoId:
                    target_ids.append(videoId)
                if c_title or c_artist:
                    try:
                        q_search = f"{c_title} {c_artist}".strip()
                        if q_search:
                            songs = ytmusic.search(q_search, filter="songs", limit=2)
                            for s in songs:
                                sid = s.get("videoId")
                                if sid and sid not in target_ids:
                                    target_ids.append(sid)
                    except Exception:
                        pass
                for tid in target_ids:
                    try:
                        res = ytmusic._send_request('next', {'videoId': tid, 'isAudioOnly': True})
                        tabs = res.get('contents', {}).get('singleColumnMusicWatchNextResultsRenderer', {}).get('tabbedRenderer', {}).get('watchNextTabbedResultsRenderer', {}).get('tabs', [])
                        for t in tabs:
                            tr = t.get('tabRenderer', {})
                            if 'Lyrics' in str(tr.get('title', '')):
                                browse_id = tr.get('endpoint', {}).get('browseEndpoint', {}).get('browseId')
                                if browse_id:
                                    lyr = ytmusic.get_lyrics(browse_id)
                                    if lyr and lyr.get('lyrics'):
                                        return lyr
                    except Exception:
                        continue
                return None
            yt_task = asyncio.wait_for(asyncio.to_thread(fetch_yt_lyrics), timeout=4.0)

        # Run all provider fetches concurrently
        coros = [t[1] for t in tasks]
        if yt_task:
            coros.append(yt_task)
        results = await asyncio.gather(*coros, return_exceptions=True)

        # Map provider results in user's priority order
        provider_results = results[:len(tasks)]
        for i, res in enumerate(provider_results):
            if isinstance(res, list):
                for item in res:
                    if isinstance(item, dict) and item:
                        sources.append(item)
            elif isinstance(res, dict) and res:
                sources.append(res)

        # Append YouTube Music official lyrics to sources if found
        if yt_task and len(results) > len(tasks):
            yt_res = results[-1]
            if isinstance(yt_res, dict) and yt_res.get("lyrics"):
                sources.append({
                    "id": "ytmusic",
                    "provider": "YouTube",
                    "provider_badge": "YT Music",
                    "name": "YouTube Music (Official)",
                    "type": "plain_text",
                    "lyrics": yt_res.get("lyrics", "")
                })

        # Strict Guarantee: Any non-word_synced source must never contain word timestamps
        for s in sources:
            if s.get("type") != "word_synced" and "lines" in s and isinstance(s["lines"], list):
                for l in s["lines"]:
                    if isinstance(l, dict):
                        l["words"] = []

    # Pick active source strictly following user rules:
    # 1. Strictly look for true word-by-word (type == "word_synced")
    # 2. If no word-by-word, strictly fallback to line-synced (type == "line_synced")
    # 3. If no line-synced, fallback to plain text (type == "plain_text")
    if sources:
        if prioritize_syllable:
            for s in sources:
                if s.get("type") == "word_synced":
                    active_source = s
                    break
            if not active_source:
                for s in sources:
                    if s.get("type") == "line_synced":
                        active_source = s
                        break
            if not active_source:
                for s in sources:
                    if s.get("type") == "plain_text":
                        active_source = s
                        break
            if not active_source:
                active_source = sources[0]
        else:
            active_source = sources[0]

    if active_source:
        res = {
            "status": "success",
            "type": active_source.get("type"),
            "lines": active_source.get("lines", []),
            "lyrics": active_source.get("lyrics", ""),
            "raw_lrc": active_source.get("raw_lrc", ""),
            "source": active_source.get("name"),
            "provider": active_source.get("provider"),
            "provider_badge": active_source.get("provider_badge", active_source.get("provider", "")),
            "sources": sources
        }
        LYRICS_CACHE[cache_key] = {'time': time.time(), 'data': res}
        return res

    return {"status": "error", "message": "No lyrics found", "sources": []}

@app.post("/api/translate-lyrics")
async def translate_lyrics_endpoint(request: Request):
    """Batch-translates lyric text lines into target language with fast in-memory caching."""
    try:
        body = await request.json()
        lines = body.get("lines", [])
        target_lang = body.get("target_lang", "en")

        if not lines:
            return {"status": "success", "translations": []}

        cache_id = f"{target_lang}_{hash(tuple(lines[:25]))}"
        if cache_id in TRANSLATION_CACHE:
            return {"status": "success", "translations": TRANSLATION_CACHE[cache_id]}

        translations = [""] * len(lines)
        valid_indices = []
        valid_texts = []

        for idx, l in enumerate(lines):
            text = (l or "").strip()
            if text and text != "• • •" and len(text) > 1:
                valid_indices.append(idx)
                valid_texts.append(text)

        if not valid_texts:
            return {"status": "success", "translations": translations}

        # Translate in batches of 30 lines with delimiter
        delim = " __NL__ "
        batch_size = 30
        async with httpx.AsyncClient(timeout=6.0) as client:
            for b_start in range(0, len(valid_texts), batch_size):
                b_end = min(b_start + batch_size, len(valid_texts))
                chunk_texts = valid_texts[b_start:b_end]
                chunk_indices = valid_indices[b_start:b_end]
                
                payload = delim.join(chunk_texts)
                try:
                    r = await client.get("https://translate.googleapis.com/translate_a/single", params={
                        "client": "gtx", "sl": "auto", "tl": target_lang, "dt": "t", "q": payload
                    })
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                            joined = "".join([item[0] for item in data[0] if item and item[0]])
                            # Split by delimiter (handling case variations)
                            parts = re.split(r'\s*__\s*nl\s*__\s*', joined, flags=re.IGNORECASE)
                            for p_idx, part in enumerate(parts):
                                if p_idx < len(chunk_indices):
                                    real_idx = chunk_indices[p_idx]
                                    translations[real_idx] = part.strip()
                except Exception as b_err:
                    print("Batch translation error:", b_err)

        TRANSLATION_CACHE[cache_id] = translations
        return {"status": "success", "translations": translations}
    except Exception as e:
        return {"status": "error", "message": str(e), "translations": []}

def format_headers(raw_input: str) -> str:
    raw_input = raw_input.strip()
    if not raw_input:
        return ""
    
    # Parse cURL command if pasted
    if "curl " in raw_input.lower():
        # Try matching single quotes first
        matches = re.findall(r'(?:-H|--header)\s+[\'"]([^\'"]+)[\'"]', raw_input, re.IGNORECASE)
        if not matches:
            # Fallback for double quotes
            matches = re.findall(r'(?:-H|--header)\s+"([^"]+)"', raw_input, re.IGNORECASE)
        
        headers = []
        for match in matches:
            if ":" in match:
                headers.append(match)
        if headers:
            return "\n".join(headers)
            
    if "cookie:" not in raw_input.lower() and ";" in raw_input and "=" in raw_input:
        return f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\nCookie: {raw_input}"
    return raw_input

class SyncRequest(BaseModel):
    headers: str

ACTIVE_LOGIN_PROCESS = None
LOGIN_LOCK = threading.Lock()
LOGIN_STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "login_state.json")

def check_playwright_capability():
    is_headless_cloud = bool(
        os.environ.get('RENDER') or 
        (sys.platform.startswith('linux') and not os.environ.get('DISPLAY'))
    )
    if is_headless_cloud:
        return False, "cloud_mode", "Cloud Server: Direct desktop window is available when running locally on PC. On Web/Render, please connect with your YouTube Music cookie or cURL token below!"

    try:
        from playwright.sync_api import sync_playwright
        return True, "available", "Playwright is ready."
    except ImportError:
        return False, "missing_module", "Playwright is not installed. To use 1-click desktop popup, run 'pip install playwright && playwright install chromium' locally, or connect with your cookie below."

@app.get("/api/auth/status")
@app.get("/api/sync_status")
def sync_status():
    is_synced = os.path.exists(AUTH_FILE)
    user_info = None
    if is_synced:
        user_info = get_user_account_info()
    return {
        "synced": is_synced,
        "user": user_info
    }

@app.post("/api/auth/cancel_login")
def cancel_interactive_login():
    global ACTIVE_LOGIN_PROCESS
    if ACTIVE_LOGIN_PROCESS and ACTIVE_LOGIN_PROCESS.poll() is None:
        try:
            ACTIVE_LOGIN_PROCESS.terminate()
        except Exception:
            pass
    ACTIVE_LOGIN_PROCESS = None
    try:
        with open(LOGIN_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "status": "cancelled",
                "message": "Login cancelled by user.",
                "updated_at": time.time()
            }, f)
    except Exception:
        pass
    return {"status": "cancelled"}

@app.post("/api/auth/start_login")
def start_interactive_login():
    global ACTIVE_LOGIN_PROCESS
    can_run, mode, reason = check_playwright_capability()
    if not can_run:
        try:
            with open(LOGIN_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "status": "manual_required",
                    "message": reason,
                    "error": reason,
                    "updated_at": time.time()
                }, f)
        except Exception:
            pass
        return {
            "status": "manual_required",
            "mode": mode,
            "message": reason
        }

    if ACTIVE_LOGIN_PROCESS and ACTIVE_LOGIN_PROCESS.poll() is None:
        return {"status": "in_progress", "message": "Login window is already active."}

    # Reset state file
    try:
        with open(LOGIN_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "status": "in_progress",
                "message": "Opening secure login window...",
                "started_at": time.time()
            }, f)
    except Exception:
        pass

    worker_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yt_login_worker.py")
    ACTIVE_LOGIN_PROCESS = subprocess.Popen([sys.executable, worker_script])
    return {"status": "started", "message": "Login window opened. Please sign in."}

@app.get("/api/auth/login_poll")
def poll_interactive_login():
    global ACTIVE_LOGIN_PROCESS
    state = {
        "status": "idle",
        "message": "",
        "error": None,
        "user": None,
        "synced": os.path.exists(AUTH_FILE)
    }
    if os.path.exists(LOGIN_STATE_FILE):
        try:
            with open(LOGIN_STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                state["status"] = data.get("status", "idle")
                state["message"] = data.get("message", "")
                state["error"] = data.get("error")
        except Exception:
            pass

    if state["status"] == "in_progress":
        if ACTIVE_LOGIN_PROCESS and ACTIVE_LOGIN_PROCESS.poll() is not None:
            # Process exited without success
            if not os.path.exists(AUTH_FILE):
                state["status"] = "cancelled"
                state["message"] = "Login window was closed."

    if state["status"] == "success":
        if init_ytmusic():
            user_info = get_user_account_info(force_refresh=True)
            state["user"] = user_info
            state["synced"] = True

    return state

def save_headers_to_json(headers_str: str, filepath: str):
    headers_dict = {}
    for line in headers_str.splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" in line:
            parts = line.split(":", 1)
            key = parts[0].strip()
            value = parts[1].strip()
            normalized_key = "-".join([w.capitalize() for w in key.split("-")])
            headers_dict[normalized_key] = value
            
    cookie_key = next((k for k in headers_dict if k.lower() == 'cookie'), None)
    if not cookie_key or ("__Secure-3PAPISID" not in headers_dict[cookie_key] and "SAPISID" not in headers_dict[cookie_key]):
        raise ValueError("Your cookie is missing the required secure credential (__Secure-3PAPISID / SAPISID). Please ensure you are logged in to YouTube Music on music.youtube.com.")
        
    headers_dict["Authorization"] = "SAPISIDHASH dummy_value"
    headers_dict["Origin"] = "https://music.youtube.com"
    headers_dict["x-goog-authuser"] = "0"
    
    ua_key = next((k for k in headers_dict if k.lower() == 'user-agent'), None)
    if not ua_key:
        headers_dict["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(headers_dict, f, indent=4)

@app.post("/api/sync")
async def sync_account(req: SyncRequest):
    try:
        processed_headers = format_headers(req.headers)
        if not processed_headers:
            return {"status": "error", "message": "Headers input is empty."}
            
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
            
        def run_setup():
            save_headers_to_json(processed_headers, AUTH_FILE)
            
        await asyncio.to_thread(run_setup)
        
        success = await asyncio.to_thread(init_ytmusic)
        if success:
            user_info = get_user_account_info(force_refresh=True)
            return {"status": "success", "message": "Successfully synced with YouTube Music!", "user": user_info}
        else:
            if os.path.exists(AUTH_FILE):
                os.remove(AUTH_FILE)
            return {"status": "error", "message": "Failed to authenticate. Make sure to copy headers correctly."}
    except Exception as e:
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
        return {"status": "error", "message": str(e)}

class CookieRequest(BaseModel):
    cookie: str

@app.post("/api/sync_bookmark")
async def sync_bookmark(req: CookieRequest):
    try:
        cookie_val = req.cookie.strip()
        if not cookie_val:
            return {"status": "error", "message": "Cookie is empty."}
            
        headers_str = f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\nCookie: {cookie_val}"
        
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
            
        def run_setup():
            save_headers_to_json(headers_str, AUTH_FILE)
            
        await asyncio.to_thread(run_setup)
        
        success = await asyncio.to_thread(init_ytmusic)
        if success:
            user_info = get_user_account_info(force_refresh=True)
            return {"status": "success", "message": "Successfully synced with YouTube Music!", "user": user_info}
        else:
            if os.path.exists(AUTH_FILE):
                os.remove(AUTH_FILE)
            return {"status": "error", "message": "Failed to authenticate with copied cookies."}
    except Exception as e:
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
        return {"status": "error", "message": str(e)}

class LikeRequest(BaseModel):
    id: str
    action: str

@app.post("/api/like_song")
def like_song(req: LikeRequest):
    if not ytmusic:
        return {"status": "error", "message": "Not authenticated with YouTube Music"}
    try:
        status = ytmusic.rate_song(req.id, req.action)
        return {"status": "success", "result": status}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/unsync")
@app.post("/api/auth/logout")
def unsync_account():
    if os.path.exists(AUTH_FILE):
        try:
            os.remove(AUTH_FILE)
        except Exception:
            pass
    global ytmusic, USER_PROFILE_CACHE, LOGIN_SESSION
    USER_PROFILE_CACHE = {"data": None, "timestamp": 0}
    with LOGIN_LOCK:
        LOGIN_SESSION["status"] = "idle"
        LOGIN_SESSION["user"] = None
        LOGIN_SESSION["error"] = None
    init_ytmusic()
    return {"status": "success", "message": "Disconnected successfully.", "synced": False}

@app.get("/api/history")
async def get_history_feed():
    if not ytmusic or not os.path.exists(AUTH_FILE):
        return {"status": "error", "message": "Not authenticated. Sign in with YouTube Music first.", "items": []}
    
    def fetch_history():
        try:
            raw_history = ytmusic.get_history()
            items = []
            for song in raw_history:
                vid = song.get("videoId")
                if not vid:
                    continue
                title = song.get("title", "Unknown")
                artists = song.get("artists", [])
                artist = ", ".join([a.get("name", "") for a in artists]) if artists else "Unknown Artist"
                cover = ""
                if song.get("thumbnails"):
                    cover = song["thumbnails"][-1]["url"]
                items.append({
                    "id": vid,
                    "title": title,
                    "artist": artist,
                    "cover": cover,
                    "duration": song.get("duration", ""),
                    "album": song.get("album", {}).get("name", "") if isinstance(song.get("album"), dict) else "",
                    "type": "song"
                })
            return items
        except Exception as e:
            print(f"Error fetching history: {e}")
            return []

    items = await asyncio.to_thread(fetch_history)
    return {"status": "success", "items": items}

class PlaybackReportRequest(BaseModel):
    id: str

@app.post("/api/playback/report")
async def report_playback(req: PlaybackReportRequest):
    if not ytmusic or not os.path.exists(AUTH_FILE):
        return {"status": "guest_ignored"}
    
    def do_report():
        try:
            song = ytmusic.get_song(req.id)
            if song and "playbackTracking" in song:
                ytmusic.add_history_item(song)
                return True
        except Exception as e:
            pass
        return False

    asyncio.create_task(asyncio.to_thread(do_report))
    return {"status": "reported"}

@app.get("/api/library/yt_playlists")
async def get_yt_playlists():
    if not ytmusic or not os.path.exists(AUTH_FILE):
        return {"status": "error", "message": "Not authenticated", "playlists": []}
    
    def fetch():
        try:
            raw = ytmusic.get_library_playlists(limit=50)
            playlists = []
            for p in raw:
                p_id = p.get("playlistId")
                if not p_id:
                    continue
                title = p.get("title", "Untitled Playlist")
                cover = p["thumbnails"][-1]["url"] if p.get("thumbnails") else ""
                count = p.get("count", 0)
                playlists.append({
                    "id": p_id,
                    "title": title,
                    "cover": cover,
                    "trackCount": count
                })
            return playlists
        except Exception as e:
            print(f"Error fetching user playlists: {e}")
            return []

    playlists = await asyncio.to_thread(fetch)
    return {"status": "success", "playlists": playlists}

@app.get("/api/library/yt_playlist/{playlist_id}")
async def get_yt_playlist_tracks(playlist_id: str):
    if not ytmusic:
        return {"status": "error", "message": "Not authenticated", "tracks": []}
    
    def fetch():
        try:
            pl_data = ytmusic.get_playlist(playlist_id, limit=300)
            tracks = []
            for t in pl_data.get("tracks", []):
                vid = t.get("videoId")
                if not vid:
                    continue
                title = t.get("title", "Unknown")
                artist = ", ".join([a.get("name", "") for a in t.get("artists", [])]) if t.get("artists") else "Unknown"
                cover = t["thumbnails"][-1]["url"] if t.get("thumbnails") else ""
                duration = t.get("duration", "")
                tracks.append({
                    "id": vid,
                    "title": title,
                    "artist": artist,
                    "cover": cover,
                    "duration": duration,
                    "album": t.get("album", {}).get("name", "") if isinstance(t.get("album"), dict) else ""
                })
            return {
                "title": pl_data.get("title", "Playlist"),
                "description": pl_data.get("description", ""),
                "cover": pl_data.get("thumbnails", [{}])[-1].get("url", ""),
                "trackCount": pl_data.get("trackCount", len(tracks)),
                "tracks": tracks
            }
        except Exception as e:
            print(f"Error fetching playlist {playlist_id}: {e}")
            return None

    result = await asyncio.to_thread(fetch)
    if result:
        return {"status": "success", **result}
    return {"status": "error", "message": "Could not load playlist."}

@app.get("/api/download")
async def download_song(id: str, title: str):
    now = time.time()
    stream_url = None
    if id in STREAM_CACHE and now - STREAM_CACHE[id]["cached_at"] < STREAM_CACHE_TTL:
        stream_url = STREAM_CACHE[id]["url"]
    else:
        ydl_opts = {
            'format': 'bestaudio',
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 8,
        }
        def get_url():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://music.youtube.com/watch?v={id}", download=False)
                return info['url']
        try:
            stream_url = await asyncio.to_thread(get_url)
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to extract stream")
            
    if not stream_url:
        raise HTTPException(status_code=404, detail="URL not found")

    safe_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c==' ']).rstrip()
    if not safe_title: safe_title = "AxioTune_Download"
    filename = f"{safe_title}.m4a"

    async def fetch_and_stream():
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(follow_redirects=True, headers=headers) as client:
            async with client.stream("GET", stream_url) as response:
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    yield chunk

    encoded_filename = urllib.parse.quote(filename)
    headers = {
        "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}",
        "Content-Type": "audio/mp4"
    }
    return StreamingResponse(fetch_and_stream(), headers=headers)

class DBSong(BaseModel):
    video_id: str
    title: str
    artist: str
    cover: str

class DBPlaylist(BaseModel):
    name: str

@app.get("/api/library/likes")
def get_likes():
    conn = get_db()
    likes = conn.execute("SELECT * FROM liked_songs ORDER BY timestamp DESC").fetchall()
    conn.close()
    return {"status": "success", "results": [dict(l) for l in likes]}

@app.post("/api/library/likes/toggle")
def toggle_like(song: DBSong):
    conn = get_db()
    exists = conn.execute("SELECT video_id FROM liked_songs WHERE video_id = ?", (song.video_id,)).fetchone()
    if exists:
        conn.execute("DELETE FROM liked_songs WHERE video_id = ?", (song.video_id,))
        action = "removed"
    else:
        conn.execute("INSERT INTO liked_songs (video_id, title, artist, cover) VALUES (?, ?, ?, ?)", 
                     (song.video_id, song.title, song.artist, song.cover))
        action = "added"
    conn.commit()
    conn.close()
    return {"status": "success", "action": action}

@app.get("/api/library/playlists")
def get_playlists():
    conn = get_db()
    pl_rows = conn.execute("SELECT * FROM playlists ORDER BY timestamp DESC").fetchall()
    playlists = []
    for row in pl_rows:
        pl = dict(row)
        tracks = conn.execute("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC", (pl['id'],)).fetchall()
        pl['songs'] = [{"id": t['video_id'], "title": t['title'], "artist": t['artist'], "cover": t['cover'], "query": f"{t['title']} {t['artist']}"} for t in tracks]
        playlists.append(pl)
    conn.close()
    return {"status": "success", "playlists": playlists}

@app.post("/api/library/playlists")
def create_playlist(pl: DBPlaylist):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO playlists (name) VALUES (?)", (pl.name,))
    conn.commit()
    pl_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "id": pl_id, "name": pl.name}

@app.delete("/api/library/playlists/{pl_id}")
def delete_playlist(pl_id: int):
    conn = get_db()
    conn.execute("DELETE FROM playlists WHERE id = ?", (pl_id,))
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (pl_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/library/playlists/{pl_id}/tracks")
def add_playlist_track(pl_id: int, song: DBSong):
    conn = get_db()
    exists = conn.execute("SELECT video_id FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?", (pl_id, song.video_id)).fetchone()
    if exists:
        conn.close()
        return {"status": "exists"}
        
    pos = conn.execute("SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?", (pl_id,)).fetchone()['m']
    pos = 0 if pos is None else pos + 1
    conn.execute("INSERT INTO playlist_tracks (playlist_id, video_id, title, artist, cover, position) VALUES (?, ?, ?, ?, ?, ?)",
                 (pl_id, song.video_id, song.title, song.artist, song.cover, pos))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.delete("/api/library/playlists/{pl_id}/tracks/{video_id}")
def remove_playlist_track(pl_id: int, video_id: str):
    conn = get_db()
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?", (pl_id, video_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.post("/api/sync_library")
async def sync_library():
    if not ytmusic:
        return {"status": "error", "message": "Not authenticated. Sync YouTube Music first."}
    
    def do_sync():
        conn = get_db()
        cursor = conn.cursor()
        try:
            liked = ytmusic.get_liked_songs(limit=500)
            if 'tracks' in liked:
                for song in liked['tracks']:
                    vid = song.get('videoId')
                    if not vid: continue
                    title = song.get('title', 'Unknown')
                    artist = ", ".join([a['name'] for a in song.get('artists', [])]) if song.get('artists') else 'Unknown'
                    cover = song['thumbnails'][-1]['url'] if song.get('thumbnails') else ''
                    cursor.execute("INSERT OR IGNORE INTO liked_songs (video_id, title, artist, cover) VALUES (?, ?, ?, ?)", (vid, title, artist, cover))
        except Exception as e:
            print("Error syncing likes", e)
            
        try:
            library_playlists = ytmusic.get_library_playlists(limit=50)
            for pl in library_playlists:
                pl_id = pl.get('playlistId')
                title = pl.get('title', 'Unknown')
                if not pl_id: continue
                
                cursor.execute("SELECT id FROM playlists WHERE name = ?", (title,))
                existing_pl = cursor.fetchone()
                if not existing_pl:
                    cursor.execute("INSERT INTO playlists (name) VALUES (?)", (title,))
                    local_pl_id = cursor.lastrowid
                else:
                    local_pl_id = existing_pl['id']
                    
                pl_tracks = ytmusic.get_playlist(pl_id, limit=200).get('tracks', [])
                for i, track in enumerate(pl_tracks):
                    vid = track.get('videoId')
                    if not vid: continue
                    ttitle = track.get('title', 'Unknown')
                    tartist = ", ".join([a['name'] for a in track.get('artists', [])])
                    tcover = track['thumbnails'][-1]['url'] if track.get('thumbnails') else ''
                    cursor.execute("INSERT OR IGNORE INTO playlist_tracks (playlist_id, video_id, title, artist, cover, position) VALUES (?, ?, ?, ?, ?, ?)",
                                   (local_pl_id, vid, ttitle, tartist, tcover, i))
        except Exception as e:
            print("Error syncing playlists", e)
            
        conn.commit()
        conn.close()
        
    await asyncio.to_thread(do_sync)
    return {"status": "success"}

@app.get("/api/artist_from_song")
async def get_artist_from_song(id: str):
    if not ytmusic:
        return {"status": "error"}
    try:
        def fetch():
            wp = ytmusic.get_watch_playlist(videoId=id, limit=1)
            if 'tracks' in wp and len(wp['tracks']) > 0:
                for a in wp['tracks'][0].get('artists', []):
                    if 'id' in a and a['id']:
                        return a['id']
            return None
        browse_id = await asyncio.to_thread(fetch)
        if browse_id:
            return {"status": "success", "browseId": browse_id}
        return {"status": "error", "message": "Artist not found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/radio")
async def get_radio(mood: str):
    try:
        search_res = await asyncio.to_thread(lambda: ytmusic.search(f"{mood} hits songs", filter="playlists", limit=1))
        if not search_res:
            return {"status": "error", "message": "Radio not found"}
        
        pl_id = search_res[0]['browseId']
        pl = await asyncio.to_thread(lambda: ytmusic.get_playlist(pl_id, limit=50))
        
        results = []
        for t in pl.get('tracks', []):
            if not t.get('videoId'): continue
            results.append({
                "id": t['videoId'],
                "title": t['title'],
                "artist": ", ".join([a['name'] for a in t.get('artists', [])]) if t.get('artists') else 'Unknown',
                "cover": t['thumbnails'][-1]['url'] if t.get('thumbnails') else '',
                "query": f"{t['title']} {', '.join([a['name'] for a in t.get('artists', [])]) if t.get('artists') else ''}"
            })
            
        random.shuffle(results)
        return {"status": "success", "tracks": results}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/download_mp3")
async def download_mp3(id: str, title: str = "Song"):
    ydl_opts = {
        'format': 'bestaudio[ext=webm][abr>=128]/bestaudio[ext=m4a][abr>=128]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 8,
    }
    
    try:
        if os.path.exists(AUTH_FILE):
            with open(AUTH_FILE, "r", encoding="utf-8") as f:
                auth_data = json.load(f)
                cookie_str = auth_data.get("Cookie", "")
                if cookie_str:
                    ydl_opts['http_headers'] = {'Cookie': cookie_str}
    except Exception:
        pass
        
    loop = asyncio.get_running_loop()
    try:
        def fetch():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(f"https://www.youtube.com/watch?v={id}", download=False)
        info = await loop.run_in_executor(executor, fetch)
        url = info['url']
        ext = info.get('ext', 'webm')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))
    req = client.build_request("GET", url)
    r = await client.send(req, stream=True)
    
    async def stream_generator():
        try:
            async for chunk in r.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()
            
    safe_title = "".join(c for c in title if c.isalnum() or c in " _-").strip()
    return StreamingResponse(
        stream_generator(), 
        media_type=f"audio/{ext}",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.{ext}"'}
    )



# =========================================================================
# LISTEN TOGETHER / PARTY MODE (WebSockets)
# =========================================================================

class PartyManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, Any]] = {}

    async def connect(self, room_id: str, client_id: str, websocket: WebSocket, is_host: bool, username: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {"host": None, "connections": {}, "state": {}, "usernames": {}}
        self.rooms[room_id]["connections"][client_id] = websocket
        self.rooms[room_id]["usernames"][client_id] = username
        if is_host:
            self.rooms[room_id]["host"] = client_id
        if not is_host and self.rooms[room_id]["state"]:
            try:
                await websocket.send_text(json.dumps(self.rooms[room_id]["state"]))
            except Exception:
                pass
        
        # Broadcast join notification
        user_count = len(self.rooms[room_id]["connections"])
        join_msg = {
            "action": "system",
            "type": "join",
            "username": username,
            "clientId": client_id,
            "userCount": user_count,
            "message": f"{username} joined the party"
        }
        await self.broadcast(room_id, join_msg, client_id)

    async def disconnect(self, room_id: str, client_id: str):
        if room_id in self.rooms:
            username = self.rooms[room_id]["usernames"].get(client_id, "Someone")
            if client_id in self.rooms[room_id]["connections"]:
                del self.rooms[room_id]["connections"][client_id]
            if client_id in self.rooms[room_id]["usernames"]:
                del self.rooms[room_id]["usernames"][client_id]
            if self.rooms[room_id]["host"] == client_id:
                self.rooms[room_id]["host"] = None
            
            user_count = len(self.rooms[room_id]["connections"])
            if not self.rooms[room_id]["connections"]:
                del self.rooms[room_id]
            else:
                # Broadcast leave notification
                leave_msg = {
                    "action": "system",
                    "type": "leave",
                    "username": username,
                    "clientId": client_id,
                    "userCount": user_count,
                    "message": f"{username} left the party"
                }
                dead_connections = []
                for cid, connection in self.rooms[room_id]["connections"].items():
                    try:
                        await connection.send_text(json.dumps(leave_msg))
                    except Exception:
                        dead_connections.append(cid)
                for dead in dead_connections:
                    await self.disconnect(room_id, dead)

    async def broadcast(self, room_id: str, message: dict, sender_id: str):
        if room_id in self.rooms:
            # Only host can save the playback state
            if self.rooms[room_id]["host"] == sender_id and message.get("action") in ["play", "pause", "seek", "sync"]:
                self.rooms[room_id]["state"] = message
            dead_connections = []
            for client_id, connection in self.rooms[room_id]["connections"].items():
                if client_id != sender_id:
                    try:
                        await connection.send_text(json.dumps(message))
                    except Exception:
                        dead_connections.append(client_id)
            for dead in dead_connections:
                await self.disconnect(room_id, dead)

party_manager = PartyManager()

@app.websocket("/ws/party/{room_id}/{client_id}")
async def party_endpoint(websocket: WebSocket, room_id: str, client_id: str, role: str = "listener", username: str = "Anonymous"):
    is_host = (role == "host")
    await party_manager.connect(room_id, client_id, websocket, is_host, username)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                action = message.get("action")
                # Chat message - broadcast to all
                if action == "chat":
                    await party_manager.broadcast(room_id, message, client_id)
                # Playback sync events - only host can broadcast
                elif party_manager.rooms[room_id]["host"] == client_id:
                    await party_manager.broadcast(room_id, message, client_id)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        await party_manager.disconnect(room_id, client_id)

@app.get("/api/ip")
def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return {"ip": IP}

@app.on_event("startup")
async def start_memory_manager():
    async def periodic_cleanup():
        while True:
            await asyncio.sleep(180)  # Every 3 minutes
            try:
                now = time.time()
                # Prune expired API cache entries
                for k in list(API_CACHE.keys()):
                    if now - API_CACHE[k].get('time', 0) > API_CACHE_TTL:
                        API_CACHE.pop(k, None)
                # Prune expired Stream cache entries
                for k in list(STREAM_CACHE.keys()):
                    if now - STREAM_CACHE[k].get('cached_at', 0) > STREAM_CACHE_TTL:
                        STREAM_CACHE.pop(k, None)
                # Prune expired Lyrics cache entries
                for k in list(LYRICS_CACHE.keys()):
                    if now - LYRICS_CACHE[k].get('time', 0) > LYRICS_CACHE_TTL:
                        LYRICS_CACHE.pop(k, None)
                # Cleanup disk cover cache if exceeding 600 files
                if os.path.exists(COVER_CACHE_DIR):
                    files = [os.path.join(COVER_CACHE_DIR, f) for f in os.listdir(COVER_CACHE_DIR) if f.endswith('.jpg')]
                    if len(files) > 600:
                        files.sort(key=lambda p: os.path.getmtime(p))
                        for old_file in files[:100]:
                            try:
                                os.remove(old_file)
                            except Exception:
                                pass
                # Trigger explicit Python Garbage Collection
                gc.collect()
            except Exception:
                pass
    asyncio.create_task(periodic_cleanup())

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"Starting Streamify Backend Server at http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)