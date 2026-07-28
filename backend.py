from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
import yt_dlp
import uvicorn
import asyncio
import httpx
import os
import time
import hashlib
import re
from ytmusicapi import YTMusic
from pydantic import BaseModel
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

# --- Caching & Concurrency ---
API_CACHE = {}
API_CACHE_TTL = 600  # 10 minutes cache for API responses

executor = ThreadPoolExecutor(max_workers=20)
async def run_sync(func, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, lambda: func(*args, **kwargs))

app = FastAPI()
AUTH_FILE = "headers_auth.json"
ytmusic = None

import sqlite3
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
STREAM_CACHE = {}
STREAM_CACHE_TTL = 600  # 10 minutes — YouTube stream URLs expire; frontend retries on error
COVER_CACHE_DIR = ".cover_cache"

if not os.path.exists(COVER_CACHE_DIR):
    os.makedirs(COVER_CACHE_DIR)

def init_ytmusic():
    global ytmusic
    if os.path.exists(AUTH_FILE):
        try:
            ytmusic = YTMusic(AUTH_FILE)
            print("=== Success: Authenticated YTMusic session loaded ===")
            return True
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"=== Error loading authenticated session: {e}. Falling back to guest. ===")
            ytmusic = YTMusic()
            return False
    else:
        print("=== No authenticated session found. Running as Guest. ===")
        ytmusic = YTMusic()
        return False

# Initialize
init_ytmusic()


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
    import os
    if os.path.exists(f"{filename}.jpg"):
        return FileResponse(f"{filename}.jpg")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.svg")
def get_svg(filename: str):
    import os
    if os.path.exists(f"{filename}.svg"):
        return FileResponse(f"{filename}.svg", media_type="image/svg+xml")
    return {"error": "Not found"}

@app.get("/{filename}.png")
def get_png(filename: str):
    import os
    if os.path.exists(f"{filename}.png"):
        return FileResponse(f"{filename}.png")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.gif")
def get_gif(filename: str):
    import os
    if os.path.exists(f"{filename}.gif"):
        return FileResponse(f"{filename}.gif")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.mp4")
def get_mp4(filename: str):
    import os
    if os.path.exists(f"{filename}.mp4"):
        return FileResponse(f"{filename}.mp4", media_type="video/mp4")
    return {"error": "Not found"}

@app.get("/{filename}.css")
def get_css(filename: str):
    import os
    if os.path.exists(f"{filename}.css"):
        return FileResponse(f"{filename}.css")
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/{filename}.js")
def get_js(filename: str):
    import os
    if os.path.exists(f"{filename}.js"):
        return FileResponse(f"{filename}.js")
    raise HTTPException(status_code=404, detail="File not found")

def clean_cover_search_term(q: str) -> str:
    if not q:
        return ""
    q = re.sub(r'\[.*?\]|\(.*?\)|\{.*?\}', ' ', q)
    q = re.sub(r'(?i)\b(official|video|lyrical|full\s+song|audio|hd|4k|mv)\b', ' ', q)
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


