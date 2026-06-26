import yt_dlp

ydl_opts = {
    'format': 'bestaudio',
    'quiet': True,
    'extractor_args': {
        'youtube': {
            'player_client': ['web'],
        }
    },
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info('https://music.youtube.com/watch?v=dQw4w9WgXcQ', download=False)
    print("URL FOUND:", info.get('url') is not None)
    print("URL START:", info['url'][:50] if 'url' in info else "NONE")
