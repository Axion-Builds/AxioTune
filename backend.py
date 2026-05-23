from fastapi import FastAPI, Request, HTTPException
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

app = FastAPI()
AUTH_FILE = "headers_auth.json"
ytmusic = None

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

@app.get("/{filename}.png")
def get_png(filename: str):
    import os
    if os.path.exists(f"{filename}.png"):
        return FileResponse(f"{filename}.png")
    raise HTTPException(status_code=404, detail="File not found")

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


@app.get("/api/cover")
async def get_cover(q: str = "", yt_thumb: str = ""):
    """
    Fetches album artwork proxied through our server with disk caching.
    1. Checks disk cache first.
    2. Tries iTunes API (best quality, never expires, no CORS) and caches result.
    3. Falls back to proxying YouTube thumbnail and caches result.
    4. Falls back to default_cover.jpg
    """
    cache_key = ""
    if q:
        cache_key = hashlib.md5(f"q_{q}".encode('utf-8')).hexdigest()
    elif yt_thumb:
        cache_key = hashlib.md5(f"thumb_{yt_thumb}".encode('utf-8')).hexdigest()

    if cache_key:
        cache_path = os.path.join(COVER_CACHE_DIR, f"{cache_key}.jpg")
        if os.path.exists(cache_path):
            return FileResponse(cache_path, media_type="image/jpeg",
                                headers={"Cache-Control": "public, max-age=31536000"})

    if yt_thumb and not is_valid_yt_thumb(yt_thumb):
        yt_thumb = ""

    async with httpx.AsyncClient(timeout=8.0) as client:
        # Try iTunes with cleaned query (and a shorter fallback)
        search_terms = []
        if q:
            cleaned = clean_cover_search_term(q)
            search_terms.append(cleaned or q)
            if cleaned and cleaned != q:
                search_terms.append(q)
            parts = (cleaned or q).split(' - ', 1)
            if len(parts) == 2:
                search_terms.append(f"{parts[0]} {parts[1]}")
        seen_terms = set()
        for term in search_terms:
            if not term or term in seen_terms:
                continue
            seen_terms.add(term)
            try:
                r = await client.get(
                    "https://itunes.apple.com/search",
                    params={"term": term, "entity": "song", "limit": 1}
                )
                data = r.json()
                if data.get("results"):
                    art_url = data["results"][0]["artworkUrl100"].replace("100x100bb", "600x600bb")
                    img_r = await client.get(art_url)
                    if img_r.status_code == 200:
                        if cache_key:
                            with open(cache_path, "wb") as f:
                                f.write(img_r.content)
                        return Response(content=img_r.content, media_type="image/jpeg",
                                        headers={"Cache-Control": "public, max-age=31536000"})
            except Exception:
                pass

        # Fall back to proxying YouTube thumbnail
        if yt_thumb and is_valid_yt_thumb(yt_thumb):
            try:
                img_r = await client.get(yt_thumb)
                if img_r.status_code == 200:
                    if cache_key:
                        with open(cache_path, "wb") as f:
                            f.write(img_r.content)
                    return Response(content=img_r.content, media_type="image/jpeg",
                                    headers={"Cache-Control": "public, max-age=86400"})
            except Exception:
                pass

    # Last resort: serve default cover
    return FileResponse("default_cover.jpg")

# Live search suggestions — returns songs, artists, albums mixed
@app.get("/api/suggest")
async def suggest(q: str, filter: str = "all"):
    if not q or len(q.strip()) < 2:
        return {"results": []}
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

        search_res = await asyncio.to_thread(do_search)
        
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

        return {"results": results[:10]}
    except Exception as e:
        return {"results": [], "error": str(e)}

@app.get("/api/multi_search")
async def multi_search(q: str):
    """Fetch songs, videos, albums, and artists simultaneously for the search results page."""
    if not q or len(q.strip()) < 2:
        return {"songs": [], "videos": [], "albums": [], "artists": []}
    
    def _safe_thumb(item):
        return item["thumbnails"][-1]["url"] if item.get("thumbnails") else ""

    def fetch_songs():
        try:
            res = ytmusic.search(q, filter="songs", limit=6)
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
            res = ytmusic.search(q, filter="artists", limit=5)
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

    songs, videos, albums, artists = await asyncio.gather(
        asyncio.to_thread(fetch_songs),
        asyncio.to_thread(fetch_videos),
        asyncio.to_thread(fetch_albums),
        asyncio.to_thread(fetch_artists),
    )
    return {"songs": songs, "videos": videos, "albums": albums, "artists": artists}