@app.get("/api/cover")
async def get_cover(q: str = "", yt_thumb: str = "", vid: str = ""):
    """
    Fetches album artwork proxied through our server with disk caching.
    1. Checks disk cache first.
    2. Tries iTunes API (best quality, never expires, no CORS) and caches result.
    3. Falls back to proxying YouTube thumbnail (highest quality available) and caches result.
    4. Falls back to default_cover.jpg
    """
    cache_key = ""
    if q:
        cache_key = hashlib.md5(f"q_{q}".encode('utf-8')).hexdigest()
    elif vid:
        cache_key = hashlib.md5(f"vid_{vid}".encode('utf-8')).hexdigest()
    elif yt_thumb:
        cache_key = hashlib.md5(f"thumb_{yt_thumb}".encode('utf-8')).hexdigest()

    if cache_key:
        cache_path = os.path.join(COVER_CACHE_DIR, f"{cache_key}.jpg")
        if os.path.exists(cache_path):
            return FileResponse(cache_path, media_type="image/jpeg",
                                headers={"Cache-Control": "public, max-age=31536000"})

    if yt_thumb and not is_valid_yt_thumb(yt_thumb):
        yt_thumb = ""

    # Add User-Agent to prevent 403 Forbidden from iTunes and Google APIs
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    
    async with httpx.AsyncClient(timeout=3.0, headers=headers) as client:
        # First try to use the iTunes API if q is provided (best quality square artwork)
        if q:
            term = clean_cover_search_term(q)
            if term:
                try:
                    r = await client.get(
                        "https://itunes.apple.com/search",
                        params={"term": term, "entity": "song", "limit": 1}
                    )
                    if r.status_code == 200:
                        data = r.json()
                        if data.get("results"):
                            art_url = data["results"][0]["artworkUrl100"].replace("100x100bb", "1400x1400bb")
                            img_r = await client.get(art_url)
                            if img_r.status_code == 200:
                                if cache_key:
                                    with open(cache_path, "wb") as f:
                                        f.write(img_r.content)
                                return Response(content=img_r.content, media_type="image/jpeg",
                                                headers={"Cache-Control": "public, max-age=31536000"})
                except Exception:
                    pass

        # If iTunes API lookup failed or q was empty, fallback to downloading YouTube thumbnail
        yt_urls = []
        target_vid = extract_yt_video_id(yt_thumb) if yt_thumb and is_valid_yt_thumb(yt_thumb) else vid

        if target_vid:
            # Try higher resolution options first, fallback to hqdefault which is always present
            yt_urls.extend([
                f"https://img.youtube.com/vi/{target_vid}/maxresdefault.jpg",
                f"https://img.youtube.com/vi/{target_vid}/sddefault.jpg",
                f"https://img.youtube.com/vi/{target_vid}/hqdefault.jpg",
                f"https://img.youtube.com/vi/{target_vid}/mqdefault.jpg",
                f"https://img.youtube.com/vi/{target_vid}/default.jpg"
            ])
            
        if yt_thumb and is_valid_yt_thumb(yt_thumb):
            yt_urls.append(yt_thumb)

        for url in yt_urls:
            try:
                img_r = await client.get(url)
                if img_r.status_code == 200:
                    # YouTube returns a 120x90 grey placeholder (~1KB) if maxres/sd are missing
                    if len(img_r.content) < 2000 and ("maxresdefault" in url or "sddefault" in url):
                        continue
                        
                    if cache_key:
                        with open(cache_path, "wb") as f:
                            f.write(img_r.content)
                    return Response(content=img_r.content, media_type="image/jpeg",
                                    headers={"Cache-Control": "public, max-age=31536000" if q else "public, max-age=86400"})
            except Exception:
                continue

    # Absolute ultimate fallback to prevent broken images and CORS errors
    if os.path.exists("default_cover.jpg"):
        return FileResponse("default_cover.jpg", media_type="image/jpeg")
        
    return Response(status_code=404)
        
    return FileResponse("default_cover.jpg")

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
                return f"https://img.youtube.com/vi/{vid}/sddefault.jpg"
            return ""
        url = item["thumbnails"][-1]["url"]
        if "lh3.googleusercontent.com" in url and "=" in url:
            base = url.split("=")[0]
            return f"{base}=w500-h500-l90-rj"
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

