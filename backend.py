from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
import yt_dlp
import uvicorn
import asyncio
import httpx
from ytmusicapi import YTMusic

app = FastAPI()
ytmusic = YTMusic()

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

@app.get("/api/cover")
async def get_cover(q: str = "", yt_thumb: str = ""):
    """
    Fetches album artwork proxied through our server.
    1. Tries iTunes API (best quality, never expires, no CORS)
    2. Falls back to proxying the YouTube thumbnail URL
    3. Falls back to default_cover.jpg
    """
    async with httpx.AsyncClient(timeout=8.0) as client:
        # Try iTunes first
        if q:
            try:
                r = await client.get(
                    f"https://itunes.apple.com/search",
                    params={"term": q, "entity": "song", "limit": 1}
                )
                data = r.json()
                if data.get("results"):
                    art_url = data["results"][0]["artworkUrl100"].replace("100x100bb", "600x600bb")
                    img_r = await client.get(art_url)
                    return Response(content=img_r.content, media_type="image/jpeg",
                                    headers={"Cache-Control": "public, max-age=86400"})
            except Exception:
                pass

        # Fall back to proxying YouTube thumbnail
        if yt_thumb:
            try:
                img_r = await client.get(yt_thumb)
                if img_r.status_code == 200:
                    return Response(content=img_r.content, media_type="image/jpeg",
                                    headers={"Cache-Control": "public, max-age=3600"})
            except Exception:
                pass

    # Last resort: serve default cover
    return FileResponse("default_cover.jpg")

# Endpoint to search YouTube Music and get cover art + track info
@app.get("/api/search")
def search(q: str):
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'extract_flat': True,
        'quiet': True,
        'default_search': 'ytsearch1'
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # ytsearch1 ensures we only fetch the top 1 result extremely fast
            info = ydl.extract_info(f"ytsearch1:{q}", download=False)
            if 'entries' in info and len(info['entries']) > 0:
                entry = info['entries'][0]
                
                # Fetch highest quality thumbnail/poster
                thumbnail = ''
                if entry.get('thumbnails'):
                    thumbnail = entry['thumbnails'][-1]['url']
                    
                return {
                    "id": entry['id'],
                    "title": entry['title'],
                    "thumbnail": thumbnail,
                    "uploader": entry.get('uploader', '')
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="No results found")

# Endpoint to extract the raw live streaming audio URL from YouTube
@app.get("/api/stream")
def stream(id: str):
    ydl_opts = {
        # Prefer high quality: Opus/WebM first (best for web), then m4a, then anything
        'format': 'bestaudio[ext=webm][abr>=128]/bestaudio[ext=m4a][abr>=128]/bestaudio[abr>=128]/bestaudio/best',
        'quiet': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # We don't download, we just extract the direct raw audio URL
            info = ydl.extract_info(id, download=False)
            url = info['url']
            format_note = info.get('format_note', '')
            abr = info.get('abr', 0)
            ext = info.get('ext', '')
            return {"url": url, "quality": f"{abr}kbps {ext}", "format_note": format_note}
    except Exception as e:
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)

@app.get("/api/trending")
async def get_trending():
    try:
        top_res = ytmusic.search("Top Songs Hits", filter="songs", limit=10)
        trend_res = ytmusic.search("Viral Trending Songs", filter="songs", limit=10)
        
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
async def get_recommendations(history: str = ""):
    try:
        if not history:
            return {"status": "success", "recommendations": []}
            
        # Get the most recent played artist/song from history
        last_played = history.split(',')[-1].strip()
        search_results = ytmusic.search(query=last_played, filter="songs", limit=10)
        
        recs = []
        for item in search_results:
            artist_name = item['artists'][0]['name'] if item.get('artists') else "Unknown"
            thumbnail = item['thumbnails'][-1]['url'] if item.get('thumbnails') else ""
            recs.append({"title": item['title'], "artist": artist_name, "cover": thumbnail})
            
        return {"status": "success", "recommendations": recs}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    print("Starting Apple Music Streaming Server at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