# Endpoint to search YouTube Music and get cover art + track info
@app.get("/api/search")
async def search(q: str):
    try:
        # Use ytmusicapi to search strictly for songs. This is 10x faster and returns studio versions, fixing lyrics desync!
        def do_search():
            results = ytmusic.search(q, filter="songs", limit=1)
            # If no song found, try all filter
            if not results:
                results = ytmusic.search(q, limit=1)
            return results
            
        results = await asyncio.to_thread(do_search)
        
        if results:
            entry = results[0]
            artist = entry["artists"][0]["name"] if entry.get("artists") else "Unknown"
            thumbnail = entry["thumbnails"][-1]["url"] if entry.get("thumbnails") else ""
            
            return {
                "id": entry.get("videoId"),
                "title": entry.get("title"),
                "thumbnail": thumbnail,
                "uploader": artist
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    raise HTTPException(status_code=404, detail="No results found")

# Endpoint to extract the raw live streaming audio URL from YouTube
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
                "cached": True
            }

    ydl_opts = {
        # Prefer high quality: Opus/WebM first (best for web), then m4a, then anything
        'format': 'bestaudio[ext=webm][abr>=128]/bestaudio[ext=m4a][abr>=128]/bestaudio[abr>=128]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 8,
        'extractor_retries': 1,
        # android client bypasses YouTube bot detection WITHOUT needing cookies!
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'ios'],
            }
        },
    }
    
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
        # PLAN A: Async function to verify a single Invidious proxy stream
        async def fetch_invidious(instance, client):
            try:
                proxy_url = f"{instance}/latest_version?id={id}&itag=140&local=true"
                # Send a HEAD request to check if the instance's proxy is working
                resp = await client.head(proxy_url, timeout=1.5, follow_redirects=True)
                if resp.status_code == 200 and 'audio' in resp.headers.get('content-type', ''):
                    return {
                        "url": proxy_url,
                        "quality": "128kbps",
                        "format_note": "m4a",
                        "cached": False,
                        "source": f"invidious ({instance})"
                    }
            except Exception:
                pass
            return None

        # PLAN B: Try yt-dlp via thread
        def run_ytdlp():
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(f"https://music.youtube.com/watch?v={id}", download=False)
                    abr = info.get('abr') or info.get('tbr') or 128
                    return {
                        "url": info['url'],
                        "quality": f"{int(abr)}kbps",
                        "format_note": info.get('ext', 'unknown'),
                        "cached": False,
                        "source": "yt-dlp"
                    }
            except Exception as e:
                print(f"[yt-dlp DEBUG] Exception: {type(e).__name__}: {str(e)[:200]}")
                return None

        print(f"[Stream Engine] Racing Invidious APIs for {id}...")
        # RACE all Invidious instances concurrently for maximum speed and reliability
        async with httpx.AsyncClient(verify=False) as client:
            tasks = [asyncio.create_task(fetch_invidious(inst, client)) for inst in INVIDIOUS_INSTANCES]
            
            # As soon as ANY Invidious instance returns a valid proxy url, return it!
            for future in asyncio.as_completed(tasks):
                result = await future
                if result:
                    for t in tasks: t.cancel()
                    return result

        print("[Fallback Alert] Invidious failed. Falling back to yt-dlp...")
        
        # Execute yt-dlp as fallback
        ytdlp_result = await asyncio.to_thread(run_ytdlp)
        if ytdlp_result:
            return ytdlp_result

        raise HTTPException(status_code=404, detail="All streaming engines failed.")

    try:
        res = await fetch_stream()
        
        # Store in cache
        STREAM_CACHE[id] = {
            "url": res["url"],
            "quality": res["quality"],
            "format_note": res["format_note"],
            "cached_at": now
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
        finally:
            await r.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_generator(), 
        status_code=r.status_code, 
        headers=response_headers,
        media_type=response_headers.get("Content-Type", "audio/webm")
    )

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
            
        def fetch_watch_playlist():
            return ytmusic.get_watch_playlist(videoId=videoId, limit=20)
            
        try:
            playlist = await asyncio.to_thread(fetch_watch_playlist)
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
            tracks = await asyncio.to_thread(fallback_fetch)
        
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
            
        return {"status": "success", "recommendations": recs}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/home")
async def get_home():
    try:
        def fetch_home():
            return ytmusic.get_home(limit=6)
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
                if item.get("playlistId"):
                    c_type = "playlist"
                elif item.get("browseId"):
                    c_type = "artist" if "artist" in item.get("browseId", "").lower() else "album"
                
                clean_section["contents"].append({
                    "title": item.get("title", ""),
                    "artist": artist_name,
                    "cover": thumbnail,
                    "type": c_type,
                    "videoId": item.get("videoId", ""),
                    "playlistId": item.get("playlistId", ""),
                    "browseId": item.get("browseId", ""),
                    "query": f"{item.get('title', '')} {artist_name}"
                })
            clean_feed.append(clean_section)
            
        return {"status": "success", "feed": clean_feed}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/artist")
async def get_artist(id: str):
    try:
        artist = await asyncio.to_thread(ytmusic.get_artist, id)
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

@app.get("/api/lyrics")
async def get_lyrics(videoId: str):
    try:
        def fetch_lyrics():
            watch = ytmusic.get_watch_playlist(videoId=videoId)
            lyrics_id = watch.get("lyrics")
            if lyrics_id:
                return ytmusic.get_lyrics(lyrics_id)
            return None
            
        lyrics_data = await asyncio.to_thread(fetch_lyrics)
        if lyrics_data:
            return {"status": "success", "lyrics": lyrics_data.get("lyrics", ""), "source": "ytmusic"}
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

@app.post("/api/unsync")
def unsync_account():
    if os.path.exists(AUTH_FILE):
        os.remove(AUTH_FILE)
    global ytmusic
    ytmusic = YTMusic()
    return {"status": "success", "message": "Disconnected successfully."}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting Apple Music Streaming Server at http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