@app.get("/api/stream")
async def stream(id: str, refresh: bool = False):
    # Check cache first (skip when client requests a fresh URL)
    now = time.time()
    if not refresh and id in STREAM_CACHE:
        cached = STREAM_CACHE[id]
        if now - cached["cached_at"] < STREAM_CACHE_TTL:
            return {
                "url": cached["url"],
                "quality": cached["quality"],
                "format_note": cached["format_note"],
                "duration": cached.get("duration", 0),
                "cached": True
            }

    ydl_opts = {
        # Prefer high quality: Opus/WebM first (best for web), then m4a, then anything
        'format': 'bestaudio[ext=webm][abr>=128]/bestaudio[ext=m4a][abr>=128]/bestaudio[abr>=128]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 8,
        'extractor_retries': 1,
    }
    
    # Inject cookies to bypass aggressive datacenter IP blocks on Render
    try:
        if os.path.exists(AUTH_FILE):
            with open(AUTH_FILE, "r", encoding="utf-8") as f:
                auth_data = json.load(f)
                cookie_str = auth_data.get("Cookie", "")
                if cookie_str:
                    ydl_opts['http_headers'] = {'Cookie': cookie_str}
                    ydl_opts['extractor_args'] = {'youtube': {'player_client': ['web', 'tv']}}
    except Exception:
        pass

    
    # List of public Piped API instances for fallback
    INVIDIOUS_INSTANCES = [
        "https://inv.thepixora.com",
        "https://inv.tux.pizza",
        "https://invidious.nerdvpn.de",
        "https://invidious.protokolla.fi",
        "https://inv.bp.projectsegfau.lt",
        "https://iv.melmac.space"
    ]

    async def fetch_stream():
        def run_ytdlp():
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(f"https://music.youtube.com/watch?v={id}", download=False)
                    abr = info.get('abr') or info.get('tbr') or 128
                    return {
                        "url": info['url'],
                        "quality": f"{int(abr)}kbps",
                        "format_note": info.get('ext', 'unknown'),
                        "duration": info.get('duration', 0),
                        "cached": False,
                        "source": "yt-dlp"
                    }
            except Exception as e:
                print(f"[yt-dlp DEBUG] Exception: {type(e).__name__}: {str(e)[:200]}")
                return None

        result = await asyncio.to_thread(run_ytdlp)
        if result: return result
        
        # --- FALLBACK: JIOSAAVN API ---
        print(f"[Fallback] yt-dlp failed for {id}, trying JioSaavn API...")
        try:
            def fetch_meta():
                return ytmusic.get_song(id)
            meta = await asyncio.to_thread(fetch_meta)
            
            if meta and meta.get('videoDetails'):
                title = meta['videoDetails'].get('title', '')
                author = meta['videoDetails'].get('author', '')
                query = f"{title} {author}".strip().replace(' ', '+')
                
                async with httpx.AsyncClient(timeout=8.0) as client:
                    r = await client.get(f"https://www.jiosaavn.com/api.php?__call=autocomplete.get&query={query}&_format=json&_marker=0&ctx=android")
                    if r.status_code == 200:
                        data = r.json()
                        songs = data.get('songs', {}).get('data', [])
                        if songs:
                            song_id = songs[0]['id']
                            r2 = await client.get(f"https://www.jiosaavn.com/api.php?__call=song.getDetails&pids={song_id}&_format=json&_marker=0&ctx=android")
                            if r2.status_code == 200:
                                details = r2.json()
                                song_info = details.get(song_id, {})
                                media_url = song_info.get('media_preview_url', '')
                                if media_url:
                                    full_url = media_url.replace("preview.saavncdn.com", "aac.saavncdn.com").replace("_96_p", "_320")
                                    return {
                                        "url": full_url,
                                        "quality": "320kbps",
                                        "format_note": "m4a",
                                        "duration": int(meta['videoDetails'].get('lengthSeconds', 0)),
                                        "cached": False,
                                        "source": "jiosaavn"
                                    }
        except Exception as e:
            print(f"[JioSaavn Fallback Error]: {str(e)}")
                    
        raise HTTPException(status_code=404, detail="Stream failed on all sources.")

    try:
        res = await fetch_stream()
        
        # Store in cache
        STREAM_CACHE[id] = {
            "url": res["url"],
            "quality": res["quality"],
            "format_note": res["format_note"],
            "duration": res.get("duration", 0),
            "cached_at": time.time()
        }
        return res
    except Exception as e:
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)

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
            top = ytmusic.search("Top Songs Hits", filter="songs", limit=10)
            trend = ytmusic.search("Viral Trending Songs", filter="songs", limit=10)
            return top, trend
            
        top_res, trend_res = await asyncio.to_thread(fetch_trending)
        
        top_songs = []
        for item in top_res:
            artist_name = item['artists'][0]['name'] if item.get('artists') else "Unknown"
            thumbnail = item['thumbnails'][-1]['url'] if item.get('thumbnails') else ""
            top_songs.append({"title": item['title'], "artist": artist_name, "cover": thumbnail})
                
        trending = []
        for item in trend_res:
            artist_name = item['artists'][0]['name'] if item.get('artists') else "Unknown"
            thumbnail = item['thumbnails'][-1]['url'] if item.get('thumbnails') else ""
            trending.append({"title": item['title'], "artist": artist_name, "cover": thumbnail})

        return {"status": "success", "top_songs": top_songs, "trending": trending}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/recommendations")
