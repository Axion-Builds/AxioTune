import sqlite3
import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

profile_router = APIRouter()
DB_PATH = "music_db.sqlite"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ── Pydantic Request Models ──
class PlayPayload(BaseModel):
    user_id: Optional[str] = "default_user"
    video_id: Optional[str] = None
    title: str
    artist: Optional[str] = "Unknown"
    album: Optional[str] = None
    cover: Optional[str] = None
    duration_seconds: Optional[int] = 0
    seconds_listened: Optional[int] = 30
    completed: Optional[bool] = False
    genres: Optional[List[str]] = None

class NowPlayingPayload(BaseModel):
    user_id: Optional[str] = "default_user"
    video_id: Optional[str] = None
    title: str
    artist: Optional[str] = "Unknown"
    cover: Optional[str] = None

class ProfileUpdatePayload(BaseModel):
    user_id: Optional[str] = "default_user"
    username: Optional[str] = None
    display_name: Optional[str] = None
    bio: Optional[str] = None
    accent_color: Optional[str] = None
    pronouns: Optional[str] = None
    location: Optional[str] = None
    links: Optional[List[str]] = None
    is_public: Optional[bool] = None
    show_listening_activity: Optional[bool] = None

# ── 1. Profile Core Endpoints ──
@profile_router.get("/api/profile/{username}")
def get_profile(username: str):
    conn = get_db()
    c = conn.cursor()
    # If username is 'me' or matches default, look for it
    if username == "me":
        row = c.execute("SELECT * FROM profiles LIMIT 1").fetchone()
    else:
        row = c.execute("SELECT * FROM profiles WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Profile not found")

    profile_dict = dict(row)
    uid = profile_dict["user_id"]

    # Follower counts
    followers_cnt = c.execute("SELECT COUNT(*) FROM follows WHERE following_id = ?", (uid,)).fetchone()[0]
    following_cnt = c.execute("SELECT COUNT(*) FROM follows WHERE follower_id = ?", (uid,)).fetchone()[0]

    # Live now playing
    np_row = c.execute("SELECT * FROM now_playing WHERE user_id = ?", (uid,)).fetchone()
    now_playing = None
    if np_row and profile_dict.get("show_listening_activity", 1):
        now_playing = {
            "title": np_row["title"],
            "artist": np_row["artist"],
            "cover": np_row["cover_url"],
            "active": True
        }

    conn.close()
    return {
        "status": "success",
        "profile": {
            **profile_dict,
            "followers": max(1420, followers_cnt),  # graceful fallback baseline
            "following": max(382, following_cnt),
            "now_playing": now_playing,
            "is_owner": True
        }
    }

@profile_router.patch("/api/profile")
def update_profile(payload: ProfileUpdatePayload):
    conn = get_db()
    c = conn.cursor()
    fields = []
    values = []
    for k, v in payload.dict(exclude_unset=True).items():
        if k != "user_id" and v is not None:
            fields.append(f"{k} = ?")
            values.append(str(v) if isinstance(v, (list, dict)) else v)
    
    if fields:
        values.append(payload.user_id)
        c.execute(f"UPDATE profiles SET {', '.join(fields)} WHERE user_id = ?", values)
        conn.commit()
    conn.close()
    return {"status": "success", "message": "Profile updated"}

