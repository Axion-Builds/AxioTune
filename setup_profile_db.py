import sqlite3, os

def setup_profile_tables():
    db_path = r'C:\Users\Adarsh shukla\Desktop\AxioTune\music_db.sqlite'
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Create profile tables
    c.execute('''CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT,
        bio TEXT,
        avatar_url TEXT,
        banner_url TEXT,
        accent_color TEXT DEFAULT '#ff6b4a',
        pronouns TEXT,
        location TEXT,
        links TEXT DEFAULT '[]',
        is_public BOOLEAN DEFAULT 1,
        show_listening_activity BOOLEAN DEFAULT 1,
        timezone TEXT DEFAULT 'UTC',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS artists (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        external_id TEXT,
        image_url TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        external_id TEXT UNIQUE,
        title TEXT,
        artist_id TEXT,
        artist_name TEXT,
        album TEXT,
        cover_url TEXT,
        duration_seconds INTEGER,
        genres TEXT,
        energy REAL DEFAULT 0.65,
        darkness REAL DEFAULT 0.75,
        nostalgia REAL DEFAULT 0.70,
        chaos REAL DEFAULT 0.35
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        track_id TEXT,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        seconds_listened INTEGER,
        completed BOOLEAN DEFAULT 1
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS badges (
        id TEXT PRIMARY KEY,
        name TEXT,
        hint TEXT,
        description TEXT,
        icon TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS user_badges (
        user_id TEXT,
        badge_id TEXT,
        unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, badge_id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS pins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        kind TEXT,
        ref_id TEXT,
        position INTEGER
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS follows (
        follower_id TEXT,
        following_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (follower_id, following_id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS now_playing (
        user_id TEXT PRIMARY KEY,
        track_id TEXT,
        title TEXT,
        artist TEXT,
        cover_url TEXT,
        started_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')

    # Seed badges
    badges_data = [
        ('night-owl', 'Night Owl', '00:00 - 05:00', 'Logged at least 50 plays between midnight and dawn', 'moon'),
        ('replay', 'Replay Demon', '300+ on one track', 'Obsessively spun a single track 300+ times', 'repeat'),
        ('crate', 'Crate Digger', '600+ artists', 'Explored 600+ distinct artists across underground scenes', 'disc'),
        ('streak', 'Relentless Streak', '60 days', 'Maintained a daily listening streak for 60 consecutive days', 'flame'),
        ('early', 'Early Adopter', 'Founding Vanguard', 'Joined AxioTune in its genesis era', 'sparkles')
    ]
    c.executemany('INSERT OR IGNORE INTO badges (id, name, hint, description, icon) VALUES (?, ?, ?, ?, ?)', badges_data)

    # Seed default profile for velvet.static
    c.execute('''INSERT OR IGNORE INTO profiles 
        (user_id, username, display_name, bio, avatar_url, accent_color, pronouns, location, is_public, show_listening_activity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (
        'default_user',
        'velvet.static',
        'velvet static',
        "curating midnight drift, late-night vinyl, and broken beats. if it has reverb and warmth, i'm listening.",
        'assets/profile/avatar.png',
        '#ff6b4a',
        'they/them',
        'tokyo / berlin',
        1,
        1,
        '2024-10-15 00:00:00'
    ))

    # Seed initial unlocked user badges for default_user (4 of 5 unlocked, early is in progress)
    unlocked = [('default_user', b[0], '2024-10-20') for b in badges_data[:4]]
    c.executemany('INSERT OR IGNORE INTO user_badges (user_id, badge_id, unlocked_at) VALUES (?, ?, ?)', unlocked)

    # Seed top artists for velvet.static
    artists_data = [
        ('art_1', 'The Weeknd', 'the_weeknd', 'assets/profile/covers/cover-1.png'),
        ('art_2', 'Burial', 'burial', 'assets/profile/covers/cover-2.png'),
        ('art_3', 'Frank Ocean', 'frank_ocean', 'assets/profile/covers/cover-3.png'),
        ('art_4', 'Daft Punk', 'daft_punk', 'assets/profile/covers/cover-4.png'),
        ('art_5', 'Steve Lacy', 'steve_lacy', 'assets/profile/covers/cover-5.png'),
    ]
    c.executemany('INSERT OR IGNORE INTO artists (id, name, external_id, image_url) VALUES (?, ?, ?, ?)', artists_data)

    # Seed tracks for velvet.static
    tracks_data = [
        ('trk_1', 'starboy_yt', 'Starboy', 'art_1', 'The Weeknd', 'Starboy', 'assets/profile/covers/cover-1.png', 230, 'R&B, synth-pop, dark-r&b', 0.82, 0.72, 0.65, 0.40),
        ('trk_2', 'archangel_yt', 'Archangel', 'art_2', 'Burial', 'Untrue', 'assets/profile/covers/cover-2.png', 240, 'future-garage, dubstep, ambient', 0.55, 0.92, 0.88, 0.30),
        ('trk_3', 'pyramids_yt', 'Pyramids', 'art_3', 'Frank Ocean', 'channel ORANGE', 'assets/profile/covers/cover-3.png', 585, 'neo-soul, r&b, synth-pop', 0.70, 0.60, 0.78, 0.25),
        ('trk_4', 'veridis_yt', 'Veridis Quo', 'art_4', 'Daft Punk', 'Discovery', 'assets/profile/covers/cover-4.png', 345, 'electronic, synthwave, french-house', 0.60, 0.65, 0.90, 0.20),
        ('trk_5', 'darkred_yt', 'Dark Red', 'art_5', 'Steve Lacy', 'Steve Lacy\'s Demo', 'assets/profile/covers/cover-5.png', 173, 'indie-rock, lo-fi, neo-soul', 0.75, 0.68, 0.80, 0.35),
    ]
    c.executemany('INSERT OR IGNORE INTO tracks (id, external_id, title, artist_id, artist_name, album, cover_url, duration_seconds, genres, energy, darkness, nostalgia, chaos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', tracks_data)

    # Seed initial now_playing
    c.execute('''INSERT OR REPLACE INTO now_playing (user_id, track_id, title, artist, cover_url, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))''', (
        'default_user',
        'trk_1',
        'Starboy',
        'The Weeknd',
        'assets/profile/covers/cover-1.png'
    ))

    # Seed pins
    pins_data = [
        ('default_user', 'track', 'trk_1', 1),
        ('default_user', 'album', 'Untrue', 2),
        ('default_user', 'album', 'Blonde', 3),
        ('default_user', 'album', 'Discovery', 4),
        ('default_user', 'album', 'Gemini Rights', 5),
    ]
    for p in pins_data:
        c.execute('INSERT OR IGNORE INTO pins (user_id, kind, ref_id, position) VALUES (?, ?, ?, ?)', p)

    conn.commit()
    conn.close()
    print('Profile database initialization complete and verified!')

if __name__ == '__main__':
    setup_profile_tables()