async def get_recommendations(videoId: str = ""):
    try:
        if not videoId:
            return {"status": "success", "recommendations": []}
            
        cache_key = f"recs_{videoId}"
        now = time.time()
        if cache_key in API_CACHE and (now - API_CACHE[cache_key]['time']) < API_CACHE_TTL:
            return API_CACHE[cache_key]['data']
            
        def fetch_watch_playlist():
            return ytmusic.get_watch_playlist(videoId=videoId, limit=20)
            
        try:
            playlist = await run_sync(fetch_watch_playlist)
            tracks = playlist.get('tracks', [])
        except Exception:
            # FALLBACK for ytmusicapi upstream 'endpoint' bug in watch_playlist
            def fallback_fetch():
                song = ytmusic.get_song(videoId)
                artist = song.get('videoDetails', {}).get('author', '')
                title = song.get('videoDetails', {}).get('title', '')
                # Search for similar artist songs to build a radio queue
                search_query = f"{artist} songs" if artist else title
                return ytmusic.search(query=search_query, filter="songs", limit=20)
            tracks = await run_sync(fallback_fetch)
        
        recs = []
        for item in tracks:
            vid = item.get('videoId')
            # Skip the current song itself from recommendations
            if vid == videoId or not vid:
                continue
                
            artist_name = item['artists'][0]['name'] if item.get('artists') else "Unknown"
            
            # Handle differences between watch_playlist ('thumbnail') and search ('thumbnails')
            thumb_list = item.get('thumbnails') or item.get('thumbnail') or []
            thumbnail = thumb_list[-1]['url'] if thumb_list else ""
            
            recs.append({
                "title": item.get('title', 'Unknown'), 
                "artist": artist_name, 
                "cover": thumbnail,
                "videoId": vid
            })
            
        res_data = {"status": "success", "recommendations": recs}
        API_CACHE[cache_key] = {'time': time.time(), 'data': res_data}
        return res_data
    except Exception as e:
        return {"status": "error", "message": str(e)}

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

LYRICS_CACHE = {}
LYRICS_CACHE_TTL = 86400  # 24 hours

def parse_synced_lrc(lrc_text: str):
    """Parses LRC timestamped lyrics string into line and word objects with smart vocal timing & 3-dot instrumental indicators."""
    import re
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
            text = match.group(3).strip()
            if text:
                parsed_raw.append({"time": timestamp, "text": text})

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
        words_list = text.split()
        num_words = len(words_list)

        # Next line timestamp
        next_time = timestamp + 3.5
        if idx + 1 < len(parsed_raw):
            next_time = parsed_raw[idx + 1]["time"]

        raw_gap = max(next_time - timestamp, 0.5)
        # Vocal singing duration: clamp to natural singing speed (0.48s/word)
        vocal_dur = min(num_words * 0.48, raw_gap * 0.70)
        if vocal_dur < 0.8:
            vocal_dur = min(raw_gap, 1.2)

        step = vocal_dur / max(num_words, 1)
        words = []
        for w_idx, w in enumerate(words_list):
            w_time = round(timestamp + (w_idx * step), 2)
            words.append({"word": w, "time": w_time})

        lines.append({
            "time": timestamp,
            "text": text,
            "isInstrumental": False,
            "words": words
        })

        # 2. Mid-song Instrumental break check (if gap before next line is >= 3.5s)
        vocal_end = round(timestamp + vocal_dur + 0.2, 2)
        if (next_time - vocal_end) >= 2.5 and idx + 1 < len(parsed_raw):
            lines.append({
                "time": vocal_end,
                "text": "• • •",
                "isInstrumental": True,
                "words": []
            })

    return lines