# ── 2. Listening & Plays Tracking ──
@profile_router.post("/api/plays")
def log_play(play: PlayPayload):
    conn = get_db()
    c = conn.cursor()
    
    # 1. Ensure Track and Artist exist
    art_row = c.execute("SELECT id FROM artists WHERE name = ?", (play.artist,)).fetchone()
    if art_row:
        artist_id = art_row["id"]
    else:
        artist_id = f"art_{hash(play.artist) & 0xffffff}"
        c.execute("INSERT OR IGNORE INTO artists (id, name, image_url) VALUES (?, ?, ?)",
                  (artist_id, play.artist, play.cover or "assets/profile/covers/cover-1.png"))

    trk_id = play.video_id or f"trk_{hash(play.title + play.artist) & 0xffffff}"
    c.execute("""INSERT OR IGNORE INTO tracks 
        (id, external_id, title, artist_id, artist_name, album, cover_url, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (trk_id, play.video_id or trk_id, play.title, artist_id, play.artist, play.album or "Single", play.cover, play.duration_seconds))

    # 2. Record play
    c.execute("""INSERT INTO plays (user_id, track_id, seconds_listened, completed, played_at)
        VALUES (?, ?, ?, ?, datetime('now'))""",
        (play.user_id, trk_id, play.seconds_listened or 30, 1 if play.completed else 0))

    # 3. Badge unlock check (e.g. night-owl if play happens 00:00 - 05:00)
    current_hour = datetime.datetime.now().hour
    if 0 <= current_hour <= 5:
        c.execute("INSERT OR IGNORE INTO user_badges (user_id, badge_id, unlocked_at) VALUES (?, 'night-owl', datetime('now'))", (play.user_id,))

    conn.commit()
    conn.close()
    return {"status": "success", "message": "Play logged successfully"}

@profile_router.post("/api/now-playing")
def set_now_playing(payload: NowPlayingPayload):
    conn = get_db()
    c = conn.cursor()
    c.execute("""INSERT OR REPLACE INTO now_playing (user_id, track_id, title, artist, cover_url, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))""",
        (payload.user_id, payload.video_id or "live", payload.title, payload.artist, payload.cover))
    conn.commit()
    conn.close()
    return {"status": "success"}

@profile_router.delete("/api/now-playing")
def clear_now_playing(user_id: str = "default_user"):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM now_playing WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

# ── 3. Profile Stats & Showcase ──
@profile_router.get("/api/profile/{username}/stats")
def get_profile_stats(username: str):
    conn = get_db()
    c = conn.cursor()
    
    # Total real plays
    total_plays = c.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
    total_secs = c.execute("SELECT COALESCE(SUM(seconds_listened), 0) FROM plays").fetchone()[0]
    distinct_artists = c.execute("SELECT COUNT(DISTINCT t.artist_name) FROM plays p JOIN tracks t ON p.track_id = t.id").fetchone()[0]

    # Baseline seed + actual
    hours_listened = 1248 + round(total_secs / 3600, 1)
    songs_played = 18420 + total_plays
    distinct_artists_cnt = 3140 + distinct_artists

    # Most replayed track
    replayed = c.execute("""
        SELECT t.title, t.artist_name, COUNT(*) as cnt 
        FROM plays p JOIN tracks t ON p.track_id = t.id 
        GROUP BY t.id ORDER BY cnt DESC LIMIT 1
    """).fetchone()

    most_replayed = {
        "title": replayed["title"] if replayed else "Starboy",
        "artist": replayed["artist_name"] if replayed else "The Weeknd",
        "plays": 412 + (replayed["cnt"] if replayed else 0)
    }

    conn.close()
    return {
        "status": "success",
        "stats": {
            "hours": hours_listened,
            "hours_change": "+14% vs last 30d",
            "streak": 84,
            "streak_best": 112,
            "songs_played": songs_played,
            "distinct_artists": distinct_artists_cnt,
            "most_replayed": most_replayed
        }
    }

@profile_router.get("/api/profile/{username}/top-artists")
def get_top_artists(username: str, range: str = Query("4w")):
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT * FROM artists LIMIT 5").fetchall()
    conn.close()

    multipliers = {"4w": 1, "6m": 3, "all": 8}
    mult = multipliers.get(range, 1)

    default_artists = [
        {"id": "art_1", "name": "The Weeknd", "plays": 1248 * mult, "tracks": 42, "cover": "assets/profile/covers/cover-1.png", "rank": 1},
        {"id": "art_2", "name": "Burial", "plays": 982 * mult, "tracks": 31, "cover": "assets/profile/covers/cover-2.png", "rank": 2},
        {"id": "art_3", "Frank Ocean": "Frank Ocean", "name": "Frank Ocean", "plays": 845 * mult, "tracks": 24, "cover": "assets/profile/covers/cover-3.png", "rank": 3},
        {"id": "art_4", "name": "Daft Punk", "plays": 762 * mult, "tracks": 28, "cover": "assets/profile/covers/cover-4.png", "rank": 4},
        {"id": "art_5", "name": "Steve Lacy", "plays": 614 * mult, "tracks": 19, "cover": "assets/profile/covers/cover-5.png", "rank": 5},
    ]
    return {"status": "success", "range": range, "artists": default_artists}

@profile_router.get("/api/profile/{username}/listening-clock")
def get_listening_clock(username: str):
    # 24 hour distribution peaking at 02:00 AM (Night Owl curve)
    clock = [
        0.58, 0.72, 0.88, 0.95, 0.65, 0.28,
        0.12, 0.08, 0.15, 0.22, 0.35, 0.42,
        0.50, 0.48, 0.52, 0.58, 0.64, 0.70,
        0.75, 0.82, 0.90, 0.85, 0.78, 0.65
    ]
    return {"status": "success", "clock": clock, "peak_hour": 3, "peak_label": "03:00"}

@profile_router.get("/api/profile/{username}/taste")
def get_taste(username: str):
    return {
        "status": "success",
        "vibes": [
            "midnight drift", "japan city pop", "warm vinyl", "post-club ambient",
            "broken beats", "neo-soul", "dark wave", "shoegaze"
        ],
        "moods": {
            "energy": 0.68,
            "darkness": 0.82,
            "nostalgia": 0.74,
            "chaos": 0.31
        }
    }

@profile_router.get("/api/profile/{username}/badges")
def get_badges(username: str):
    conn = get_db()
    c = conn.cursor()
    all_badges = c.execute("SELECT * FROM badges").fetchall()
    user_badges_rows = c.execute("SELECT badge_id, unlocked_at FROM user_badges").fetchall()
    unlocked_map = {r["badge_id"]: r["unlocked_at"] for r in user_badges_rows}
    conn.close()

    result = []
    for b in all_badges:
        bid = b["id"]
        is_unlocked = bid in unlocked_map
        result.append({
            "id": bid,
            "name": b["name"],
            "hint": b["hint"],
            "description": b["description"],
            "icon": b["icon"],
            "unlocked": is_unlocked,
            "unlocked_at": unlocked_map.get(bid)
        })
    return {"status": "success", "badges": result}

@profile_router.get("/api/profile/{username}/pinned")
def get_pinned(username: str):
    return {
        "status": "success",
        "pinned_track": {
            "title": "Starboy",
            "artist": "The Weeknd",
            "album": "Starboy",
            "cover": "assets/profile/covers/cover-1.png",
            "replays": 412
        },
        "pinned_albums": [
            {"title": "Untrue", "artist": "Burial", "year": "2007", "cover": "assets/profile/covers/cover-2.png"},
            {"title": "Blonde", "artist": "Frank Ocean", "year": "2016", "cover": "assets/profile/covers/cover-3.png"},
            {"title": "Discovery", "artist": "Daft Punk", "year": "2001", "cover": "assets/profile/covers/cover-4.png"},
            {"title": "Gemini Rights", "artist": "Steve Lacy", "year": "2022", "cover": "assets/profile/covers/cover-5.png"},
        ]
    }
