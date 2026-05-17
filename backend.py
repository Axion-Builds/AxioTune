from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import yt_dlp
import uvicorn

app = FastAPI()

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
        'format': 'bestaudio/best',
        'quiet': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # We don't download, we just extract the direct raw audio URL
            info = ydl.extract_info(id, download=False)
            url = info['url']
            return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("Starting Apple Music Streaming Server at http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