@app.get("/api/lyrics")
async def get_lyrics(videoId: str = "", title: str = "", artist: str = ""):
    cache_key = f"lyrics_{videoId}_{title}_{artist}"
    now = time.time()
    if cache_key in LYRICS_CACHE and (now - LYRICS_CACHE[cache_key]['time']) < LYRICS_CACHE_TTL:
        return LYRICS_CACHE[cache_key]['data']

    # Priority 1: Fast Word-by-Word Synced Lyrics check (2.0s timeout)
    word_synced_data = None
    if title or artist:
        c_title = clean_cover_search_term(title or "")
        c_artist = clean_cover_search_term((artist or "").split(',')[0].split('&')[0])
        queries = [
            f"{c_title} {c_artist}".strip(),
            c_title
        ]
        try:
            async with httpx.AsyncClient(timeout=2.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
                for q in queries:
                    if not q:
                        continue
                    r = await client.get("https://lrclib.net/api/search", params={"q": q})
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, list):
                            best = next((item for item in data if item.get("syncedLyrics")), None)
                            if best and best.get("syncedLyrics"):
                                parsed_lines = parse_synced_lrc(best["syncedLyrics"])
                                if parsed_lines:
                                    word_synced_data = {
                                        "status": "success",
                                        "type": "word_synced",
                                        "lines": parsed_lines,
                                        "raw_lrc": best["syncedLyrics"],
                                        "source": "synced"
                                    }
                                    break
        except Exception:
            pass

    if word_synced_data:
        LYRICS_CACHE[cache_key] = {'time': time.time(), 'data': word_synced_data}
        return word_synced_data

    # Priority 2 (Main Official): Instant YouTube Official Plain Text Lyrics Fallback
    try:
        def fetch_yt_lyrics():
            if not videoId:
                return None
            watch = ytmusic.get_watch_playlist(videoId=videoId)
            lyrics_id = watch.get("lyrics")
            if lyrics_id:
                return ytmusic.get_lyrics(lyrics_id)
            return None
            
        lyrics_data = await asyncio.to_thread(fetch_yt_lyrics)
        if lyrics_data and lyrics_data.get("lyrics"):
            res = {
                "status": "success",
                "type": "plain_text",
                "lyrics": lyrics_data.get("lyrics", ""),
                "source": "ytmusic"
            }
            LYRICS_CACHE[cache_key] = {'time': time.time(), 'data': res}
            return res
            
        return {"status": "error", "message": "No lyrics found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def format_headers(raw_input: str) -> str:
    raw_input = raw_input.strip()
    if not raw_input:
        return ""
    
    # Parse cURL command if pasted
    if "curl " in raw_input.lower():
        import re
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

@app.get("/api/sync_status")
def sync_status():
    is_synced = os.path.exists(AUTH_FILE)
    return {"synced": is_synced}

import json

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
            # Normalize key casing to match standard headers
            normalized_key = "-".join([w.capitalize() for w in key.split("-")])
            headers_dict[normalized_key] = value
            
    # Validate that Cookie contains __Secure-3PAPISID
    cookie_key = next((k for k in headers_dict if k.lower() == 'cookie'), None)
    if not cookie_key or "__Secure-3PAPISID" not in headers_dict[cookie_key]:
        raise ValueError("Your cookie is missing the required secure credential (__Secure-3PAPISID). Please ensure you are logged in to YouTube Music on music.youtube.com.")
        
    # Inject/force Authorization and Origin to trick ytmusicapi parser into BROWSER auth mode
    headers_dict["Authorization"] = "SAPISIDHASH dummy_value"
    headers_dict["Origin"] = "https://music.youtube.com"
    headers_dict["x-goog-authuser"] = "0"
    
    # Add a fallback standard User-Agent if missing
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
            return {"status": "success", "message": "Successfully synced with YouTube Music!"}
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
            
        # Construct standard headers around this cookie
        headers_str = f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\nCookie: {cookie_val}"
        
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
            
        def run_setup():
            save_headers_to_json(headers_str, AUTH_FILE)
            
        await asyncio.to_thread(run_setup)
        
        success = await asyncio.to_thread(init_ytmusic)
        if success:
            return {"status": "success", "message": "Successfully synced with YouTube Music!"}
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
        # action can be 'LIKE', 'DISLIKE', 'INDIFFERENT'
        status = ytmusic.rate_song(req.id, req.action)
        return {"status": "success", "result": status}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/unsync")
def unsync_account():
    if os.path.exists(AUTH_FILE):
        os.remove(AUTH_FILE)
    global ytmusic
    ytmusic = YTMusic()
    return {"status": "success", "message": "Disconnected successfully."}

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
            liked = ytmusic.get_liked_songs(limit=200)
            if 'tracks' in liked:
                for song in liked['tracks']:
                    vid = song.get('videoId')
                    if not vid: continue
                    title = song.get('title', 'Unknown')
                    artist = ", ".join([a['name'] for a in song.get('artists', [])])
                    cover = song['thumbnails'][-1]['url'] if song.get('thumbnails') else ''
                    cursor.execute("INSERT OR IGNORE INTO liked_songs (video_id, title, artist, cover) VALUES (?, ?, ?, ?)", (vid, title, artist, cover))
        except Exception as e:
            print("Error syncing likes", e)
            
        try:
            library_playlists = ytmusic.get_library_playlists(limit=20)
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
                    
                pl_tracks = ytmusic.get_playlist(pl_id, limit=100).get('tracks', [])
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
            
        import random
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
from typing import Dict, List, Any
import json

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

import socket

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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"Starting Streamify Backend Server at http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)