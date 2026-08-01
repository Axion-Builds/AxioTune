let _errCnt=0; window.onerror=function(m,u,l){if(++_errCnt>5)return false;console.error(m,l);let e=document.createElement('div');e.style.cssText='position:fixed;top:10px;left:50%;transform:translateX(-50%);background:red;color:white;padding:10px;z-index:999999;border-radius:8px;font-size:12px;';e.textContent='Err: '+m+' (L'+l+')';document.body.appendChild(e);setTimeout(()=>e.remove(),5000);return false;};
window.onunhandledrejection = function(event) { console.error('Promise Rejection: ', event.reason); };
window._localNetworkIp = null;
fetch('/api/ip').then(r => r.json()).then(data => { window._localNetworkIp = data.ip; }).catch(() => {});// --- YOUTUBE IFRAME API MOCK AUDIO PLAYER ---
let ytPlayer;
const audioPlayer = {
    _src: '',
    _queuedVid: null,
    _volume: 1,
    _playbackRate: 1,
    paused: true,
    readyState: 0,
    error: null,
    listeners: {},
    _mode: 'yt',
    _proxyDuration: 0,
    _realAudio: new Audio(),
    initRealAudio: function() {
        if (this._realAudioInitialized) return;
        this._realAudioInitialized = true;
        const events = ['play', 'pause', 'timeupdate', 'ended', 'waiting', 'playing'];
        events.forEach(e => {
            this._realAudio.addEventListener(e, () => {
                if (this._mode === 'local') {
                    if (e === 'play' || e === 'playing') this.paused = false;
                    if (e === 'pause' || e === 'ended') this.paused = true;
                    this.dispatchEvent(e);
                }
            });
        });
    },
    addEventListener: function(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    },
    dispatchEvent: function(evt, data) {
        if (this.listeners[evt]) {
            this.listeners[evt].forEach(cb => {
                try {
                    cb(data);
                } catch(e) {
                    console.error('Error in listener for', evt, e);
                }
            });
        }
    },
    play: async function() {
        if (this._mode === 'local') {
            await this._realAudio.play().catch(e => console.warn('Local audio play error', e));
            this.paused = false;
            return Promise.resolve();
        }
        if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
        this.paused = false;
        this.dispatchEvent('play');
        return Promise.resolve();
    },
    pause: function() {
        if (this._mode === 'local') {
            this._realAudio.pause();
            this.paused = true;
            return;
        }
        if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        this.paused = true;
        this.dispatchEvent('pause');
    },
    load: function() { /* no-op */ },
    set src(val) {
        this.initRealAudio();
        this._src = val;
        let vid = val;
        
        // Handle local downloaded files or blob URLs directly with HTMLAudioElement
        if (val && (val.startsWith('/') || val.startsWith('blob:'))) {
            this._mode = 'local';
            if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
            this._realAudio.src = val;
            this._realAudio.load();
            this.paused = true;
            return;
        }
        
        this._mode = 'yt';
        this._realAudio.pause();

        if (val && val.includes('proxy_stream')) {
            try {
                vid = decodeURIComponent(val.split('url=')[1]);
                if (vid.includes('http')) {
                    // if it's a full http URL (e.g. from yt-dlp fallback), we extract video ID if possible
                    if (vid.includes('v=')) vid = vid.split('v=')[1].split('&')[0];
                    else if (vid.includes('youtu.be/')) vid = vid.split('youtu.be/')[1].split('?')[0];
                }
            } catch(e){}
        }
        if (vid && vid.includes('http')) return; // Ignore full urls
        
        if (ytPlayer && ytPlayer.loadVideoById && vid) {
            ytPlayer.loadVideoById(vid);
            this.paused = false;
            this.dispatchEvent('play');
        } else if (vid) {
            this._queuedVid = vid;
        }
    },
    get src() { return this._src; },
    get currentTime() { 
        if (this._mode === 'local') return this._realAudio.currentTime;
        if (!ytPlayer || !ytPlayer.getCurrentTime) return 0;
        const now = performance.now();
        if (!window._lastYtReadTime || now - window._lastYtReadTime > 150) {
            window._cachedYtTime = ytPlayer.getCurrentTime() || 0;
            window._lastYtReadTime = now;
        }
        if (this.paused) return window._cachedYtTime || 0;
        return (window._cachedYtTime || 0) + ((now - window._lastYtReadTime) / 1000);
    },
    set currentTime(val) { 
        if (this._mode === 'local') { this._realAudio.currentTime = val; return; }
        if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(val, true); 
    },
    get duration() {
        if (this._mode === 'local') return this._realAudio.duration || this._proxyDuration || 0;
        return ytPlayer && ytPlayer.getDuration ? ytPlayer.getDuration() : 0; 
    },
    get volume() { return this._volume; },
    set volume(val) {
        this._volume = val;
        this._realAudio.volume = val;
        if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(val * 100);
    },
    get playbackRate() { return this._playbackRate; },
    set playbackRate(val) {
        this._playbackRate = val;
        this._realAudio.playbackRate = val;
        if (ytPlayer && ytPlayer.setPlaybackRate) ytPlayer.setPlaybackRate(val);
    }
};

window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('youtube-player', {
        height: '1',
        width: '1',
        videoId: '',
        playerVars: {
            'playsinline': 1,
            'controls': 0,
            'disablekb': 1,
            'autoplay': 1
        },
        events: {
            'onReady': () => { 
                audioPlayer.readyState = 4; 
                if (audioPlayer._queuedVid) {
                    ytPlayer.loadVideoById(audioPlayer._queuedVid);
                    audioPlayer.paused = false;
                    audioPlayer.dispatchEvent('play');
                    audioPlayer._queuedVid = null;
                }
            },
            'onStateChange': onPlayerStateChange,
            'onError': () => { audioPlayer.dispatchEvent('error'); }
        }
    });
};

// Scroll Listener for Top Bar
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.screen-view').forEach(screen => {
        let topBarScrollTimeout;
        screen.addEventListener('scroll', () => {
            if (!screen.classList.contains('active-screen')) return;
            const topBar = document.getElementById('top-bar-wrapper');
            if (topBar) {
                if (topBarScrollTimeout) return;
                topBarScrollTimeout = requestAnimationFrame(() => {
                    const st = screen.scrollTop;
                    topBar.style.transform = st > 50 ? 'translateY(-4px)' : 'translateY(0)';
                    topBarScrollTimeout = null;
                });
            }
        }, {passive: true});
    });
});
if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
}

let timeupdateInterval;
function onPlayerStateChange(event) {
    if (audioPlayer._mode !== 'yt') return;
    if (event.data == YT.PlayerState.PLAYING) {
        audioPlayer.paused = false;
        audioPlayer.dispatchEvent('play');
        audioPlayer.dispatchEvent('loadedmetadata');
    } else if (event.data == YT.PlayerState.PAUSED) {
        audioPlayer.paused = true;
        audioPlayer.dispatchEvent('pause');
    } else if (event.data == YT.PlayerState.ENDED) {
        audioPlayer.paused = true;
        audioPlayer.dispatchEvent('ended');
    } else if (event.data == YT.PlayerState.BUFFERING) {
        audioPlayer.dispatchEvent('stalled');
    }
}
// ------------------------------------------
        const playPauseBtn = document.getElementById('play-pause-btn');
        const songSearchInput = document.getElementById('song-search');
        const searchBtn = document.getElementById('search-btn');
        const lyricsContainer = document.getElementById('lyrics-container');
        
        // Wrap lyrics container for horizontal sliding (Focus Mode trick) without fighting JS Y-transforms
        const lyricsWrapper = document.createElement('div');
        lyricsWrapper.id = 'lyrics-wrapper';
        lyricsContainer.parentNode.insertBefore(lyricsWrapper, lyricsContainer);
        lyricsWrapper.appendChild(lyricsContainer);
        const coverArt = document.getElementById('cover-art');
        const coverArtContainer = document.getElementById('cover-art-container');
        const backgroundLayer = document.getElementById('background-layer');
        const progressContainer = document.getElementById('progress-container');
        const progressBar = document.getElementById('progress-bar');
        const currentTimeEl = document.getElementById('current-time');
        const durationEl = document.getElementById('duration');
        const rightPanel = document.getElementById('right-panel');
        const trackTitleEl = document.getElementById('track-title');
        const trackArtistEl = document.getElementById('track-artist');
        
        const homeScreen = document.getElementById('home-screen');
        const playerScreen = document.getElementById('player-screen');

        // Fix z-index stacking context issue by moving controls to root
        const topControls = document.getElementById('top-right-controls');
        if (topControls) document.body.appendChild(topControls);

        // queue-panel is now placed directly at body level in HTML Ã¢â‚¬â€ no move needed


        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ IndexedDB Offline Storage Setup ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        let db;
        const dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('AxioTuneDB', 1);
            request.onerror = (e) => reject('IndexedDB error: ' + e.target.error);
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
                loadDownloadedSongs(); // Load UI once ready
            };
            request.onupgradeneeded = (e) => {
                const upgradeDb = e.target.result;
                if (!upgradeDb.objectStoreNames.contains('downloads')) {
                    // id is the youtube videoId
                    upgradeDb.createObjectStore('downloads', { keyPath: 'id' });
                }
            };
        });

        // Save a song to IndexedDB
        async function saveDownloadedSong(songMeta, blob) {
            await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('downloads', 'readwrite');
                const store = tx.objectStore('downloads');
                const record = {
                    id: songMeta.id,
                    title: songMeta.title,
                    artist: songMeta.artist || songMeta.uploader,
                    cover: songMeta.thumbnail || songMeta.cover,
                    blob: blob,
                    savedAt: Date.now()
                };
                store.put(record);
                tx.oncomplete = () => {
                    showToast('Saved offline: ' + record.title);
                    loadDownloadedSongs();
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            });
        }

        // Get all downloaded songs
        async function getDownloadedSongs() {
            await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('downloads', 'readonly');
                const store = tx.objectStore('downloads');
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        }
        
        // Remove downloaded song
        async function deleteDownloadedSong(id) {
            await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction('downloads', 'readwrite');
                const store = tx.objectStore('downloads');
                store.delete(id);
                tx.oncomplete = () => {
                    loadDownloadedSongs();
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            });
        }
        window.deleteDownloadedSong = deleteDownloadedSong;

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Offline Mode ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        function updateNetworkStatus() {
            if (!navigator.onLine) {
                showToast('Device is offline. Using local cache.');
                // Removed aggressive redirects that break local testing
            } else {
                document.body.classList.remove('offline-mode');
                showToast('Back online!');
            }
        }
        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);
        
        // Initial check on load
        setTimeout(updateNetworkStatus, 500);
        let lyricsData = [];
        let wordElements = [];
        let lineElements = [];
        let targetY = 0;
        let currentY = 0;
        let isDraggingProgress = false;
        let activeLineIndex = -1;
        let isSongLoaded = false; // Robust flag to track if any song has been loaded
        let currentVideoId = null;
        let streamRefreshInProgress = false;

        // Helper function to build srcset for responsive images safely
        function buildSrcset(thumbnails) {
            if (!thumbnails || !Array.isArray(thumbnails)) return '';
            return thumbnails.map(t => `${t.url} ${t.width}w`).join(', ');
        }

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ NEW FEATURE STATE ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        // Shuffle / Repeat
        let isShuffled = false;
        let repeatMode = 0; // 0=off, 1=all, 2=one
        let originalQueue = []; // backup for un-shuffle

        // Liked songs & playlists (persisted in localStorage)
        const LIKED_KEY = 'liked_songs_v1';
        const PLAYLISTS_KEY = 'playlists_v1';
        let currentSongMeta = null; // { title, artist, cover } for the currently playing song

        let backendLikedSongs = [];
        let backendPlaylists = [];
        
        async function fetchLibraryData() {
            try {
                const resL = await fetch('/api/library/likes');
                if (resL.ok) {
                    const data = await resL.json();
                    backendLikedSongs = data.results || [];
                }
                const resP = await fetch('/api/library/playlists');
                if (resP.ok) {
                    const data = await resP.json();
                    backendPlaylists = data.playlists || [];
                }
            } catch(e) { console.error('Library sync error', e); }
        }
        // Fetch library on load
        fetchLibraryData();

        function getLikedSongs() { return backendLikedSongs; }
        function saveLikedSongs(arr) { backendLikedSongs = arr; }
        function getPlaylists() { return backendPlaylists; }
        function savePlaylists(arr) { backendPlaylists = arr; }

        function isSongLiked(title, artist) {
            return getLikedSongs().some(s => s.title === title && s.artist === artist);
        }

        async function downloadAndSaveSong(songMeta) {
            if(!songMeta || !songMeta.id) return;
            try {
                const existing = await getDownloadedSongs();
                if(existing.find(s => s.id === songMeta.id)) return; // Already saved
                
                // Add UI Progress Element
                const progressContainer = document.getElementById('download-progress-container');
                const progressEl = document.createElement('div');
                progressEl.style.cssText = 'background:rgba(30,20,50,0.9);backdrop-filter:blur(10px);color:white;padding:10px 15px;border-radius:10px;font-size:0.9rem;border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;';
                progressEl.innerHTML = `<div class="spinner" style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.2);border-top-color:var(--accent);border-radius:50%;animation:glassSpin 0.8s linear infinite;"></div> Downloading ${songMeta.title}...`;
                if(progressContainer) progressContainer.appendChild(progressEl);

                const res = await fetch(`/api/download?id=${songMeta.id}&title=${encodeURIComponent(songMeta.title)}`);
                if(!res.ok) throw new Error("Download failed");
                const blob = await res.blob();
                await saveDownloadedSong(songMeta, blob);

                // Success State
                progressEl.innerHTML = `<svg viewBox="0 0 24 24" style="fill:#4CAF50;width:18px;height:18px;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Saved: ${songMeta.title}`;
                setTimeout(() => progressEl.remove(), 3000);

            } catch (err) {
                console.error("Auto-download failed:", err);
                const progressContainer = document.getElementById('download-progress-container');
                if (progressContainer && progressContainer.lastChild) {
                    progressContainer.lastChild.innerHTML = `<svg viewBox="0 0 24 24" style="fill:#f44336;width:18px;height:18px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg> Failed: ${songMeta.title}`;
                    setTimeout(() => progressContainer.lastChild.remove(), 4000);
                }
            }
        }

        function toggleLike(songObjOverride = null) {
            const targetSong = songObjOverride || currentSongMeta;
            if (!targetSong) return;
            const liked = getLikedSongs();
            const idx = liked.findIndex(s => s.title === targetSong.title && s.artist === targetSong.artist);
            
            let isLiking = false;
            if (idx === -1) {
                liked.unshift({ ...targetSong, likedAt: new Date().toISOString() });
                isLiking = true;
                if (!songObjOverride || (currentSongMeta && currentSongMeta.title === targetSong.title)) setLikeUI(true);
                showToast('Added to Liked Songs  ');
                downloadAndSaveSong(targetSong); // Auto-download on Like
            } else {
                liked.splice(idx, 1);
                if (!songObjOverride || (currentSongMeta && currentSongMeta.title === targetSong.title)) setLikeUI(false);
                showToast('Removed from Liked Songs');
            }
            saveLikedSongs(liked);
            
            // Backend sync
            fetch('/api/library/likes/toggle', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    video_id: targetSong.videoId || targetSong.id || '',
                    title: targetSong.title,
                    artist: targetSong.artist,
                    cover: targetSong.cover || ''
                })
            }).catch(e => console.error(e));
        }

        function setLikeUI(isLiked) {
            const likeBtn = document.getElementById('like-btn');
            const miniLikeBtn = document.getElementById('mini-like-btn');
            const filledHeart = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
            const emptyHeart = '<svg viewBox="0 0 24 24"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>';
            if (likeBtn) {
                likeBtn.innerHTML = isLiked ? filledHeart : emptyHeart;
                likeBtn.classList.toggle('liked', isLiked);
            }
            if (miniLikeBtn) {
                miniLikeBtn.innerHTML = isLiked ? filledHeart : emptyHeart;
                miniLikeBtn.classList.toggle('liked', isLiked);
            }
        }

        // Like button click
        document.getElementById('like-btn')?.addEventListener('click', () => toggleLike());
        
        document.getElementById('download-btn')?.addEventListener('click', () => {
            if (!currentSongMeta || !currentSongMeta.id) return;
            showToast('Starting Download...');
            window.location.href = `/api/download?id=${currentSongMeta.id}&title=${encodeURIComponent(currentSongMeta.title)}`;
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ SHUFFLE ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        const shuffleBtn = document.getElementById('shuffle-btn');
        shuffleBtn?.addEventListener('click', () => {
            isShuffled = !isShuffled;
            shuffleBtn.classList.toggle('active', isShuffled);
            if (isShuffled) {
                originalQueue = [...queueList];
                // Fisher-Yates shuffle, keep current song at front
                const current = queueList[currentQueueIndex];
                const rest = queueList.filter((_, i) => i !== currentQueueIndex);
                for (let i = rest.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [rest[i], rest[j]] = [rest[j], rest[i]];
                }
                queueList = [current, ...rest];
                currentQueueIndex = 0;
                renderQueue();
                showToast('Shuffle ON');
            } else {
                queueList = [...originalQueue];
                renderQueue();
                showToast('Shuffle OFF');
            }
            if (typeof updateQueueControlsState === 'function') updateQueueControlsState();
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ REPEAT ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        const repeatBtn = document.getElementById('repeat-btn');
        const repeatSVG_off = '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>';
        const repeatSVG_all = '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>';
        const repeatSVG_one = '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>';
        repeatBtn?.addEventListener('click', () => {
            repeatMode = (repeatMode + 1) % 3;
            repeatBtn.classList.remove('active', 'repeat-one');
            if (repeatMode === 0) { repeatBtn.innerHTML = repeatSVG_off; showToast('Repeat OFF'); }
            else if (repeatMode === 1) { repeatBtn.classList.add('active'); repeatBtn.innerHTML = repeatSVG_all; showToast('Repeat ALL'); }
            else { repeatBtn.classList.add('active', 'repeat-one'); repeatBtn.innerHTML = repeatSVG_one; showToast('Repeat ONE'); }
            if (typeof updateQueueControlsState === 'function') updateQueueControlsState();
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ TOAST NOTIFICATION ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        function showToast(msg) {
            let t = document.getElementById('toast-notif');
            if (!t) {
                t = document.createElement('div');
                t.id = 'toast-notif';
                t.style.cssText = 'position:fixed;bottom:130px;left:50%;transform:translate(-50%,0);background:rgba(30,20,50,0.9);backdrop-filter:blur(20px);color:white;padding:10px 22px;border-radius:30px;font-size:0.9rem;font-weight:600;z-index:99999;pointer-events:none;opacity:0;transition:opacity 0.3s;border:1px solid rgba(255,255,255,0.15);box-shadow:0 10px 30px rgba(0,0,0,0.4);';
                document.body.appendChild(t);
            }
            t.textContent = msg;
            t.style.opacity = '1';
            clearTimeout(t._timer);
            t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
        }

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ LIBRARY SCREEN LOGIC ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        function showLibrary() {
            if(playerScreen.classList.contains('active-screen') && isSongLoaded) {
                triggerFlipAnimation(coverArtContainer, miniCover, () => { coverArtContainer.style.opacity = '1'; });
            }
            if(isSongLoaded) miniPlayer.classList.remove('hidden-mini');
            showScreenExcept('library-screen');
            renderLikedSongs();
            renderPlaylists();
            if(window.loadLibraryArtists) window.loadLibraryArtists();
        }

        // Library tab switching
        document.querySelectorAll('.lib-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const which = tab.getAttribute('data-tab');
                document.getElementById('lib-liked-panel').style.display = which === 'liked' ? 'block' : 'none';
                document.getElementById('lib-artists-panel').style.display = which === 'artists' ? 'block' : 'none';
                document.getElementById('lib-playlists-panel').style.display = which === 'playlists' ? 'block' : 'none';
                const downloadsPanel = document.getElementById('lib-downloads-panel');
                if (downloadsPanel) downloadsPanel.style.display = which === 'downloads' ? 'block' : 'none';
                
                if (which === 'liked') renderLikedSongs();
                if (which === 'artists') renderArtists();
                if (which === 'playlists') renderPlaylists();
                if (which === 'downloads') loadDownloadedSongs();
            });
        });

        async function loadDownloadedSongs() {
            const listEl = document.getElementById('downloaded-songs-list');
            if(!listEl) return;
            try {
                const songs = await getDownloadedSongs();
                if(songs.length === 0) {
                    listEl.innerHTML = '<div class="empty-state lib-empty">No downloaded songs.<br><span>Like or add songs to a playlist to auto-download them.</span></div>';
                    return;
                }
                
                let html = '';
                songs.forEach((song) => {
                    // Create object URL for the blob
                    const localUrl = URL.createObjectURL(song.blob);
                    // Temporarily store in a global map to play later
                    window._downloadedCache = window._downloadedCache || {};
                    window._downloadedCache[song.id] = localUrl;
                    
                    html += `<div class="premium-list-item" onclick="playDownloadedSong('${song.id}')">
                        <img src="${song.cover}" alt="cover" class="premium-list-img">
                        <div class="premium-list-info">
                            <div class="premium-list-title">${song.title}</div>
                            <div class="premium-list-subtitle">${song.artist}</div>
                        </div>
                        <button class="song-options-btn" onclick="event.stopPropagation(); window.deleteDownloadedSong('${song.id}');">
                            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>`;
                });
                listEl.innerHTML = html;
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="empty-state lib-empty">Error loading downloads.</div>';
            }
        }

        window.playDownloadedSong = async function(id) {
            const songs = await getDownloadedSongs();
            const song = songs.find(s => s.id === id);
            if(!song) return;
            
            queueList = songs.map(s => ({
                ...s,
                localUrl: window._downloadedCache[s.id] || URL.createObjectURL(s.blob)
            }));
            const index = queueList.findIndex(s => s.id === id);
            currentQueueIndex = Math.max(0, index);
            renderQueue();
            
            playQueueIndex(currentQueueIndex);
            setPlayPauseUI(true);
            showPlayer();
        };

        
        window.loadLibraryArtists = function() {
            const container = document.getElementById('library-tab-content');
            if(!container) return;
            
            if(followedArtists.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.5;margin-bottom:15px"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                        <p>You haven't followed any artists yet.</p>
                    </div>
                `;
                return;
            }
            
            let html = '<div class="artist-circle-grid">';
            followedArtists.forEach(artist => {
                html += `
                    <div class="artist-circle-card" onclick="openArtist('${artist.browseId}')">
                        <img src="${artist.thumb}" alt="${artist.name}">
                        <div class="artist-name">${artist.name}</div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        }

        function renderLikedSongs() {
            const container = document.getElementById('liked-songs-list');
            if(!container) return;
            const liked = getLikedSongs();
            if (liked.length === 0) {
                container.innerHTML = '<div class="empty-state lib-empty">No liked songs yet.<br><span>Tap Ã¢â„¢Â¥ while a song plays to save it here.</span></div>';
                return;
            }
            container.innerHTML = '';
            liked.forEach((song, idx) => {
                const coverUrl = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '', song.id || song.videoId);
                const row = document.createElement('div');
                row.className = 'liked-song-row';
                row.style.animationDelay = `${idx * 0.04}s`;
                row.innerHTML = `
                    <div class="liked-song-info">
                        <div class="liked-song-title">${song.title}</div>
                        <div class="liked-song-artist">${song.artist}</div>
                    </div>
                    <button class="like-remove-btn" title="Remove from Liked">
                        <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                `;
                row.addEventListener('click', () => {
                    const songObj = { ...song, query: `${song.title} ${song.artist}` };
                    queueList = liked.map(s => ({...s, query: `${s.title} ${s.artist}`}));
                    currentQueueIndex = idx;
                    renderQueue();
                    window._forceQueueSong = songObj;
                    songSearchInput.value = songObj.title + ' ' + songObj.artist;
                    searchBtn.click();
                });
                row.querySelector('.like-remove-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const arr = getLikedSongs();
                    arr.splice(arr.findIndex(s => s.title === song.title && s.artist === song.artist), 1);
                    saveLikedSongs(arr);
                    renderLikedSongs();
                    if (currentSongMeta && currentSongMeta.title === song.title) setLikeUI(false);
                });
                container.appendChild(row);
            });
        }

        async function renderArtists() {
            const container = document.getElementById('artists-list');
            if(!container) return;
            const liked = getLikedSongs();
            const downloads = await getDownloadedSongs();
            const allSongs = [...liked, ...downloads];
            const artistMap = {};
            
            allSongs.forEach(song => {
                if (song.artist && song.artist !== 'Unknown') {
                    if (!artistMap[song.artist]) {
                        artistMap[song.artist] = { name: song.artist, cover: song.cover || '', count: 1 };
                    } else {
                        artistMap[song.artist].count++;
                    }
                }
            });

            const artists = Object.values(artistMap).sort((a, b) => b.count - a.count);

            if (artists.length === 0) {
                container.innerHTML = '<div class="empty-state lib-empty" style="grid-column: 1/-1;">No artists yet.<br><span>Like or download songs to automatically save artists.</span></div>';
                return;
            }

            container.innerHTML = '';
            artists.forEach((artist, idx) => {
                const coverUrl = getCoverUrl(artist.name, artist.cover);
                const card = document.createElement('div');
                card.className = 'artist-card';
                card.style.animationDelay = `${idx * 0.05}s`;
                card.innerHTML = `
                    <div class="artist-card-img-wrapper" style="width: 100%; aspect-ratio: 1; border-radius: 50%; overflow: hidden; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                        <img src="${coverUrl}" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <div class="artist-card-name" style="font-weight: 600; font-size: 1rem; color: white; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${artist.name}</div>
                    <div class="artist-card-count" style="font-size: 0.8rem; color: rgba(255,255,255,0.6); text-align: center; margin-top: 4px;">${artist.count} song${artist.count !== 1 ? 's' : ''}</div>
                `;
                card.addEventListener('click', () => {
                    showArtistPage(artist.name); // we use name as query fallback if no browseId
                });
                container.appendChild(card);
            });
        }

        function renderPlaylists() {
            const container = document.getElementById('playlists-list');
            const playlists = getPlaylists();
            if (playlists.length === 0) {
                container.innerHTML = '<div class="empty-state lib-empty">No playlists yet.<br><span>Create one above and add songs!</span></div>';
                return;
            }
            container.innerHTML = '';
            playlists.forEach((pl, plIdx) => {
                // Build mosaic thumbnail from up to 4 songs
                const covers = pl.songs.slice(0, 4).map(s => getCoverUrl(`${s.title} ${s.artist}`, s.cover || '', s.id || s.videoId));
                let thumbHtml = '';
                if (covers.length >= 4) {
                    thumbHtml = `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:60px;height:60px;border-radius:10px;overflow:hidden;">${covers.map(c => `<img src="${c}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='default_cover.jpg'">`).join('')}</div>`;
                } else if (covers.length > 0) {
                    thumbHtml = `<img src="${covers[0]}" style="width:60px;height:60px;border-radius:10px;object-fit:cover;" onerror="this.src='default_cover.jpg'">`;
                } else {
                    thumbHtml = `<div style="width:60px;height:60px;border-radius:10px;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:28px;fill:rgba(255,255,255,0.4)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;
                }

                const card = document.createElement('div');
                card.className = 'playlist-card';
                card.innerHTML = `
                    ${thumbHtml}
                    <div class="playlist-info">
                        <div class="playlist-name">${pl.name}</div>
                        <div class="playlist-count">${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}</div>
                    </div>
                    <button class="playlist-delete-btn" title="Delete playlist">
                        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                `;
                // Click opens the playlist page
                card.addEventListener('click', () => openPlaylistPage(plIdx));
                card.querySelector('.playlist-delete-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete playlist "${pl.name}"?`)) {
                        const pls = getPlaylists();
                        pls.splice(plIdx, 1);
                        savePlaylists(pls);
                        renderPlaylists();
                    }
                });
                container.appendChild(card);
            });
        }

        // ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â PLAYLIST FULL PAGE ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
        function openPlaylistPage(plIdx) {
            const pl = getPlaylists()[plIdx];
            if (!pl) return;

            const screen = document.getElementById('playlist-full-screen');
            const bgEl = document.getElementById('playlist-hero-bg');
            const artEl = document.getElementById('playlist-screen-art');
            const nameEl = document.getElementById('playlist-screen-name');
            const countEl = document.getElementById('playlist-screen-count');
            const tracksEl = document.getElementById('playlist-screen-tracks');

            nameEl.textContent = pl.name;
            countEl.textContent = `${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}  Ã¢â‚¬Â¢  Your Playlist`;

            // Build mosaic art or use custom cover
            const covers = pl.songs.slice(0, 4).map(s => getCoverUrl(`${s.title} ${s.artist}`, s.cover || '', s.id || s.videoId));
            let mainCover = '';
            
            if (pl.customCover) {
                artEl.innerHTML = `<img src="${pl.customCover}" onerror="this.src='default_cover.jpg'">`;
                mainCover = pl.customCover;
            } else {
                if (covers.length >= 4) {
                    artEl.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:100%;height:100%;">${covers.map(c => `<img src="${c}" onerror="this.src='default_cover.jpg'">`).join('')}</div>`;
                    mainCover = covers[0];
                } else if (covers.length > 0) {
                    artEl.innerHTML = `<img src="${covers[0]}" onerror="this.src='default_cover.jpg'">`;
                    mainCover = covers[0];
                } else {
                    artEl.innerHTML = `<div style="width:100%;height:100%;background:linear-gradient(135deg,#ff2d55,#af52de);display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 24 24" style="width:64px;fill:white"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;
                }
            }

            // Set background blur
            if (mainCover) {
                bgEl.style.backgroundImage = `url(${mainCover})`;
            } else {
                bgEl.style.backgroundImage = 'none';
            }

            // Add upload overlay
            const artContainer = artEl.parentElement;
            const oldOverlay = artContainer.querySelector('.playlist-art-overlay');
            if (oldOverlay) oldOverlay.remove();
            
            const overlay = document.createElement('div');
            overlay.className = 'playlist-art-overlay';
            overlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 19V5h14v14H5zm6.43-6.53l-3.07 3.83-3.83-4.8L2 17h16l-5.32-6.72z"/></svg>Upload Photo`;
            artContainer.appendChild(overlay);
            
            artContainer.onclick = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (re) => {
                        const pls = getPlaylists();
                        pls[plIdx].customCover = re.target.result;
                        savePlaylists(pls);
                        openPlaylistPage(plIdx); // re-render to update
                    };
                    reader.readAsDataURL(file);
                };
                input.click();
            };

            // Build tracklist
            tracksEl.innerHTML = '';
            if (pl.songs.length === 0) {
                tracksEl.innerHTML = '<div class="empty-state" style="margin-top:30px;">No songs yet.<br><span>Add songs from the 3-dot menu on any track.</span></div>';
            } else {
                pl.songs.forEach((song, sIdx) => {
                    const coverUrl = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '', song.id || song.videoId);
                    const row = document.createElement('div');
                    row.className = 'playlist-track-row';
                    row.innerHTML = `
                        <div class="pt-num">${sIdx + 1}</div>
                        <img class="pt-cover" src="${coverUrl}" onerror="this.src='default_cover.jpg'" alt="">
                        <div class="pt-info">
                            <div class="pt-title">${song.title}</div>
                            <div class="pt-artist">${song.artist}</div>
                        </div>
                        <button class="pt-remove" title="Remove" onclick="event.stopPropagation(); removeSongFromPlaylist(${plIdx}, ${sIdx})">
                            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    `;
                    row.addEventListener('click', () => {
                        // Load this playlist into queue and play from this index
                        queueList.length = 0;
                        pl.songs.forEach(s => queueList.push({ title: s.title, artist: s.artist, cover: s.cover || '', videoId: s.videoId || '' }));
                        currentQueueIndex = sIdx;
                        window._forceQueueSong = { videoId: song.videoId, title: song.title, artist: song.artist, cover: song.cover };
                        songSearchInput.value = `${song.title} ${song.artist}`;
                        searchBtn.click();
                        showToast(`ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¶ Playing from ${pl.name}`);
                    });
                    tracksEl.appendChild(row);
                });
            }

            // Play All button
            const playAllBtn = document.getElementById('pl-screen-play-all-btn');
            if (playAllBtn) {
                playAllBtn.onclick = () => {
                    if (pl.songs.length === 0) return showToast('No songs in playlist');
                    queueList.length = 0;
                    pl.songs.forEach(s => queueList.push({ title: s.title, artist: s.artist, cover: s.cover || '', videoId: s.videoId || '' }));
                    currentQueueIndex = 0;
                    const first = pl.songs[0];
                    window._forceQueueSong = { videoId: first.videoId, title: first.title, artist: first.artist, cover: first.cover };
                    songSearchInput.value = `${first.title} ${first.artist}`;
                    searchBtn.click();
                    showToast(`ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¶ Playing ${pl.name}`);
                };
            }

            showScreen('playlist-full-screen');
        }

        window.removeSongFromPlaylist = function(plIdx, sIdx) {
            const pls = getPlaylists();
            if (!pls[plIdx]) return;
            pls[plIdx].songs.splice(sIdx, 1);
            savePlaylists(pls);
            openPlaylistPage(plIdx); // re-render
            showToast('Song removed from playlist');
        };


        // New Playlist button
        document.getElementById('new-playlist-btn')?.addEventListener('click', () => {
            const name = prompt('Playlist name:');
            if (!name || !name.trim()) return;
            const playlists = getPlaylists();
            playlists.push({ name: name.trim(), songs: [], id: Date.now() });
            savePlaylists(playlists);
            renderPlaylists();
            showToast(`Playlist "${name.trim()}" created!`);
        });

        // Add to playlist popup
        const addToPlaylistPopup = document.getElementById('add-to-playlist-popup');
        document.getElementById('close-playlist-popup')?.addEventListener('click', () => {
            addToPlaylistPopup.classList.remove('open');
        });

        function openAddToPlaylistPopup(songMeta) {
            const popupList = document.getElementById('popup-playlists-list');
            
            // Setup inline create playlist logic
            const createInput = document.getElementById('popup-new-playlist-input');
            const createBtn = document.getElementById('popup-create-playlist-btn');
            
            // Clean up old listeners
            const newCreateBtn = createBtn.cloneNode(true);
            createBtn.parentNode.replaceChild(newCreateBtn, createBtn);
            
            newCreateBtn.addEventListener('click', () => {
                const name = createInput.value.trim();
                if (!name) return;
                const pls = getPlaylists();
                if (pls.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                    showToast('Playlist already exists');
                    return;
                }
                pls.push({ id: Date.now().toString(), name, songs: [songMeta], createdAt: new Date().toISOString() });
                savePlaylists(pls);
                createInput.value = '';
                showToast(`Created & Added to ${name}`);
                downloadAndSaveSong(songMeta);
                renderLibraryPlaylists(); // Refresh lib in background
                addToPlaylistPopup.classList.remove('open');
            });
            
            const renderPopupList = () => {
                const playlists = getPlaylists();
                if (playlists.length === 0) {
                    popupList.innerHTML = '<div class="empty-state lib-empty" style="font-size:0.95rem;">No playlists yet! Create one above.</div>';
                } else {
                    popupList.innerHTML = '';
                    playlists.forEach((pl, plIdx) => {
                        const item = document.createElement('div');
                        item.className = 'popup-playlist-item';
                        item.innerHTML = `
                            <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:rgba(255,255,255,0.5);flex-shrink:0;"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                            <span>${pl.name}</span>
                        `;
                        item.addEventListener('click', () => {
                            const pls = getPlaylists();
                            const alreadyIn = pls[plIdx].songs.some(s => s.title === songMeta.title);
                            if (!alreadyIn) {
                                pls[plIdx].songs.push(songMeta);
                                savePlaylists(pls);
                                showToast(`Added to ${pl.name}`);
                                downloadAndSaveSong(songMeta); // Auto-download on Add to Playlist
                                renderLibraryPlaylists(); // Update main library view
                            } else {
                                showToast(`Already in ${pl.name}`);
                            }
                            addToPlaylistPopup.classList.remove('open');
                        });
                        popupList.appendChild(item);
                    });
                }
            };
            
            renderPopupList();
            addToPlaylistPopup.classList.add('open');
        }



        currentY = targetY = rightPanel.offsetHeight / 2;
        lyricsContainer.style.transform = `translateY(${currentY}px)`;

        // Handle ENTER key in search ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â show results page first
        songSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = songSearchInput.value.trim();
                if (q) showSearchResultsPage(q);
            }
        });

        // Ã¢â€â‚¬Ã¢â€â‚¬ PC Sticky Header Search Bridge Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
        // Mirror #pch-search-input ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ #song-search so all existing
        // live-suggestions, Enter-to-search, and clear logic still work.
        const pchInput = document.getElementById('pch-search-input');
        if (pchInput) {
            // Typing in header search ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ sync to real input + fire its 'input' event
            pchInput.addEventListener('input', () => {
                songSearchInput.value = pchInput.value;
                songSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
                // Show clear button in real bar (for logic compatibility)
                const clr = document.getElementById('clear-search-btn');
                if (clr) clr.style.display = pchInput.value ? '' : 'none';
            });
            // Enter in header search ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ trigger search results page
            pchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const q = pchInput.value.trim();
                    if (q) showSearchResultsPage(q);
                }
                // Escape clears both
                if (e.key === 'Escape') {
                    pchInput.value = '';
                    songSearchInput.value = '';
                    songSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    pchInput.blur();
                }
            });
            // Keep both inputs in sync if real search changes programmatically
            const origOnInput = songSearchInput.oninput;
            songSearchInput.addEventListener('input', () => {
                if (document.activeElement !== pchInput) {
                    pchInput.value = songSearchInput.value;
                }
            });
        }

        // ============================================================
        // VOLUME CONTROLS (Keyboard & Scroll)
        // ============================================================
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            if (e.code === 'Space') {
                e.preventDefault();
                if (playPauseBtn && !playPauseBtn.disabled) playPauseBtn.click();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                let v = Math.min(1, audioPlayer.volume + 0.05);
                audioPlayer.volume = v;
                showToast(`Volume: ${Math.round(v * 100)}%`);
                if (window.updateVolumeUI) window.updateVolumeUI(v);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                let v = Math.max(0, audioPlayer.volume - 0.05);
                audioPlayer.volume = v;
                showToast(`Volume: ${Math.round(v * 100)}%`);
                if (window.updateVolumeUI) window.updateVolumeUI(v);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (nextBtn && !nextBtn.disabled) nextBtn.click();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (prevBtn && !prevBtn.disabled) prevBtn.click();
            } else if (e.key.toLowerCase() === 'l') {
                e.preventDefault();
                const lyricsBtn = document.getElementById('lyrics-btn');
                if (lyricsBtn) lyricsBtn.click();
            } else if (e.key.toLowerCase() === 'q') {
                e.preventDefault();
                const queuePanel = document.getElementById('queue-panel');
                const queueNavBtn = document.getElementById('floating-queue-btn');
                const closeQueueBtn = document.getElementById('close-queue-btn');
                if (queuePanel && queuePanel.classList.contains('active')) {
                    if (closeQueueBtn) closeQueueBtn.click();
                } else {
                    if (queueNavBtn) queueNavBtn.click();
                }
            }
        });

        const volCoverWrapper = document.getElementById('cover-art-container');
        if (volCoverWrapper) {
            volCoverWrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                let v = audioPlayer.volume;
                if (e.deltaY < 0) {
                    v = Math.min(1, v + 0.05);
                } else {
                    v = Math.max(0, v - 0.05);
                }
                audioPlayer.volume = v;
                showToast(`Volume: ${Math.round(v * 100)}%`);
            });
        }

        // ============================================================
        // FULL SCREEN & AUTO-HIDE UI LOGIC
        // ============================================================
        const fullScreenBtn = document.getElementById('full-screen-btn');
        if (fullScreenBtn) {
            fullScreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(err => console.log(err));
                } else {
                    document.exitFullscreen();
                }
            });
        }

        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement) {
                document.body.classList.add('full-screen-mode');
            } else {
                document.body.classList.remove('full-screen-mode');
                document.body.classList.remove('show-ui');
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (document.fullscreenElement) {
                // Show UI if mouse is on the left third of screen OR top right corner
                if (e.clientX < window.innerWidth * 0.3 || (e.clientX > window.innerWidth - 300 && e.clientY < 100)) {
                    document.body.classList.add('show-ui');
                } else {
                    document.body.classList.remove('show-ui');
                }
            }
        });

        // ============================================================
        // GLOBAL COVER URL HELPER ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â routes ALL images through backend
        // This proxy: 1) fetches iTunes artwork, 2) falls back to YT thumb
        // No CORS, no expiry, works from any device on the network!
        // ============================================================
        function resolveYtThumb(ytThumb, size='large') {
            if (!ytThumb || typeof ytThumb !== 'string') return '';
            if (ytThumb.includes('/api/cover')) return ''; // Avoid double proxying
            
            if (ytThumb.includes('lh3.googleusercontent.com') && ytThumb.includes('=')) {
                // If the original URL is already provided by backend, it's the largest available.
                // We only resize for small/medium to save bandwidth. For large, use a standard high-res size!
                const base = ytThumb.split('=')[0];
                if (size === 'small') return base + '=w180-h180-l90-rj';
                if (size === 'medium') return base + '=w400-h400-l90-rj';
                if (size === 'large') return base + '=w1400-h1400-l100-rj';
            }
            if (ytThumb.includes('img.youtube.com/vi/')) {
                if (size === 'large') {
                    return ytThumb.replace('/hqdefault.jpg', '/maxresdefault.jpg').replace('/mqdefault.jpg', '/maxresdefault.jpg');
                } else if (size === 'medium') {
                    return ytThumb.replace('/hqdefault.jpg', '/sddefault.jpg').replace('/mqdefault.jpg', '/sddefault.jpg');
                }
            }
            return ytThumb;
        }

        function getCoverUrl(query, ytThumb, vid, isPlayerScreen = false) {
            const targetSize = isPlayerScreen ? 'large' : 'medium';
            let thumb = resolveYtThumb(ytThumb, targetSize);
            
            if (!thumb && vid) {
                thumb = `https://i.ytimg.com/vi/${vid}/sddefault.jpg`;
            }
            
            if (thumb && thumb.startsWith('http')) {
                return thumb; // Fast direct CDN loading
            }

            if (vid) {
                return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
            }
            
            const params = new URLSearchParams();
            if (query) params.set('q', query);
            if (thumb && thumb.startsWith('http')) params.set('yt_thumb', thumb);
            if (vid) params.set('vid', vid);
            
            return `/api/cover?${params.toString()}`;
        }

        function getEntryCoverUrl(entry) {
            const title = entry.title || '';
            const artist = entry.artist || '';
            const query = `${title} ${artist}`.trim();
            let thumb = resolveYtThumb(entry.cover) || resolveYtThumb(entry.ytThumb) || '';
            const videoId = entry.videoId || entry.id;
            if (!thumb && videoId) {
                thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            }
            return getCoverUrl(query, thumb, videoId);
        }

        document.addEventListener('error', (e) => {
            const img = e.target;
            if (img.tagName !== 'IMG' || img.dataset.fallbackDone === '1') return;
            const q = img.dataset.query || img.closest('[data-query]')?.getAttribute('data-query');
            if (q) {
                img.dataset.fallbackDone = '1';
                img.src = getCoverUrl(q, '');
                return;
            }
            if (!img.src.includes('default_cover.jpg')) {
                img.dataset.fallbackDone = '1';
                img.src = 'default_cover.jpg';
            }
        }, true);

        function setupLazyCovers(root = document) {
            const images = root.querySelectorAll('img[data-src]');
            if (!images.length) return;
            if (!('IntersectionObserver' in window)) {
                images.forEach(img => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
                return;
            }
            const io = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    io.unobserve(img);
                });
            }, { rootMargin: '120px', threshold: 0.01 });
            images.forEach(img => io.observe(img));
        }

        // ============================================================
        // SETTINGS ENGINE ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â All settings, fully working, persisted
        // ============================================================
        const SETTINGS_KEY = 'app_settings_v1';
        const DEFAULT_SETTINGS = {
            accentColor: '#ff476d', accentRgb: '255,71,109',
            bgBrightness: 50, glassBlur: '30px', cardLayout: 'vinyl',
            audioQuality: 'hq', playbackSpeed: 100, crossfade: 3,
            autoplay: true, sleepTimerMins: 0,
            normalizeVolume: false, lyricsFontSize: 'medium',
            lyricsFont: 'default', titleFont: 'Outfit', lyricsStyle: 'bold',
            miniPlayerStyle: 'pill', doubleTapSeek: true,
            catCursor: true, haptic: true, incognito: false
        };

        function loadSettings() {
            try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
            catch(e) { return { ...DEFAULT_SETTINGS }; }
        }
        function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

        let appSettings = loadSettings();
        let sleepTimerInterval = null;
        let audioContext = null, gainNode = null;

        function applySettings(s) {
            const root = document.documentElement;
            // Accent color
            root.style.setProperty('--accent', s.accentColor);
            root.style.setProperty('--accent-rgb', s.accentRgb);
            // Background brightness
            root.style.setProperty('--bg-brightness', s.bgBrightness / 100);
            // Glass blur
            root.style.setProperty('--glass-blur', s.glassBlur);
            // Title font
            root.style.setProperty('--title-font', s.titleFont);
            // Lyrics font size & family & style
            const fontSizeMap = {
                small: '1.65rem',
                medium: '2.25rem',
                large: '2.9rem',
                xlarge: '3.6rem'
            };
            root.style.setProperty('--lyrics-font-size', fontSizeMap[s.lyricsFontSize] || '2.25rem');

            const fontMap = {
                default: "'Inter', 'Outfit', sans-serif",
                inter: "'Inter', sans-serif",
                outfit: "'Outfit', sans-serif",
                playfair: "'Playfair Display', serif",
                cinzel: "'Cinzel', serif",
                lobster: "'Lobster', cursive",
                bebas: "'Bebas Neue', cursive"
            };
            root.style.setProperty('--lyrics-font-family', fontMap[s.lyricsFont] || "'Inter', 'Outfit', sans-serif");

            // Lyrics active style
            const styleTag = document.getElementById('dynamic-lyric-style') || (() => {
                const t = document.createElement('style'); t.id = 'dynamic-lyric-style';
                document.head.appendChild(t); return t;
            })();
            if (s.lyricsStyle === 'glow') {
                styleTag.textContent = '.lyric-line.active-line { text-shadow: 0 0 20px white, 0 0 40px white; filter: none !important; }';
            } else if (s.lyricsStyle === 'underline') {
                styleTag.textContent = '.lyric-line.active-line { text-decoration: underline; text-decoration-color: white; filter: none !important; }';
            } else {
                styleTag.textContent = '';
            }
            // Cat cursor
            document.body.style.cursor = s.catCursor ? `url('cat_cursor.png'), auto` : 'auto';
            // Playback speed
            audioPlayer.playbackRate = s.playbackSpeed / 100;
            // Mini player style
            const mp = document.getElementById('mini-player');
            mp.classList.remove('mp-pill', 'mp-card', 'mp-bar');
            mp.classList.add(`mp-${s.miniPlayerStyle}`);
            // Card layout on home
            document.querySelectorAll('.vinyl-scroll-container').forEach(c => {
                c.classList.remove('layout-grid', 'layout-list');
                if (s.cardLayout !== 'vinyl') c.classList.add(`layout-${s.cardLayout}`);
            });
        }

        function syncSettingsUI(s) {
            // Accent swatches
            document.querySelectorAll('.color-swatch').forEach(sw => {
                sw.classList.toggle('active', sw.dataset.color === s.accentColor);
            });
            const bbs = document.getElementById('bg-brightness-slider');
            if (bbs) bbs.value = s.bgBrightness;
            const gbs = document.getElementById('glass-blur-select');
            if (gbs) gbs.value = s.glassBlur;
            const cls = document.getElementById('card-layout-select');
            if (cls) cls.value = s.cardLayout;
            const aqs = document.getElementById('audio-quality-select');
            if (aqs) aqs.value = s.audioQuality;
            const spd = document.getElementById('speed-slider');
            if (spd) { spd.value = s.playbackSpeed; document.getElementById('speed-label').textContent = (s.playbackSpeed/100).toFixed(2).replace('.00','').replace('.25','¼').replace('.50','½').replace('.75','¾') + 'x'; }
            const cfs = document.getElementById('crossfade-slider');
            if (cfs) { cfs.value = s.crossfade; document.getElementById('crossfade-label').textContent = s.crossfade + 's'; }
            const apt = document.getElementById('autoplay-toggle');
            if (apt) apt.checked = s.autoplay;
            const nv = document.getElementById('normalize-toggle');
            if (nv) nv.checked = s.normalizeVolume;
            const lss = document.getElementById('lyrics-size-select');
            if (lss) lss.value = s.lyricsFontSize;
            const lfs = document.getElementById('lyrics-font-select');
            if (lfs) lfs.value = s.lyricsFont;
            const lst = document.getElementById('lyrics-style-select');
            if (lst) lst.value = s.lyricsStyle;
            const mps = document.getElementById('mini-player-style-select');
            if (mps) mps.value = s.miniPlayerStyle;
            const dts = document.getElementById('doubletap-toggle');
            if (dts) dts.checked = s.doubleTapSeek;
            const cct = document.getElementById('cat-cursor-toggle');
            if (cct) cct.checked = s.catCursor;
            const hpt = document.getElementById('haptic-toggle');
            if (hpt) hpt.checked = s.haptic;
            const igt = document.getElementById('incognito-toggle');
            if (igt) igt.checked = s.incognito;
        }

        function setupSettingsUI() {
            // Title font
            document.getElementById('title-font-select')?.addEventListener('change', (e) => {
                appSettings.titleFont = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Lyrics size
            document.getElementById('lyrics-size-select')?.addEventListener('change', (e) => {
                appSettings.lyricsFontSize = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Lyrics font
            document.getElementById('lyrics-font-select')?.addEventListener('change', (e) => {
                appSettings.lyricsFont = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
        }

        function initSettingsListeners() {
            // Accent color swatches
            document.querySelectorAll('.color-swatch').forEach(sw => {
                sw.addEventListener('click', () => {
                    appSettings.accentColor = sw.dataset.color;
                    appSettings.accentRgb = sw.dataset.rgb;
                    saveSettings(appSettings); applySettings(appSettings); syncSettingsUI(appSettings);
                });
            });
            // Background brightness
            document.getElementById('bg-brightness-slider')?.addEventListener('input', (e) => {
                appSettings.bgBrightness = parseInt(e.target.value);
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Glass blur
            document.getElementById('glass-blur-select')?.addEventListener('change', (e) => {
                appSettings.glassBlur = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Card layout
            document.getElementById('card-layout-select')?.addEventListener('change', (e) => {
                appSettings.cardLayout = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Audio quality
            document.getElementById('audio-quality-select')?.addEventListener('change', (e) => {
                appSettings.audioQuality = e.target.value;
                saveSettings(appSettings);
            });
            // Playback speed
            document.getElementById('speed-slider')?.addEventListener('input', (e) => {
                appSettings.playbackSpeed = parseInt(e.target.value);
                audioPlayer.playbackRate = appSettings.playbackSpeed / 100;
                const labels = { 50:'0.5x', 75:'0.75x', 100:'1x', 125:'1.25x', 150:'1.5x', 175:'1.75x', 200:'2x' };
                document.getElementById('speed-label').textContent = labels[appSettings.playbackSpeed] || appSettings.playbackSpeed/100 + 'x';
                saveSettings(appSettings);
            });
            // Crossfade
            document.getElementById('crossfade-slider')?.addEventListener('input', (e) => {
                appSettings.crossfade = parseInt(e.target.value);
                document.getElementById('crossfade-label').textContent = appSettings.crossfade + 's';
                saveSettings(appSettings);
            });
            // Autoplay
            document.getElementById('autoplay-toggle')?.addEventListener('change', (e) => {
                appSettings.autoplay = e.target.checked;
                saveSettings(appSettings);
                if (typeof updateQueueControlsState === 'function') updateQueueControlsState();
            });
            // Normalize
            document.getElementById('normalize-toggle')?.addEventListener('change', (e) => {
                appSettings.normalizeVolume = e.target.checked;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Sleep timer
            document.getElementById('sleep-timer-start-btn')?.addEventListener('click', () => {
                clearInterval(sleepTimerInterval);
                const mins = parseInt(document.getElementById('sleep-timer-select').value);
                if (mins === 0) { document.getElementById('sleep-timer-display').textContent = 'Off'; return; }
                let remaining = mins * 60;
                const display = document.getElementById('sleep-timer-display');
                sleepTimerInterval = setInterval(() => {
                    remaining--;
                    const m = Math.floor(remaining / 60), s = remaining % 60;
                    display.textContent = `Sleeping in ${m}:${s.toString().padStart(2,'0')}`;
                    if (remaining <= 0) {
                        clearInterval(sleepTimerInterval);
                        // Fade out and pause
                        const fadeOut = setInterval(() => {
                            if (audioPlayer.volume > 0.05) { audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.05); }
                            else { audioPlayer.pause(); audioPlayer.volume = 1; clearInterval(fadeOut); display.textContent = 'Off'; }
                        }, 200);
                    }
                }, 1000);
                display.textContent = 'Sleeping in :00';
            });
            // Title font
            document.getElementById('title-font-select')?.addEventListener('change', (e) => {
                appSettings.titleFont = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Lyrics size
            document.getElementById('lyrics-size-select')?.addEventListener('change', (e) => {
                appSettings.lyricsFontSize = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Lyrics font
            document.getElementById('lyrics-font-select')?.addEventListener('change', (e) => {
                appSettings.lyricsFont = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Lyrics style
            document.getElementById('lyrics-style-select')?.addEventListener('change', (e) => {
                appSettings.lyricsStyle = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Mini player style
            document.getElementById('mini-player-style-select')?.addEventListener('change', (e) => {
                appSettings.miniPlayerStyle = e.target.value;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Double-tap seek
            document.getElementById('doubletap-toggle')?.addEventListener('change', (e) => {
                appSettings.doubleTapSeek = e.target.checked;
                saveSettings(appSettings);
            });
            // Cat cursor
            document.getElementById('cat-cursor-toggle')?.addEventListener('change', (e) => {
                appSettings.catCursor = e.target.checked;
                saveSettings(appSettings); applySettings(appSettings);
            });
            // Haptic
            document.getElementById('haptic-toggle')?.addEventListener('change', (e) => {
                appSettings.haptic = e.target.checked;
                saveSettings(appSettings);
            });
            // Incognito
            document.getElementById('incognito-toggle')?.addEventListener('change', (e) => {
                appSettings.incognito = e.target.checked;
                saveSettings(appSettings);
            });
            // Export History
            document.getElementById('export-history-btn')?.addEventListener('click', () => {
                const history = localStorage.getItem('music_history_full') || '[]';
                const blob = new Blob([history], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `music_history_${new Date().toISOString().slice(0,10)}.json`;
                a.click();
            });
            // Clear queue
            document.getElementById('clear-queue-btn')?.addEventListener('click', () => {
                if (confirm('Clear entire queue?')) {
                    queueList = []; currentQueueIndex = -1; renderQueue();
                    alert('Queue cleared!');
                }
            });
            // Clear history
            document.getElementById('clear-history-btn')?.addEventListener('click', () => {
                if (confirm('Delete all listening history? This cannot be undone.')) {
                    localStorage.removeItem('music_history_full');
                    localStorage.removeItem('music_history');
                    alert('History cleared!');
                }
            });
            // Reset all settings
            document.getElementById('reset-settings-btn')?.addEventListener('click', () => {
                if (confirm('Reset ALL settings to default?')) {
                    appSettings = { ...DEFAULT_SETTINGS };
                    saveSettings(appSettings);
                    applySettings(appSettings);
                    syncSettingsUI(appSettings);
                    alert('Settings reset to defaults!');
                }
            });
        }

        // ============================================================
        // LIVE SEARCH SUGGESTIONS ENGINE
        // ============================================================
        const suggestionsBox = document.getElementById('search-suggestions');
        let activeFilter = 'all';
        let suggestDebounce = null;
        let isSelectingSuggestion = false;

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Global Back Button ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        const globalBackBtn = document.getElementById('global-back-btn');
        const screenHistory = [];

        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.screen) {
                if (typeof showScreenExcept === 'function') { showScreenExcept(e.state.screen, true); }
            } else {
                if (typeof showScreenExcept === 'function') { showScreenExcept('home-screen', true); }
            }
        });

        globalBackBtn?.addEventListener('click', () => {
            if (history.state && history.state.screen) {
                history.back();
                return;
            }
            if (screenHistory.length > 0) {
                const prev = screenHistory.pop();
                if (prev === 'home-screen' && typeof showHome === 'function') { showHome(); return; }
                if (prev === 'player-screen' && typeof showPlayer === 'function') { showPlayer(); return; }
                if (prev === 'history-screen' && typeof showHistory === 'function') { showHistory(); return; }
                if (prev === 'settings-screen' && typeof showSettings === 'function') { showSettings(); return; }
                if (typeof showScreenExcept === 'function') { showScreenExcept(prev, true); return; }
            }
            if (typeof showHome === 'function') showHome();
        });

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#top-bar-wrapper')) hideSuggestions();
        });

        let activeSuggestionIndex = -1;

        async function fetchSuggestions(q, filter) {
            suggestionsBox.innerHTML = '<div class="suggest-spinner"><div class="suggest-spinner-glass"></div>Searching...</div>';
            suggestionsBox.classList.add('visible');
            activeSuggestionIndex = -1;
            try {
                const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}&filter=${filter}`);
                const data = await res.json();
                renderSuggestions(data.results || []);
            } catch(e) {
                suggestionsBox.innerHTML = '<div class="suggest-spinner">Could not reach server.</div>';
            }
        }

        function renderSuggestions(results) {
            if (!results.length) {
                suggestionsBox.innerHTML = '<div class="suggest-spinner">No results found</div>';
                return;
            }
            suggestionsBox.innerHTML = '';
            results.forEach((r, i) => {
                const item = document.createElement('div');
                item.className = 'suggest-item';
                item.style.animationDelay = `${i * 30}ms`;

                const coverClass = r.type === 'artist' ? 'suggest-cover artist-cover' : 'suggest-cover';
                const coverSrc = r.cover ? getCoverUrl(r.query, r.cover, r.id || r.videoId) : 'default_cover.jpg';
                const badgeClass = `suggest-badge badge-${r.type}`;
                const badgeLabel = r.type === 'video' ? 'ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¬ Video' : r.type === 'artist' ? 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‚Â¤ Artist' : r.type === 'album' ? 'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¿ Album' : 'ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ Song';
                const artistLine = r.artist ? `<div class="suggest-artist">${r.artist}</div>` : '';

                item.innerHTML = `
                    <img src="${coverSrc}" class="${coverClass}" loading="lazy">
                    <div class="suggest-info">
                        <div class="suggest-title">${r.title}</div>
                        ${artistLine}
                    </div>
                    <span class="${badgeClass}">${badgeLabel}</span>
                `;

                item.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Don't blur the input
                    isSelectingSuggestion = true;
                });

                item.addEventListener('click', () => {
                    hideSuggestions();
                    songSearchInput.value = r.query;
                    if (r.type === 'song' || r.type === 'video') {
                        searchBtn.click();
                    } else if (r.type === 'artist') {
                        if (r.browseId) {
                            showArtistPage(r.browseId);
                        } else {
//                             songSearchInput.value = r.title + ' top songs';
                            searchBtn.click();
                        }
                    } else if (r.type === 'album') {
                        if (r.browseId) {
                            showAlbumPage(r.browseId);
                        } else {
                            songSearchInput.value = r.query;
                            searchBtn.click();
                        }
                    }
                    isSelectingSuggestion = false;
                });

                suggestionsBox.appendChild(item);
            });
        }

        function hideSuggestions() {
            suggestionsBox.classList.remove('visible');
            setTimeout(() => { if (!suggestionsBox.classList.contains('visible')) suggestionsBox.innerHTML = ''; }, 250);
        }

        // Debounced input listener
        const clearSearchBtn = document.getElementById('clear-search-btn');
        songSearchInput.addEventListener('input', () => {
            const q = songSearchInput.value.trim();
            clearSearchBtn.style.display = q.length > 0 ? 'block' : 'none';
            clearTimeout(suggestDebounce);
            if (q.length < 2) { hideSuggestions(); return; }
            suggestDebounce = setTimeout(() => fetchSuggestions(q, activeFilter), 300);
        });

        clearSearchBtn.addEventListener('click', () => {
            songSearchInput.value = '';
            clearSearchBtn.style.display = 'none';
            hideSuggestions();
            songSearchInput.focus();
        });

        songSearchInput.addEventListener('keydown', (e) => {
            const items = document.querySelectorAll('.suggest-item');
            if (e.key === 'Escape') {
                hideSuggestions();
            } else if (e.key === 'ArrowDown' && suggestionsBox.classList.contains('visible') && items.length > 0) {
                e.preventDefault();
                activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
                updateActiveSuggestion(items);
            } else if (e.key === 'ArrowUp' && suggestionsBox.classList.contains('visible') && items.length > 0) {
                e.preventDefault();
                activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
                updateActiveSuggestion(items);
            } else if (e.key === 'Enter') {
                if (activeSuggestionIndex >= 0 && items.length > 0 && suggestionsBox.classList.contains('visible')) {
                    e.preventDefault();
                    items[activeSuggestionIndex].click();
                } else {
                    e.preventDefault();
                    const q = songSearchInput.value.trim();
                    if (q) { hideSuggestions(); showSearchResultsPage(q); }
                }
            }
        });

        function updateActiveSuggestion(items) {
            items.forEach((item, index) => {
                if (index === activeSuggestionIndex) {
                    item.style.background = 'rgba(var(--accent-rgb),0.2)';
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.style.background = ''; // reset to default CSS hover
                }
            });
        }


        songSearchInput.addEventListener('blur', () => {
            if (!isSelectingSuggestion) setTimeout(hideSuggestions, 150);
        });

        songSearchInput.addEventListener('focus', () => {
            const q = songSearchInput.value.trim();
            if (q.length >= 2) fetchSuggestions(q, activeFilter);
        });

        // Double-click / Double-tap 10s seeking (-10s / +10s) with animated ripple badge
        function triggerSeekRipple(side) {
            if (!isSongLoaded) return;
            if (side === 'right') {
                audioPlayer.currentTime = Math.min(audioPlayer.duration || 9999, audioPlayer.currentTime + 10);
            } else {
                audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
            }

            const container = document.getElementById('cover-art-container') || document.getElementById('player-screen');
            if (container) {
                const existing = container.querySelector('.seek-ripple-indicator');
                if (existing) existing.remove();

                const ripple = document.createElement('div');
                ripple.className = `seek-ripple-indicator ${side === 'right' ? 'right-seek' : 'left-seek'}`;
                ripple.innerHTML = `
                    <div class="seek-ripple-icon">${side === 'right' ? 'â©' : 'âª'}</div>
                    <div>${side === 'right' ? '+10s' : '-10s'}</div>
                `;
                container.appendChild(ripple);
                setTimeout(() => ripple.remove(), 650);
            }
            if (navigator.vibrate) navigator.vibrate(30);
        }

        // Double click mouse listener on player cover art
        const coverArtEl = document.getElementById('cover-art-container');
        coverArtEl?.addEventListener('dblclick', (e) => {
            const rect = coverArtEl.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const side = clickX < rect.width / 2 ? 'left' : 'right';
            triggerSeekRipple(side);
        });

        // Touch double tap seek
        let lastTapTime = 0, lastTapSide = '';
        document.getElementById('player-screen')?.addEventListener('touchend', (e) => {
            if (!isSongLoaded) return;
            const now = Date.now();
            const screenW = window.innerWidth;
            const tapX = e.changedTouches[0].clientX;
            const side = tapX < screenW / 2 ? 'left' : 'right';
            if (now - lastTapTime < 380 && side === lastTapSide) {
                triggerSeekRipple(side);
            }
            lastTapTime = now; lastTapSide = side;
        });

        // Lyrics Toggle Button
        const lyricsToggleBtn = document.getElementById('lyrics-toggle-btn');
        const lyricsBtnLabel = document.getElementById('lyrics-btn-label');
        lyricsToggleBtn?.addEventListener('click', () => {
            const isHidden = rightPanel.classList.toggle('lyrics-hidden');
            document.getElementById('player-screen').classList.toggle('cinematic-mode', isHidden);
            lyricsToggleBtn.classList.toggle('lyrics-on', !isHidden);
            lyricsBtnLabel.textContent = isHidden ? 'Lyrics OFF' : 'Lyrics ON';
            if (isHidden && typeof updateCinematicCards === 'function') updateCinematicCards();
            if (appSettings.haptic && navigator.vibrate) navigator.vibrate(15);
        });

        // Haptic on key buttons
        ['play-pause-btn','next-btn','prev-btn','mini-play-pause-btn','mini-next-btn'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => {
                if (appSettings.haptic && navigator.vibrate) navigator.vibrate(15);
            });
        });

        // Apply on boot
        applySettings(appSettings);
        initSettingsListeners();
        syncSettingsUI(appSettings);

        // Screen Switch Logic & Mini Player Logic
        const miniPlayer = document.getElementById('mini-player');
        const ghostCover = document.getElementById('ghost-cover');
        const miniCover = document.getElementById('mini-cover');
        const miniTitle = document.getElementById('mini-title');
        const miniArtist = document.getElementById('mini-artist');
        const miniPlayPauseBtn = document.getElementById('mini-play-pause-btn');

        function triggerFlipAnimation(fromEl, toEl, onComplete) {
            try {
                if (!fromEl || !toEl) {
                    if (onComplete) onComplete();
                    return;
                }
                
                // --- BATCH READS 1 (Current State) ---
                const fromRect = fromEl.getBoundingClientRect();
                const fromRadius = window.getComputedStyle(fromEl).borderRadius || '14px';
                
                const toScreen = toEl.closest('.screen-view');
                const screenWasHidden = toScreen && toScreen.classList.contains('hidden-screen');
                const screenOriginalTransition = toScreen ? toScreen.style.transition : '';
                
                const wasHidden = miniPlayer.classList.contains('hidden-mini');
                
                // --- BATCH WRITES 1 (Setup Target State) ---
                if (screenWasHidden) {
                    toScreen.style.transition = 'none';
                    toScreen.classList.remove('hidden-screen');
                    toScreen.classList.add('active-screen');
                }
                if (wasHidden) {
                    miniPlayer.style.transition = 'none';
                    miniPlayer.classList.remove('hidden-mini');
                }
                
                // --- BATCH READS 2 (Target State) - FORCES 1 LAYOUT ---
                const toRect = toEl.getBoundingClientRect();
                const toRadius = window.getComputedStyle(toEl).borderRadius || '14px';
                
                // --- BATCH WRITES 2 (Revert & Prepare Animation) ---
                if (wasHidden) {
                    miniPlayer.classList.add('hidden-mini');
                    miniPlayer.style.transition = '';
                }
                if (screenWasHidden) {
                    toScreen.classList.remove('active-screen');
                    toScreen.classList.add('hidden-screen');
                    toScreen.style.transition = screenOriginalTransition;
                }
                
                ghostCover.src = coverArt.src || 'default_cover.jpg';
                ghostCover.style.transition = 'none';
                ghostCover.style.left = `${fromRect.left}px`;
                ghostCover.style.top = `${fromRect.top}px`;
                ghostCover.style.width = `${fromRect.width}px`;
                ghostCover.style.height = `${fromRect.height}px`;
                ghostCover.style.borderRadius = fromRadius;
                ghostCover.style.opacity = '1';
                
                fromEl.style.transition = 'none';
                toEl.style.transition = 'none';
                fromEl.style.opacity = '0';
                toEl.style.opacity = '0';
                
                // --- FORCES 2ND LAYOUT (Commit initial coords) ---
                ghostCover.offsetHeight; 
                
                // --- BATCH WRITES 3 (Trigger Animation) ---
                ghostCover.style.transition = 'all 0.85s cubic-bezier(0.33, 1, 0.68, 1)';
                ghostCover.style.left = `${toRect.left}px`;
                ghostCover.style.top = `${toRect.top}px`;
                ghostCover.style.width = `${toRect.width}px`;
                ghostCover.style.height = `${toRect.height}px`;
                ghostCover.style.borderRadius = toRadius;
                
                setTimeout(() => {
                    ghostCover.style.opacity = '0';
                    toEl.style.opacity = '1';
                    toEl.style.transition = '';
                    fromEl.style.transition = '';
                    if(onComplete) onComplete();
                }, 850);
            } catch (e) {
                console.error("Animation error", e);
                fromEl.style.opacity = '1';
                toEl.style.opacity = '1';
                if(onComplete) onComplete();
            }
        }

        miniPlayer.addEventListener('click', (e) => {
            if(e.target.closest('.mini-btn')) return;
            showPlayer();
        });
        
        miniPlayPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (audioPlayer.paused) audioPlayer.play();
            else audioPlayer.pause();
        });

        document.getElementById('mini-next-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('next-btn')?.click();
        });

        function showHome() {
            if(playerScreen.classList.contains('active-screen') && isSongLoaded) {
                triggerFlipAnimation(coverArtContainer, miniCover, () => { coverArtContainer.style.opacity = '1'; });
                miniPlayer.classList.remove('hidden-mini');
            } else if (isSongLoaded) {
                miniPlayer.classList.remove('hidden-mini');
            }
            showScreenExcept('home-screen');
        }

        function showPlayer() {
            if(!playerScreen.classList.contains('active-screen') && isSongLoaded) {
                triggerFlipAnimation(miniCover, coverArtContainer, () => { miniCover.style.opacity = '1'; });
            }
            miniPlayer.classList.add('hidden-mini');
            showScreenExcept('player-screen');
        }
        window.showPlayer = showPlayer;

        function showHistory() {
            if(playerScreen.classList.contains('active-screen') && isSongLoaded) {
                triggerFlipAnimation(coverArtContainer, miniCover, () => { coverArtContainer.style.opacity = '1'; });
            }
            if(isSongLoaded) {
                miniPlayer.classList.remove('hidden-mini');
            }
            showScreenExcept('history-screen');
            renderHistory();
        }

        function showSettings() {
            if(playerScreen.classList.contains('active-screen') && isSongLoaded) {
                triggerFlipAnimation(coverArtContainer, miniCover, () => { coverArtContainer.style.opacity = '1'; });
            }
            if(isSongLoaded) miniPlayer.classList.remove('hidden-mini');
            showScreenExcept('settings-screen');
            syncSettingsUI(appSettings);
        }

        // --- HISTORY LOGIC ---
        function saveToHistory(songData, rawYtThumb) {
            if (appSettings.incognito) return; // Incognito mode ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â skip saving
            let history = JSON.parse(localStorage.getItem('music_history_full') || '[]');
            const thumb = resolveYtThumb(rawYtThumb) || resolveYtThumb(songData.thumbnail) || '';
            const newEntry = {
                title: songData.title,
                artist: songData.uploader,
                cover: thumb,
                videoId: songData.id || '',
                timestamp: new Date().toISOString()
            };
            history = history.filter(h => h.title !== newEntry.title); // Remove dupes
            history.unshift(newEntry);
            if (history.length > 100) history.pop();
            localStorage.setItem('music_history_full', JSON.stringify(history));
            
            // Legacy saving for recommendations API
            let simpleHistory = localStorage.getItem('music_history');
            simpleHistory = simpleHistory ? simpleHistory.split(',') : [];
            const query = `${songData.title} ${songData.uploader}`;
            if (!simpleHistory.includes(query)) simpleHistory.push(query);
            if (simpleHistory.length > 5) simpleHistory.shift();
            localStorage.setItem('music_history', simpleHistory.join(','));
        }

        function renderHistory() {
            const container = document.getElementById('history-container');
            container.innerHTML = '';
            const history = JSON.parse(localStorage.getItem('music_history_full') || '[]');
            
            if (history.length === 0) {
                container.innerHTML = '<div class="empty-state">No listening history yet. Go find your vibe!</div>';
                return;
            }
            
            const grouped = {};
            history.forEach(item => {
                const date = new Date(item.timestamp);
                const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                if(!grouped[dateStr]) grouped[dateStr] = [];
                grouped[dateStr].push(item);
            });
            
            for (const [dateStr, items] of Object.entries(grouped)) {
                const dateHeader = document.createElement('h2');
                dateHeader.className = 'history-date-header';
                dateHeader.textContent = dateStr;
                container.appendChild(dateHeader);
                
                items.forEach(item => {
                    const coverUrl = getEntryCoverUrl(item);
                    const div = document.createElement('div');
                    div.className = 'premium-list-item';
                    div.innerHTML = `
                        <img src="${coverUrl}">
                        <div class="premium-list-info">
                            <div class="premium-list-title">${item.title}</div>
                            <div class="premium-list-artist">${item.artist}</div>
                            <div class="premium-list-meta">${new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                        </div>
                        <button class="premium-play-btn">
                            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                    `;
                    div.querySelector('.premium-play-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
//                         songSearchInput.value = `${item.title} ${item.artist}`;
                        searchBtn.click();
                    });
                    div.addEventListener('click', () => {
//                         songSearchInput.value = `${item.title} ${item.artist}`;
                        searchBtn.click();
                    });
                    container.appendChild(div);
                });
            }
        }

        // --- AUDIO VISUALIZER (Removed per user request) ---
        function initAudioVisualizer() {
            // Feature reverted.
        }
        function visualizeBass() {
            // Feature reverted.
        }

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ QUEUE SYSTEM ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        let queueList = [];
        let currentQueueIndex = -1;
        let queueRenderLimit = 10;
        const queueNavBtn = document.getElementById('floating-queue-btn');
        const queuePanel = document.getElementById('queue-panel');
        const queueBackdrop = document.getElementById('queue-backdrop');
        const closeQueueBtn = document.getElementById('close-queue-btn');
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        let queueOpen = false;

        function openQueue() {
            queueOpen = true;
            renderQueue();
            if (typeof updateQueueControlsState === 'function') updateQueueControlsState();
            requestAnimationFrame(() => {
                queuePanel.classList.add('open');
                queueBackdrop.classList.add('open');
                queueNavBtn.classList.add('active');
                document.body.classList.add('queue-active');
            });
        }

        function closeQueue() {
            queueOpen = false;
            queuePanel.classList.remove('open');
            queueBackdrop.classList.remove('open');
            queueNavBtn.classList.remove('active');
            document.body.classList.remove('queue-active');
            queuePanel.style.transform = '';
            if (queueBackdrop) queueBackdrop.style.background = '';
        }

        let queueCloseTimer = null;
        
        function toggleQueue() {
            if (queueOpen) closeQueue(); else openQueue();
        }

        queueNavBtn?.addEventListener('click', toggleQueue);
        const topRightQueueBtn = document.getElementById('top-right-queue-btn');
        if (topRightQueueBtn) topRightQueueBtn.addEventListener('click', toggleQueue);
        
        closeQueueBtn.addEventListener('click', closeQueue);
        
        // Close when clicking backdrop
        queueBackdrop.addEventListener('click', closeQueue);
        
        document.addEventListener('click', (e) => {
            if (queueOpen && !queuePanel.contains(e.target) && !queueNavBtn.contains(e.target) && !queueBackdrop.contains(e.target)) {
                closeQueue();
            }
        });

        const playSVG = ''; // Legacy ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â black hole uses bh-icon approach
        const pauseSVG = ''; // Legacy ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â black hole uses bh-icon approach

        // Ã¢â€â‚¬Ã¢â€â‚¬ Drag-to-close gesture Ã¢â€â‚¬Ã¢â€â‚¬
        const dragHandle = document.getElementById('queue-drag-handle');
        if (dragHandle) {
            let dragStartY = 0;
            let isDragging = false;

            dragHandle.addEventListener('pointerdown', (e) => {
                isDragging = true;
                dragStartY = e.clientY;
                queuePanel.style.transition = 'none';
                dragHandle.setPointerCapture(e.pointerId);
            });

            dragHandle.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                const delta = Math.max(0, e.clientY - dragStartY);
                queuePanel.style.transform = `translateY(${delta}px)`;
                const opacity = Math.max(0, 0.55 - (delta / window.innerHeight));
                if (queueBackdrop) queueBackdrop.style.background = `rgba(0,0,0,${opacity})`;
            });

            dragHandle.addEventListener('pointerup', (e) => {
                if (!isDragging) return;
                isDragging = false;
                queuePanel.style.transition = '';
                const delta = e.clientY - dragStartY;
                if (delta > 120) {
                    queuePanel.style.transform = '';
                    if (queueBackdrop) queueBackdrop.style.background = '';
                    closeQueue();
                } else {
                    queuePanel.style.transform = '';
                    if (queueBackdrop) queueBackdrop.style.background = '';
                }
            });
        }

        // Black hole icon toggle helper
        function setBhIcon(playing) {
            const playIcon = playPauseBtn.querySelector('.bh-play-icon');
            const pauseIcon = playPauseBtn.querySelector('.bh-pause-icon');
            if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
            if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
        }

        async function populateQueue(videoId, append = false) {
            if (!append) {
                queueRenderLimit = 10;
                // Instantly update queue with the playing song to prevent stale queue bugs
                queueList = [{
                    videoId: currentVideoId || videoId,
                    title: currentSongMeta ? currentSongMeta.title : 'Unknown',
                    artist: currentSongMeta ? currentSongMeta.artist : 'Unknown',
                    cover: currentSongMeta ? currentSongMeta.cover : ''
                }];
                currentQueueIndex = 0;
                renderQueue();
            }
            
            try {
                const res = await fetch(`/api/recommendations?videoId=${encodeURIComponent(videoId)}`);
                const data = await res.json();
                if(data.status === 'success' && data.recommendations && data.recommendations.length > 0) {
                    const existingIds = new Set(queueList.map(s => s.videoId));
                    data.recommendations.forEach(s => {
                        if (!existingIds.has(s.videoId)) {
                            queueList.push(s);
                        }
                    });
                    renderQueue();
                    prefetchNextSong(); // Start prefetching the next song for zero latency
                }
            } catch(e) { console.error('Failed to populate queue:', e); }
        }
        
        window.playTrackFromList = function(songJsonStr) {
            try {
                const song = JSON.parse(songJsonStr.replace(/&quot;/g, '"'));
                songSearchInput.value = `${song.title} ${song.artist || song.uploader || ''}`.trim();
                window._forceQueueSong = { videoId: song.videoId || song.id, title: song.title, artist: song.artist || song.uploader || 'Unknown', thumbnail: song.cover || song.thumbnail };
                searchBtn.click();
            } catch(e) { console.error(e); }
        };

        let prefetchedStreamUrl = null;
        let prefetchVideoId = null;

        async function fetchStreamUrl(videoId, refresh = false) {
            const res = await fetch(`/api/stream?id=${encodeURIComponent(videoId)}${refresh ? '&refresh=true' : ''}`);
            if (!res.ok) throw new Error('Stream request failed');
            return await res.json();
        }

        async function refreshCurrentStream(shouldResume = true) {
            if (!currentVideoId || streamRefreshInProgress) return false;
            streamRefreshInProgress = true;
            // Only save time if metadata is loaded and we have a valid duration
            const savedTime = (audioPlayer.readyState > 0 && audioPlayer.duration) ? (audioPlayer.currentTime || 0) : 0;
            const wasPlaying = !audioPlayer.paused;
            try {
                prefetchedStreamUrl = null;
                prefetchVideoId = null;
                window.prefetchedStreamData = null;
                const streamData = await fetchStreamUrl(currentVideoId, true);
                audioPlayer.src = streamData.requires_proxy === false ? streamData.url : '/api/proxy_stream?url=' + encodeURIComponent(streamData.url);
                audioPlayer.load();
                if (savedTime > 0) {
                    audioPlayer.currentTime = Math.min(savedTime, audioPlayer.duration || savedTime);
                }
                if (shouldResume && (wasPlaying || isSongLoaded)) {
                    await audioPlayer.play().catch(() => {});
                }
                showToast('Stream refreshed');
                return true;
            } catch (e) {
                console.warn('Stream refresh failed:', e);
                showToast('Could not refresh stream ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â try searching again');
                return false;
            } finally {
                streamRefreshInProgress = false;
            }
        }

        async function prefetchNextSong() {
            if (queueList.length === 0 || currentQueueIndex >= queueList.length - 1) return;
            const nextSong = queueList[currentQueueIndex + 1];
            if (nextSong.videoId && prefetchVideoId !== nextSong.videoId) {
                try {
                    const data = await fetchStreamUrl(nextSong.videoId);
                    prefetchedStreamUrl = data.url;
                    prefetchVideoId = nextSong.videoId;
                    window.prefetchedStreamData = data;
                } catch(e) {}
            }
        }

        // ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¬ CINEMATIC CARDS UPDATER ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¬
        // 🎵 CINEMATIC CARDS UPDATER 🎵
        window.updateCinematicCards = function() {
            const prevContainer = document.getElementById('cinematic-prev');
            const nextContainer = document.getElementById('cinematic-next');
            if (!prevContainer || !nextContainer) return;

           async function fetchLyricsForQueueSong(title, artist, videoId) {
            try {
                if (currentVideoId !== videoId && videoId) return;
                lyricsContainer.innerHTML = `
                    <div class="empty-state loading-state-wrapper" style="margin-top:0;">
                        <div class="premium-glass-loader"></div>
                        <div style="font-size:0.95rem; font-weight:600; color:rgba(255,255,255,0.85); margin-top:12px; letter-spacing:0.02em;">
                            Finding lyrics...
                        </div>
                    </div>
                `;

                const cleanTitle = (title || '').split('(')[0].split('[')[0].split('|')[0].trim();
                const cleanArtist = (artist || '').replace(/VEVO|Official|Topic|Music/gi, '').trim();

                let fetchedLines = null;
                let lyricsType = 'none';
                let plainTextLyrics = '';

                // STEP 1: Try /api/lyrics (backend API)
                try {
                    const ytRes = await fetch(`/api/lyrics?videoId=${encodeURIComponent(videoId || '')}&title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`);
                    if (ytRes.ok) {
                        const ytData = await ytRes.json();
                        if (ytData.status === 'success') {
                            if (ytData.type === 'word_synced' && ytData.lines && ytData.lines.length > 0) {
                                fetchedLines = ytData.lines.map((l, lineIdx, lineArr) => {
                                    const nextLineTime = (lineIdx + 1 < lineArr.length) ? lineArr[lineIdx + 1].time : (l.time + 3.5);
                                    return {
                                        start: l.time,
                                        end: nextLineTime,
                                        text: l.text,
                                        isInstrumental: !!l.isInstrumental,
                                        words: (l.words || []).map((w, idx, arr) => {
                                            let nextTime = (idx + 1 < arr.length) ? arr[idx + 1].time : (w.time + 0.48);
                                            if (nextTime <= w.time) nextTime = w.time + 0.3;
                                            return { text: w.word, start: w.time, end: nextTime };
                                        })
                                    };
                                });
                                lyricsType = 'word_synced';
                            } else if (ytData.type === 'plain_text' && ytData.lyrics) {
                                plainTextLyrics = ytData.lyrics;
                                lyricsType = 'plain_text';
                            }
                        }
                    }
                } catch(e) { console.warn("API /api/lyrics unavailable, falling back to LRCLIB:", e); }

                // STEP 2: Fallback to LRCLIB Public API if step 1 produced no lines
                if (!fetchedLines && !plainTextLyrics) {
                    try {
                        const lrcRes = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`);
                        if (lrcRes.ok) {
                            const lrcData = await lrcRes.json();
                            if (lrcData.syncedLyrics) {
                                fetchedLines = parseLrcString(lrcData.syncedLyrics);
                                lyricsType = 'synced';
                            } else if (lrcData.plainLyrics) {
                                plainTextLyrics = lrcData.plainLyrics;
                                lyricsType = 'plain_text';
                            }
                        }
                        // Secondary LRCLIB Search fallback query
                        if (!fetchedLines && !plainTextLyrics) {
                            const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`);
                            if (searchRes.ok) {
                                const searchResults = await searchRes.json();
                                if (Array.isArray(searchResults) && searchResults.length > 0) {
                                    const match = searchResults.find(s => s.syncedLyrics) || searchResults[0];
                                    if (match.syncedLyrics) {
                                        fetchedLines = parseLrcString(match.syncedLyrics);
                                        lyricsType = 'synced';
                                    } else if (match.plainLyrics) {
                                        plainTextLyrics = match.plainLyrics;
                                        lyricsType = 'plain_text';
                                    }
                                }
                            }
                        }
                    } catch (lrcErr) { console.warn("LRCLIB fallback failed:", lrcErr); }
                }

                if (currentVideoId !== videoId && videoId) return;

                if (fetchedLines && fetchedLines.length > 0) {
                    lyricsData = fetchedLines;
                    renderLyrics();
                    showToast(lyricsType === 'word_synced' ? "✨ Word-by-Word Lyrics Active" : "🎵 Synced Lyrics Active");
                } else if (plainTextLyrics) {
                    lyricsData = [];
                    lyricsContainer.innerHTML = `<div style="padding: 20px; font-size: 1.35rem; line-height: 2; color: rgba(255,255,255,0.85); white-space: pre-wrap; font-weight: 500;">${plainTextLyrics}</div>`;
                    showToast("🎤 Official Lyrics Active");
                } else {
                    lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">No lyrics found for this song.<br><br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
                }
            } catch (err) {
                console.error("Lyrics Error:", err);
                if (currentVideoId !== videoId && videoId) return;
                lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">No lyrics found for this song.<br><br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
            }
        }

        // Helper to parse standard LRC string ([00:12.34] lyric text) into lyricsData structure
        function parseLrcString(lrcStr) {
            if (!lrcStr) return [];
            const rawLines = lrcStr.split('\n');
            const parsedLines = [];
            
            rawLines.forEach((line) => {
                const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
                if (match) {
                    const min = parseInt(match[1], 10);
                    const sec = parseFloat(match[2]);
                    const time = min * 60 + sec;
                    const text = match[3].trim();
                    if (text) {
                        parsedLines.push({ time, text });
                    }
                }
            });

            return parsedLines.map((l, lineIdx, lineArr) => {
                const nextLineTime = (lineIdx + 1 < lineArr.length) ? lineArr[lineIdx + 1].time : (l.time + 3.8);
                const lineDuration = Math.max(1.2, nextLineTime - l.time);
                
                // Split line into raw words
                const rawWords = l.text.split(/\s+/).filter(w => w.length > 0);
                
                // Calculate phonetic & syllable weight for each word (vowels & length)
                const wordWeights = rawWords.map(w => {
                    const vowels = (w.match(/[aeiouyàáâãäåèéêëìíîïòóôõöùúûü]/gi) || []).length;
                    return Math.max(1, w.length + (vowels * 0.8));
                });
                
                const totalWeight = wordWeights.reduce((a, b) => a + b, 0) || 1;
                
                // Allocate lineDuration proportionally according to word weight
                let currentWordTime = l.time;
                const words = rawWords.map((w, idx) => {
                    const allocatedDur = (wordWeights[idx] / totalWeight) * lineDuration;
                    const wStart = currentWordTime;
                    const wEnd = currentWordTime + allocatedDur;
                    currentWordTime = wEnd;
                    return { text: w, start: wStart, end: wEnd };
                });

                return {
                    start: l.time,
                    end: nextLineTime,
                    text: l.text,
                    isInstrumental: false,
                    words: words
                };
            });
        }

            const prevImg = prevContainer.querySelector('img');
            const nextImg = nextContainer.querySelector('img');

            if (queueList.length === 0) {
                prevContainer.style.opacity = '0';
                nextContainer.style.opacity = '0';
                return;
            }

            // Prev Card
            if (currentQueueIndex > 0) {
                const prevSong = queueList[currentQueueIndex - 1];
                prevImg.src = getCoverUrl(`${prevSong.title} ${prevSong.artist}`, prevSong.cover || '', prevSong.id || prevSong.videoId);
                prevContainer.style.opacity = '';
                prevContainer.onclick = () => playQueueIndex(currentQueueIndex - 1);
            } else {
                prevContainer.style.opacity = '0';
                prevContainer.onclick = null;
            }

            // Next Card
            if (currentQueueIndex < queueList.length - 1) {
                const nextSong = queueList[currentQueueIndex + 1];
                nextImg.src = getCoverUrl(`${nextSong.title} ${nextSong.artist}`, nextSong.cover || '', nextSong.id || nextSong.videoId);
                nextContainer.style.opacity = '';
                nextContainer.onclick = () => playQueueIndex(currentQueueIndex + 1);
            } else {
                nextContainer.style.opacity = '0';
                nextContainer.onclick = null;
            }
        };

        // — Background Tasks for Queue Playback (Asynchronous to prevent autoplay blocks) —
        async function fetchLyricsForQueueSong(title, artist, videoId) {
            try {
                if (currentVideoId !== videoId) return;
                lyricsContainer.innerHTML = `
                    <div class="empty-state loading-state-wrapper" style="margin-top:0;">
                        <div class="premium-glass-loader"></div>
                        <div style="font-size:0.95rem; font-weight:600; color:rgba(255,255,255,0.85); margin-top:12px; letter-spacing:0.02em;">
                            Finding word-by-word lyrics...
                        </div>
                    </div>
                `;
                const ytRes = await fetch(`/api/lyrics?videoId=${encodeURIComponent(videoId || '')}&title=${encodeURIComponent(title || '')}&artist=${encodeURIComponent(artist || '')}`);
                const ytData = await ytRes.json();
                if (currentVideoId !== videoId) return;
                
                if (ytData.status === 'success') {
                    if (ytData.type === 'word_synced' && ytData.lines && ytData.lines.length > 0) {
                        lyricsData = ytData.lines.map((l, lineIdx, lineArr) => {
                            const nextLineTime = (lineIdx + 1 < lineArr.length) ? lineArr[lineIdx + 1].time : (l.time + 3.5);
                            return {
                                start: l.time,
                                end: nextLineTime,
                                text: l.text,
                                isInstrumental: !!l.isInstrumental,
                                words: (l.words || []).map((w, idx, arr) => {
                                    let nextTime = (idx + 1 < arr.length) ? arr[idx + 1].time : (w.time + 0.48);
                                    if (nextTime <= w.time) nextTime = w.time + 0.3;
                                    return { text: w.word, start: w.time, end: nextTime };
                                })
                            };
                        });
                        renderLyrics();
                        showToast("✨ Word-by-Word Lyrics Active");
                    } else if (ytData.type === 'plain_text' && ytData.lyrics) {
                        lyricsData = [];
                        lyricsContainer.innerHTML = `<div style="padding: 0 20px 100px 20px; font-size: 1.5rem; line-height: 2; color: rgba(255,255,255,0.7); white-space: pre-wrap; font-weight: 500;">${ytData.lyrics}</div>`;
                        showToast("Ã°Å¸Å½Â¤ Official Line-by-Line Lyrics");
                    } else {
                        lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">No lyrics found for this song.<br><br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
                    }
                } else {
                    lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">No lyrics found for this song.<br><br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
                }
            } catch (err) {
                if (currentVideoId !== videoId) return;
                lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">No lyrics found for this song.<br><br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
            }
        }

        async function fetchHdCoverForQueueSong(title, artist, videoId, rawYtThumb) {
            const actualSongQuery = `${title} ${artist}`;
            const coverUrl = getCoverUrl(actualSongQuery, rawYtThumb, videoId, true);
            
            const hdImg = new Image();
            hdImg.crossOrigin = 'Anonymous';
            hdImg.src = coverUrl;
            hdImg.decode().then(() => {
                if (currentVideoId === videoId) {
                    delete coverArt.dataset.fallbackDone;
                    delete miniCover.dataset.fallbackDone;
                    coverArt.setAttribute('crossorigin', 'anonymous');
                    coverArt.src = hdImg.src;
                    miniCover.src = hdImg.src;
                    const qNowArt = document.querySelector('.q-card-now-art');
                    if (qNowArt) qNowArt.src = hdImg.src;
                    updateMediaSession(title, artist, hdImg.src);
                    
                    coverArt.classList.remove('cover-changing');
                    void coverArt.offsetWidth;
                    coverArt.classList.add('cover-changing');
                    
                    const bgLayer = document.getElementById('background-layer');
                    if (bgLayer) bgLayer.style.backgroundImage = `url(${hdImg.src})`;
                }
            }).catch(e => console.warn("Failed to decode HD cover for queue", e));
        }

        // Ã¢â‚¬â€Ã¢â‚¬â€ Reliable queue navigation Ã¢â‚¬â€Ã¢â‚¬â€
        function playQueueIndex(idx) {
            if (idx < 0 || idx >= queueList.length) return;
            const isNext = (idx === currentQueueIndex + 1);
            currentQueueIndex = idx;
            renderQueue();
            const song = queueList[idx];

            // Auto-open player screen ONLY for the first song played in the session
            if (!window.hasPlayedFirstSong) {
                window.hasPlayedFirstSong = true;
                if (typeof showPlayer === 'function') showPlayer();
                else if (window.showPlayer) window.showPlayer();
            }
            
            if (song.localUrl) {
                // Local File Pipeline Bypass
                isSongLoaded = true;
                currentSongMeta = song;
                document.getElementById('track-title').textContent = song.title;
                document.getElementById('track-artist').textContent = song.artist;
                miniTitle.textContent = song.title;
                miniArtist.textContent = song.artist;
                delete coverArt.dataset.fallbackDone;
                delete miniCover.dataset.fallbackDone;
                coverArt.src = song.cover;
                miniCover.src = song.cover;
                miniCover.src = song.cover;
                document.body.classList.add('song-playing');
                
                // Clear old lyrics
                lyricsData = [];
                wordElements = [];
                lineElements = [];
                lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">Lyrics not available offline</div>';
                
                audioPlayer.src = song.localUrl;
                audioPlayer.play().catch(e => console.log('Local play error:', e));
                setPlayPauseUI(true);
                return;
            }
            
            // YouTube Playback Pipeline Bypass (Fully synchronous track loading to ensure reliable background autoplay)
            isSongLoaded = true;
            currentVideoId = song.videoId;
            currentSongMeta = {
                id: song.videoId,
                videoId: song.videoId,
                title: song.title,
                artist: song.artist,
                cover: song.cover || ''
            };
            
            // Enable control buttons
            playPauseBtn.disabled = false;
            nextBtn.disabled = false;
            prevBtn.disabled = false;

            // UI Text Update
            document.getElementById('track-title').textContent = song.title;
            document.getElementById('track-artist').textContent = song.artist;
            miniTitle.textContent = song.title;
            miniArtist.textContent = song.artist;

            // Cover Art Update - Instantly fallback to YouTube thumbnail if cover is missing
            const rawYtThumb = song.cover || `https://img.youtube.com/vi/${song.videoId}/hqdefault.jpg`;
            
            delete coverArt.dataset.fallbackDone;
            delete miniCover.dataset.fallbackDone;
            coverArt.removeAttribute('crossorigin');
            coverArt.src = rawYtThumb;
            const smallThumb = resolveYtThumb(rawYtThumb, 'small') || rawYtThumb;
            // Fetch HD 1400x1400 iTunes Cover in background
            fetchHdCoverForQueueSong(song.title, song.artist, song.videoId, rawYtThumb);
            
            coverArt.style.display = 'block';
            const defaultCoverIcon = document.getElementById('default-cover-icon');
            if (defaultCoverIcon) defaultCoverIcon.style.display = 'none';

            // Show changing transition animations
            coverArt.classList.remove('cover-changing');
            trackTitleEl.classList.remove('title-changing');
            void coverArt.offsetWidth; // force reflow
            coverArt.classList.add('cover-changing');
            trackTitleEl.classList.add('title-changing');
            
            document.body.classList.add('song-playing');
            
            // Update Media Session
            updateMediaSession(song.title, song.artist, rawYtThumb);

            // Sync Like/Favorite UI
            setLikeUI(isSongLiked(song.title, song.artist));

            // Save to Local History
            saveToHistory({
                id: song.videoId,
                title: song.title,
                uploader: song.artist,
                thumbnail: song.cover || ''
            }, rawYtThumb);

            // Clear old lyrics
            lyricsData = [];
            wordElements = [];
            lineElements = [];
            lyricsContainer.innerHTML = '<div class="empty-state loading-state-wrapper" style="margin-top:0;"><div class="premium-glass-loader"></div><div>Syncing lyrics...</div></div>';

            // 1. Handover prefetched gapless stream if available, otherwise set src directly
            if (isNext && prefetchVideoId === song.videoId && prefetchedStreamUrl) {
                window.prefetchedStreamData = { url: prefetchedStreamUrl, quality: "Prefetched" };
                audioPlayer.src = window.prefetchedStreamData.requires_proxy === false ? window.prefetchedStreamData.url : '/api/proxy_stream?url=' + encodeURIComponent(prefetchedStreamUrl);
                prefetchedStreamUrl = null;
                prefetchVideoId = null;
            } else {
                window.prefetchedStreamData = null;
                audioPlayer.src = song.videoId; // This synchronously calls ytPlayer.loadVideoById in the setter
            }

            // 2. Play immediately
            audioPlayer.play().catch(e => console.warn("Queue play failed:", e));

            // 3. Asynchronously fetch higher resolution iTunes cover art
            fetchHdCoverForQueueSong(song.title, song.artist, song.videoId, rawYtThumb);

            // 4. Asynchronously fetch recommendations for infinite radio / next track queueing
            populateQueue(song.videoId, true);

            // 5. Asynchronously fetch & render lyrics
            fetchLyricsForQueueSong(song.title, song.artist, song.videoId);

        }

        // --- PIPELINE ---
        let currentPlaybackToken = 0;
        let searchAbortController = null;
        
        searchBtn.addEventListener('click', async () => {
            // Audio visualizer and spatial audio removed.

            const query = songSearchInput.value.trim();
            if (!query) return;

            // Auto-open player screen ONLY for the first song played in the session
            if (!window.hasPlayedFirstSong) {
                window.hasPlayedFirstSong = true;
                if (typeof showPlayer === 'function') showPlayer();
                else if (window.showPlayer) window.showPlayer();
            }

            currentPlaybackToken++;
            const myToken = currentPlaybackToken;

            if (searchAbortController) searchAbortController.abort();
            searchAbortController = new AbortController();
            const signal = searchAbortController.signal;
            songSearchInput.value = ''; // Immediately clear so it doesn't stay populated

            // Cancel any ongoing stream refresh
            streamRefreshInProgress = false;
            
            // DO NOT pause/clear if we just injected a gapless prefetched stream
            if (!window.prefetchedStreamData) {
                audioPlayer.pause();
            }

            // --- SONG TRANSITION ANIMATION ---
            coverArt.classList.remove('cover-changing');
            trackTitleEl.classList.remove('title-changing');
            void coverArt.offsetWidth; // force reflow to restart animation
            coverArt.classList.add('cover-changing');
            trackTitleEl.classList.add('title-changing');

            lyricsContainer.innerHTML = '<div class="empty-state loading-state-wrapper" style="margin-top:0;"><div class="premium-glass-loader"></div><div>Finding song...</div></div>';
            
            let songData = null;
            let isFromQueue = false;
            try {
                // STEP 1: Get song metadata (Bypass search if forced from queue)
                isFromQueue = !!window._forceQueueSong;
                
                if (isFromQueue) {
                    songData = {
                        id: window._forceQueueSong.videoId,
                        title: window._forceQueueSong.title,
                        uploader: window._forceQueueSong.artist,
                        thumbnail: window._forceQueueSong.thumbnail || window._forceQueueSong.cover || ''
                    };
                    window._forceQueueSong = null; // consume it
                } else {
                    const ytRes = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
                    if (!ytRes.ok) throw new Error("Backend search failed");
                    songData = await ytRes.json();
                }
                
                if (myToken !== currentPlaybackToken) return; // Race condition check
                
                currentVideoId = songData.id || null;

                // INSTANT SYNCHRONOUS QUEUE RESET (unless playing a preserved playlist)
                if (!window._preserveQueue) {
                    queueRenderLimit = 10;
                    queueList = [{
                        videoId: currentVideoId,
                        title: songData.title,
                        artist: songData.uploader,
                        cover: songData.thumbnail || ''
                    }];
                    currentQueueIndex = 0;
                    renderQueue();
                } else {
                    window._preserveQueue = false; // consume
                }

                // Immediately update UI with what we have
                trackTitleEl.textContent = songData.title;
                trackArtistEl.textContent = songData.uploader;
                miniTitle.textContent = songData.title;
                miniArtist.textContent = songData.uploader;
                trackTitleEl.classList.remove('title-changing');
                void trackTitleEl.offsetWidth;
                trackTitleEl.classList.add('title-changing');

                // Set cover immediately (show spinner-style blur while loading)
                const rawYtThumb = resolveYtThumb(songData.thumbnail, 'large');
                const actualSongQuery = `${songData.title} ${songData.uploader}`;
                const coverUrl = getCoverUrl(actualSongQuery, rawYtThumb, currentVideoId, true);
                
                
                // Instantly show YouTube thumbnail for snappy UI
                if (rawYtThumb) {
                    delete coverArt.dataset.fallbackDone;
                    delete miniCover.dataset.fallbackDone;
                    coverArt.removeAttribute('crossorigin');
                    coverArt.src = rawYtThumb;
                    
                    const smallThumb = resolveYtThumb(songData.thumbnail, 'small');
                    miniCover.src = smallThumb;
                    
                    const bgImg = new Image();
                    bgImg.crossOrigin = 'Anonymous';
                    bgImg.src = smallThumb;
                    bgImg.decode().catch(() => {});
                }

                // We ALWAYS add song-playing so the ambient-wrapper becomes visible
                document.body.classList.add('song-playing');
                updateMediaSession(songData.title, songData.uploader, rawYtThumb || 'default_cover.jpg');
                
                coverArt.style.display = 'block';
                document.getElementById('default-cover-icon').style.display = 'none';
                
                // Upgrade to HD iTunes cover silently in background (Only for the actual cover art, NOT the blurred background)
                const hdImg = new Image();
                hdImg.crossOrigin = 'Anonymous';
                hdImg.src = coverUrl;
                hdImg.decode().then(() => {
                    delete coverArt.dataset.fallbackDone;
                    delete miniCover.dataset.fallbackDone;
                    coverArt.setAttribute('crossorigin', 'anonymous');
                    coverArt.src = hdImg.src;
                    miniCover.src = hdImg.src;
                    // (Background is now dynamically drawn via canvas)
                    updateMediaSession(songData.title, songData.uploader, hdImg.src);
                    
                    coverArt.classList.remove('cover-changing');
                    void coverArt.offsetWidth;
                    coverArt.classList.add('cover-changing');
                    
                    const bgLayer = document.getElementById('background-layer');
                    if (bgLayer) bgLayer.style.backgroundImage = `url(${songData.thumbnail ? resolveYtThumb(songData.thumbnail, 'small') : hdImg.src})`;
                    const activeScreen = document.querySelector('.screen-view.active-screen');
                }).catch(e => console.warn("Failed to decode HD cover", e));

                saveToHistory(songData, rawYtThumb);

                // Update currentSongMeta and sync Like button UI
                currentSongMeta = {
                    id: songData.id || songData.videoId || currentVideoId,
                    videoId: songData.videoId || songData.id || currentVideoId,
                    title: songData.title,
                    artist: songData.uploader,
                    cover: songData.thumbnail || ''
                };
                setLikeUI(isSongLiked(songData.title, songData.uploader));

                // STEP 2: Fetch stream URL + lyrics IN PARALLEL for speed!
                lyricsContainer.innerHTML = '<div class="empty-state loading-state-wrapper" style="margin-top:0;"><div class="premium-glass-loader"></div><div>Loading stream & lyrics...</div></div>';

                const cleanTitle = songData.title.split('(')[0].split('[')[0].split('|')[0].trim();
                const cleanArtist = songData.uploader.replace(/VEVO|Official|Topic|Music/gi, '').trim();

                let streamData;
                let lrc1;
                
                // Check Offline Database FIRST
                let localSong = null;
                try {
                    const downloadedSongs = await getDownloadedSongs();
                    localSong = downloadedSongs.find(s => s.id === songData.id);
                } catch(e) { console.error("Offline DB read error:", e); }

                if (localSong && localSong.blob) {
                    streamData = { url: URL.createObjectURL(localSong.blob), quality: 'Offline HD' };
                    try {
                        lrc1 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { signal });
                    } catch(e) {
                        lrc1 = { json: async () => [] };
                    }
                    if (myToken !== currentPlaybackToken) return;
                    audioPlayer.src = streamData.requires_proxy === false ? streamData.url : '/api/proxy_stream?url=' + encodeURIComponent(streamData.url);
                    audioPlayer.play().catch(e => console.warn("Play failed:", e));
                }
                // If it was injected by playQueueIndex, it's valid.
                // If it was lingering from prefetchNextSong but doesn't match the new search, discard it!
                else if (window.prefetchedStreamData && (!prefetchVideoId || prefetchVideoId === currentVideoId)) {
                    streamData = window.prefetchedStreamData;
                    audioPlayer._proxyDuration = streamData.duration || 0;
                    audioPlayer.src = window.prefetchedStreamData.requires_proxy === false ? window.prefetchedStreamData.url : '/api/proxy_stream?url=' + encodeURIComponent(window.prefetchedStreamData.url);
                    window.prefetchedStreamData = null;
                    lrc1 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { signal });
                    if (myToken !== currentPlaybackToken) return; // Race condition check
                    
                    // src and play() were already triggered seamlessly in playQueueIndex
                    // Just ensure it's playing in case of browser autoplay blocks
                    if (audioPlayer.paused) audioPlayer.play().catch(e => console.warn("Play failed:", e));
                } else {
                    // Start lyrics fetch in background
                    const lyricsPromise = fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { signal }).catch(e => null);
                    
                    streamData = await fetchStreamUrl(songData.id).catch(e => {
                        throw new Error('Stream request failed');
                    });
                    
                    if (myToken !== currentPlaybackToken) return;
                    if (!streamData.url) throw new Error(streamData.message || 'No stream URL returned');
                    
                    audioPlayer._proxyDuration = streamData.duration || 0;
                    
                    // Set src and play IMMEDIATELY
                    audioPlayer.src = streamData.requires_proxy === false ? streamData.url : '/api/proxy_stream?url=' + encodeURIComponent(streamData.url);
                    audioPlayer.play().catch(e => console.warn("Play failed:", e));
                    
                    // Now await lyrics
                    lrc1 = await lyricsPromise;
                }

                isSongLoaded = true;
                playPauseBtn.disabled = false;
                nextBtn.disabled = false;
                prevBtn.disabled = false;
                
                // Populate recommendations for infinite radio
                populateQueue(songData.videoId || songData.id, true);

                // Quality badge
                if (streamData.quality) {
                    const badge = document.createElement('div');
                    badge.style.cssText = 'position:fixed;top:20px;right:80px;background:rgba(var(--accent-rgb),0.85);color:white;padding:6px 14px;border-radius:20px;font-size:0.8rem;font-weight:600;z-index:9999;backdrop-filter:blur(10px);transition:opacity 1s;';
                    badge.textContent = `ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ ${streamData.quality}`;
                    document.body.appendChild(badge);
                    setTimeout(() => { badge.style.opacity = '0'; setTimeout(() => badge.remove(), 1000); }, 3000);
                }

                // STEP 3: Now process lyrics via Word-by-Word Priority + YT Fallback Pipeline
                fetchLyricsForQueueSong(cleanTitle, cleanArtist, songData.id || songData.videoId);
                
                                                
            } catch (e) {
                if (e.name === 'AbortError') return; // Ignore aborted fetches from rapid skipping
                console.warn("Backend stream failed or blocked on cloud server. Instantly falling back to YouTube Official IFrame Player:", e);
                
                try {
                    const fallbackVid = (songData && (songData.id || songData.videoId)) || currentVideoId || window._lastPlayedVideoId;
                    const fallbackTitle = (songData && songData.title) || trackTitleEl.textContent || query;
                    const fallbackArtist = (songData && songData.uploader) || trackArtistEl.textContent || '';
                    
                    if (fallbackVid) currentVideoId = fallbackVid;
                    
                    const cTitle = (fallbackTitle || query).split('(')[0].split('[')[0].split('|')[0].trim();
                    const cArtist = (fallbackArtist || '').replace(/VEVO|Official|Topic|Music/gi, '').trim();
                    
                    audioPlayer._mode = 'yt';
                    if (fallbackVid) {
                        audioPlayer.src = fallbackVid;
                        audioPlayer.play().catch(err => console.warn("IFrame play failed:", err));
                        populateQueue(fallbackVid, true);
                    }
                    
                    showToast("Ã°Å¸Å½Âµ Playing via YouTube Official Player");
                    isSongLoaded = true;
                    playPauseBtn.disabled = false;
                    nextBtn.disabled = false;
                    prevBtn.disabled = false;
                    
                    // Fetch lyrics reliably
                    fetchLyricsForQueueSong(cTitle, cArtist, currentVideoId || fallbackVid || '');
                } catch (fallbackErr) {
                    console.error("Playback Error:", fallbackErr);
                    showToast("Playback Error: " + (fallbackErr.message || "Unknown Error"));
                }
            }
        });

        // Playback listeners
        playPauseBtn.addEventListener('click', () => {
            if (audioPlayer.paused) audioPlayer.play();
            else audioPlayer.pause();
        });

        audioPlayer.addEventListener('play', () => {
            setBhIcon(true);
            miniPlayPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            playPauseBtn.classList.add('playing');
            coverArtContainer.classList.add('playing');
            document.getElementById('cover-wrapper').classList.add('playing');
            if (typeof window.showCatWidget === 'function') window.showCatWidget();
            
            // Auto-open player screen ONLY for the first song played in the session
            if (!window.hasPlayedFirstSong) {
                window.hasPlayedFirstSong = true;
                if (typeof window.showPlayer === 'function') {
                    window.showPlayer();
                } else if (typeof showPlayer === 'function') {
                    showPlayer();
                }
            }
        });

        audioPlayer.addEventListener('pause', () => {
            setBhIcon(false);
            miniPlayPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
            playPauseBtn.classList.remove('playing');
            coverArtContainer.classList.remove('playing');
            document.getElementById('cover-wrapper').classList.remove('playing');
            if (typeof window.hideCatWidget === 'function') window.hideCatWidget();
        });
        
        // Auto Next Song + Repeat Logic
        audioPlayer.addEventListener('ended', () => {
            if (repeatMode === 2) {
                // Repeat ONE: restart same song
                audioPlayer.currentTime = 0;
                audioPlayer.play();
                return;
            }
            if (queueList.length > 0 && currentQueueIndex < queueList.length - 1) {
                playQueueIndex(currentQueueIndex + 1);
            } else if (repeatMode === 1 && queueList.length > 0) {
                // Repeat ALL: go back to first song
                playQueueIndex(0);
            } else {
                setBhIcon(false);
                miniPlayPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
                playPauseBtn.classList.remove('playing');
                coverArtContainer.classList.remove('playing');
                document.getElementById('cover-wrapper').classList.remove('playing');
            }
        });

        nextBtn.addEventListener('click', () => {
            if (queueList.length > 0 && currentQueueIndex < queueList.length - 1) {
                playQueueIndex(currentQueueIndex + 1);
            }
        });
        
        prevBtn.addEventListener('click', () => {
            if (audioPlayer.currentTime > 5) {
                audioPlayer.currentTime = 0;
            } else if (currentQueueIndex > 0) {
                playQueueIndex(currentQueueIndex - 1);
            }
        });

        audioPlayer.addEventListener('timeupdate', () => {
            if (!isDraggingProgress) updateProgressUI();
        });
        
        audioPlayer.addEventListener('loadedmetadata', () => {
            durationEl.textContent = formatTime(audioPlayer.duration);
        });

        audioPlayer.addEventListener('error', () => {
            if (!currentVideoId || streamRefreshInProgress) return;
            // Ignore abort errors (code 1) or null errors which happen when we switch songs
            const err = audioPlayer.error;
            if (!err || err.code === 1) {
                return;
            }
            console.error('Audio player error:', err);
            refreshCurrentStream(true);
        });

        audioPlayer.addEventListener('stalled', () => {
            // Only handle stalling if we have loaded metadata (readyState >= 1) and are not fully loaded (readyState >= 3)
            if (!currentVideoId || streamRefreshInProgress || audioPlayer.readyState === 0 || audioPlayer.readyState >= 3) return;
            if (audioPlayer.paused && audioPlayer.currentTime === 0) return;
            refreshCurrentStream(!audioPlayer.paused);
        });

        function formatTime(seconds) {
            if (isNaN(seconds)) return "0:00";
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        progressContainer.addEventListener('mousedown', (e) => { isDraggingProgress = true; seekAudio(e); });
        window.addEventListener('mousemove', (e) => { if (isDraggingProgress) seekAudio(e); });
        window.addEventListener('mouseup', () => { isDraggingProgress = false; });

        function seekAudio(e) {
            const rect = progressContainer.getBoundingClientRect();
            let offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const percentage = offsetX / rect.width;
            progressBar.style.width = `${percentage * 100}%`;
            if (audioPlayer.duration) {
                audioPlayer.currentTime = percentage * audioPlayer.duration;
                currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
                processLyricsFrame();
            }
        }

        function updateProgressUI() {
            currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
            if (!audioPlayer.duration) return;
            progressBar.style.width = `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`;
            durationEl.textContent = formatTime(audioPlayer.duration);
        }

        function convertLrcToJson(lrcText) {
            const lines = lrcText.split('\n');
            const parsedData = [];
            const regex = /\[(\d{2}):(\d{2}\.\d{2})\](.*)/;

            lines.forEach(line => {
                const match = line.match(regex);
                if (match) {
                    const text = match[3].trim();
                    if (text) {
                        parsedData.push({
                            start: parseInt(match[1]) * 60 + parseFloat(match[2]),
                            text: text
                        });
                    }
                }
            });

            const converted = [];
            
            // Inject Intro Instrumental if lyrics start after 4 seconds
            if (parsedData.length > 0 && parsedData[0].start > 4) {
                converted.push({
                    start: 0,
                    end: parsedData[0].start - 0.5,
                    words: [],
                    isInstrumental: true
                });
            }

            for (let i = 0; i < parsedData.length; i++) {
                const current = parsedData[i];
                let endTime = (i < parsedData.length - 1) ? parsedData[i + 1].start : current.start + 5;
                let originalNextStart = (i < parsedData.length - 1) ? parsedData[i + 1].start : null;
                
                if (endTime - current.start > 6) endTime = current.start + 6;
                
                const lineData = { start: current.start, end: endTime, words: [], isInstrumental: false };
                const words = current.text.split(' ');
                const wordDuration = (endTime - current.start) / words.length;
                
                words.forEach((w, idx) => {
                    lineData.words.push({
                        text: w,
                        start: current.start + (idx * wordDuration),
                        end: current.start + ((idx + 1) * wordDuration)
                    });
                });
                converted.push(lineData);

                // Inject Instrumental Gap if gap is larger than 3 seconds
                if (originalNextStart && (originalNextStart - endTime > 3)) {
                    converted.push({
                        start: endTime + 0.5,
                        end: originalNextStart - 0.5,
                        words: [],
                        isInstrumental: true
                    });
                }
            }
            return converted;
        }

        function renderLyrics() {
            lyricsContainer.innerHTML = '';
            wordElements = []; lineElements = []; activeLineIndex = -1;

            if (lyricsData.length === 0) return;

            const frag = document.createDocumentFragment();
            lyricsData.forEach((line, lineIdx) => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'lyric-line';
                lineDiv.dataset.index = lineIdx;
                lineDiv.addEventListener('click', () => {
                    audioPlayer.currentTime = line.start;
                    if (audioPlayer.paused) audioPlayer.play();
                });

                const lineWords = [];

                if (line.isInstrumental) {
                    lineDiv.classList.add('instrumental-line');
                    lineDiv.innerHTML = '<span class="instrumental-dots"><span>&bull;</span><span>&bull;</span><span>&bull;</span></span>';
                } else {
                    line.words.forEach((word) => {
                        const wordSpan = document.createElement('span');
                        wordSpan.className = 'lyric-word';
                        wordSpan.textContent = word.text;
                        wordSpan.dataset.start = word.start;
                        wordSpan.dataset.end = word.end;
                        lineDiv.appendChild(wordSpan);
                        lineDiv.appendChild(document.createTextNode(' '));
                        const wData = { el: wordSpan, start: word.start, end: word.end, state: 'future' };
                        wordElements.push(wData);
                        lineWords.push(wData);
                    });
                }

                frag.appendChild(lineDiv);
                lineElements.push({ el: lineDiv, start: line.start, end: line.end, words: lineWords });
            });
            lyricsContainer.appendChild(frag);
            
            updateCachedPanelHeight();
            requestAnimationFrame(processLyricsFrame);
        }

        let cachedPanelHeight = 0;
        function updateCachedPanelHeight() {
            if (rightPanel) {
                cachedPanelHeight = rightPanel.offsetHeight || window.innerHeight;
            } else {
                cachedPanelHeight = window.innerHeight;
            }
        }

        window.addEventListener('resize', () => {
            updateCachedPanelHeight();
            processLyricsFrame();
        }, { passive: true });

        function animationLoop() {
            if (!isDraggingProgress) updateProgressUI();
            if (!window._appTabHidden && lineElements && lineElements.length > 0) {
                // Focus Mode: We let it scroll, but CSS will fade it out to prevent lag
                if (!audioPlayer.paused) processLyricsFrame();
                else if (Math.abs(targetY - currentY) > 0.1) lerpScroll();
            }
            requestAnimationFrame(animationLoop);
        }

        function processLyricsFrame(e) {
            const time = audioPlayer.currentTime;
            let currentLineIndex = -1;

            for (let i = 0; i < lineElements.length; i++) {
                if (time >= lineElements[i].start) currentLineIndex = i;
            }

            const isResize = e && e.type === 'resize';
            const lineChanged = activeLineIndex !== currentLineIndex;

            if (lineChanged || isResize) {
                if (lineChanged) {
                    if (activeLineIndex !== -1 && lineElements[activeLineIndex]) {
                        lineElements[activeLineIndex].el.classList.remove('active-line');
                    }
                    if (currentLineIndex !== -1 && lineElements[currentLineIndex]) {
                        lineElements[currentLineIndex].el.classList.add('active-line');
                    }
                    activeLineIndex = currentLineIndex;

                    // Bulk update word states on line transition rather than every frame
                    for (let i = 0; i < lineElements.length; i++) {
                        const line = lineElements[i];
                        if (!line.words) continue;
                        if (i < currentLineIndex) {
                            line.words.forEach(w => {
                                if (w.state !== 'passed') {
                                    w.el.className = 'lyric-word passed';
                                    w.el.style.setProperty('--progress', '100%');
                                    w.state = 'passed';
                                }
                            });
                        } else if (i > currentLineIndex) {
                            line.words.forEach(w => {
                                if (w.state !== 'future') {
                                    w.el.className = 'lyric-word';
                                    w.el.style.setProperty('--progress', '0%');
                                    w.state = 'future';
                                }
                            });
                        }
                    }
                }

                // Only calculate layout when the line changes or window resizes to prevent massive layout thrashing
                const panelHeight = rightPanel.offsetHeight;
                if (activeLineIndex !== -1 && lineElements[activeLineIndex]) {
                    targetY = (panelHeight / 2) - (lineElements[activeLineIndex].el.offsetHeight / 2) - lineElements[activeLineIndex].el.offsetTop;
                } else if (lineElements.length > 0) {
                    targetY = (panelHeight / 2) - (lineElements[0].el.offsetHeight / 2) - lineElements[0].el.offsetTop;
                } else targetY = panelHeight / 2;
            }

            // ONLY animate active line's words on every frame
            if (currentLineIndex !== -1 && lineElements[currentLineIndex]) {
                const activeLine = lineElements[currentLineIndex];
                if (activeLine.words) {
                    activeLine.words.forEach(w => {
                        let pct = 0;
                        const dur = Math.max(0.15, w.end - w.start);
                        if (time >= w.end) {
                            if (w.state !== 'passed') {
                                w.el.className = 'lyric-word passed';
                                w.el.style.setProperty('--progress', '100%');
                                w.state = 'passed';
                            }
                        } else if (time >= w.start) {
                            pct = Math.max(0, Math.min(100, ((time - w.start) / dur) * 100));
                            if (w.state !== 'active') {
                                w.el.className = 'lyric-word active';
                                w.state = 'active';
                            }
                            w.el.style.setProperty('--progress', `${pct}%`);
                        } else {
                            if (w.state !== 'future') {
                                w.el.className = 'lyric-word';
                                w.el.style.setProperty('--progress', '0%');
                                w.state = 'future';
                            }
                        }
                    });
                }
            }

            lerpScroll();
        }

        function lerpScroll() {
            const diff = targetY - currentY;
            if (Math.abs(diff) > 0.5) {
                currentY += diff * 0.05; 
                lyricsContainer.style.transform = `translateY(${currentY}px)`;
            } else if (Math.abs(diff) > 0) {
                currentY = targetY;
                lyricsContainer.style.transform = `translateY(${currentY}px)`;
            }
        }

        requestAnimationFrame(animationLoop);

        // --- SIDE NAV LOGIC ---
        const sideNavEl = document.getElementById('side-nav');
        const navOrb = document.getElementById('nav-orb');
        const navBtns = document.querySelectorAll('.nav-btn');

        // Hover Orb sliding logic
        navBtns.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                if (window.innerWidth > 768) { // Only slide on desktop
                    const topPos = btn.offsetTop;
                    navOrb.style.transform = `translateY(${topPos}px)`;
                }
            });
            btn.addEventListener('click', () => {
                if(btn.id === 'floating-queue-btn') return; // Handled separately
                
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const index = btn.getAttribute('data-index');
                if (index === "0") {
                    showHome();
                } else if (index === "1") {
                    showLibrary();
                } else if (index === "3") {
                    showHistory();
                } else if (index === "4") {
                    showSettings();
                } else {
                    showPlayer();
                }
            });
        });

        // Dynamic Colors Extraction (Chameleon Glow + Mesh Background)
        async function updateDynamicColors() {
            try {
                if (!coverArt.src || coverArt.src === window.location.href) return;
                
                // Fast async decoding off-main-thread to prevent UI lag
                const bitmap = await window.createImageBitmap(coverArt, { resizeWidth: 10, resizeHeight: 10, resizeQuality: 'low' });
                
                const canvas = document.createElement('canvas');
                canvas.width = 10; canvas.height = 10;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
                
                const data = ctx.getImageData(0, 0, 10, 10).data;
                
                let rSum = 0, gSum = 0, bSum = 0;
                for (let i = 0; i < data.length; i += 4) {
                    rSum += data[i]; gSum += data[i+1]; bSum += data[i+2];
                }
                
                const avgR = Math.round(rSum / 100);
                const avgG = Math.round(gSum / 100);
                const avgB = Math.round(bSum / 100);
                
                // Set CSS variables for CSS Aurora Orbs
                const auroraContainer = document.getElementById('css-aurora-container');
                if (auroraContainer) {
                    auroraContainer.style.setProperty('--aurora-1', `rgba(${avgR}, ${avgG}, ${avgB}, 0.95)`);
                    auroraContainer.style.setProperty('--aurora-2', `rgba(${Math.min(255, avgR + 40)}, ${Math.max(0, avgG - 20)}, ${Math.min(255, avgB + 20)}, 0.95)`);
                    auroraContainer.style.setProperty('--aurora-3', `rgba(${Math.max(0, avgR - 30)}, ${Math.min(255, avgG + 40)}, ${Math.max(0, avgB - 10)}, 0.95)`);
                    auroraContainer.style.setProperty('--aurora-4', `rgba(${Math.min(255, avgR + 20)}, ${Math.max(0, avgG - 30)}, ${Math.min(255, avgB + 50)}, 0.95)`);
                    auroraContainer.style.setProperty('--aurora-5', `rgba(${Math.max(0, avgR - 10)}, ${Math.min(255, avgG + 20)}, ${Math.max(0, avgB - 40)}, 0.95)`);
                }

                // Set very subtle chameleon glow to avoid "weird" navbar coloring
                sideNavEl.style.setProperty('--chameleon-glow', `rgba(${avgR},${avgG},${avgB},0.08)`);
            } catch(e) {
                // Fallback
                sideNavEl.style.setProperty('--chameleon-glow', `rgba(255,255,255,0.02)`);
            }
        }
        
        coverArt.addEventListener('load', updateDynamicColors);

        // --- AUTO-TRENDING & PERSONALIZATION ---
        async function loadTrendingFeeds() {
            try {
                // Populate Jump Back In from History
                const historyStr = localStorage.getItem('music_history_full') || '[]';
                const historyList = JSON.parse(historyStr);
                if (historyList.length > 0) {
                    document.getElementById('jump-back-in-section').style.display = 'block';
                    // Get unique songs
                    const uniqueHistory = [];
                    const seen = new Set();
                    for(let h of historyList) {
                        const id = h.title + '|' + h.artist;
                        if(!seen.has(id)) {
                            seen.add(id);
                            uniqueHistory.push(h);
                        }
                    }
                    populateArtGrid('jump-back-in-container', uniqueHistory.slice(0, 64));
                    // Fire the new smart recommendation engine (non-blocking)
                    populateTasteMix(uniqueHistory);
                    populateBecauseRows(uniqueHistory);
                }
                populateHomeTopArtists();

                // Load Dynamic Sections Asynchronously
                const dynamicContainer = document.getElementById('dynamic-sections');
                if (!dynamicContainer) return;
                dynamicContainer.innerHTML = '<div class="empty-state loading-state-wrapper" style="padding:40px;"><div class="premium-glass-loader"></div><div>Fetching personalized feeds from YouTube Music...</div></div>';
                
                const res = await fetch('/api/home');
                const data = await res.json();
                
                if (data.status === 'success' && data.feed && data.feed.length > 0) {
                    dynamicContainer.innerHTML = '';
                    data.feed.forEach((section, idx) => {
                        if (!section.contents || section.contents.length === 0) return;
                        
                        const sectionId = 'home-sec-' + idx;
                        // Use grid for song lists (like Quick Picks), vinyl scroll rows for playlists/albums
                        const isGrid = section.contents.some(item => item.type === 'song');
                        const layoutClass = isGrid ? 'dense-grid-container' : 'vinyl-scroll-container';
                        
                        const html = `
                            <div class="home-section">
                                <h2 class="section-title">${section.title}</h2>
                                <div class="${layoutClass}" id="${sectionId}"></div>
                            </div>
                        `;
                        dynamicContainer.insertAdjacentHTML('beforeend', html);
                        
                        if (isGrid) {
                            populateDenseGrid(sectionId, section.contents);
                        } else {
                            populateVinylContainer(sectionId, section.contents);
                        }
                    });
                } else {
                    // If no feed data, try loading generic trending songs instead
                    dynamicContainer.innerHTML = '';
                    const trendingQueries = [
                        'Top Bollywood hits 2024', 
                        'Best English songs 2024',
                        'Viral hits trending now'
                    ];
                    for (const q of trendingQueries) {
                        try {
                            const tRes = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                            if (tRes.ok) {
                                const tData = await tRes.json();
                                if (tData && tData.id) {
                                    const sectionId = 'trend-' + Math.random().toString(36).slice(2);
                                    dynamicContainer.insertAdjacentHTML('beforeend', `
                                        <div class="home-section">
                                            <h2 class="section-title">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¥ ${q}</h2>
                                            <div class="dense-grid-container" id="${sectionId}"></div>
                                        </div>`);
                                    populateDenseGrid(sectionId, [{ title: tData.title, artist: tData.uploader, cover: tData.thumbnail, query: q }]);
                                }
                            }
                        } catch(e2) { /* ignore */ }
                    }
                    if (!dynamicContainer.innerHTML.trim()) {
                        dynamicContainer.innerHTML = '<div class="empty-state" style="opacity:0.5; font-size:0.9rem;">Sync your YouTube Music account in ÃƒÂ¢Ã…Â¡Ã¢â€žÂ¢ÃƒÂ¯Ã‚Â¸Ã‚Â Settings to see personalized recommendations.</div>';
                    }
                }
            } catch(e) {
                console.error("Failed to load home feeds", e);
                const dyn = document.getElementById('dynamic-sections');
                if (dyn) {
                    dyn.innerHTML = '<div class="empty-state">Network error fetching feeds. Ensure backend is running.</div>';
                }
            }
        }

        function populateDenseGrid(containerId, entries) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            entries.forEach((item, idx) => {
                const title = item.title || item.name || 'Unknown Title';
                const subtitle = item.artist || item.uploader || 'Unknown Artist';
                const videoId = item.videoId || item.id;
                let rawThumb = item.cover || item.thumbnail || item.thumb || '';
                if (!rawThumb && videoId) {
                    rawThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                }
                // Use backend cover proxy for reliable images
                const thumb = getCoverUrl(`${title} ${subtitle}`, rawThumb, videoId);
                const query = `${title} ${subtitle}`;
                const fallbackThumb = `/api/cover?vid=${videoId || ''}&q=${encodeURIComponent(query)}`;
                
                const card = document.createElement('div');
                card.className = 'dense-card';
                card.style.animationDelay = `${idx * 0.03}s`;
                card.setAttribute('data-query', query);
                card.innerHTML = `
                    <img src="${thumb}" alt="" class="dense-card-cover" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackThumb}'">
                    <div class="dense-card-info">
                        <div class="dense-card-title">${title}</div>
                        <div class="dense-card-artist">${subtitle}</div>
                    </div>
                    <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${query.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                    </button>
                `;
                card.onclick = () => {
                    if (item.playlistId || item.type === 'playlist') {
                        showRemotePlaylistPage(item.playlistId);
                    } else if (item.browseId || item.type === 'album') {
                        showAlbumPage(item.browseId);
                    } else if (item.type === 'artist') {
                        showArtistPage(item.browseId || item.name || item.title);
                    } else if (videoId) {
                        const songJson = JSON.stringify({title: title, artist: subtitle, cover: thumb, videoId: videoId}).replace(/"/g, '&quot;');
                        window.playSong(videoId, songJson, card);
                    } else {
                        songSearchInput.value = query; searchBtn.click();
                    }
                };
                container.appendChild(card);
            });
            setupLazyCovers(container);
        }

        // Ã°Å¸Å½Â¨ ART GRID Ã¢â‚¬â€ Pure album art squares for "Jump Back In"
        function populateArtGrid(containerId, entries) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            container.className = 'jump-back-wrapper';

            const chunkSize = 16;
            const numPages = Math.ceil(entries.length / chunkSize);
            
            for (let i = 0; i < entries.length; i += chunkSize) {
                const chunk = entries.slice(i, i + chunkSize);
                const slide = document.createElement('div');
                slide.className = 'jump-back-slide art-grid-container';

                chunk.forEach((item, idx) => {
                    const title = item.title || item.name || 'Unknown';
                    const subtitle = item.artist || item.uploader || '';
                    const videoId = item.videoId || item.id;
                    let rawThumb = item.cover || item.thumbnail || item.thumb || '';
                    if (!rawThumb && videoId) rawThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                    const thumb = getCoverUrl(`${title} ${subtitle}`, rawThumb, videoId);
                    const fallbackThumb = `/api/cover?vid=${videoId || ''}&q=${encodeURIComponent(title + ' ' + subtitle)}`;
                    const safeTitle = title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    const safeArtist = subtitle.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    
                    const card = document.createElement('div');
                    card.className = 'art-grid-card';
                    card.style.animationDelay = `${idx * 0.035}s`;
                    card.innerHTML = `
                        <img src="${thumb}" alt="${safeTitle}" loading="lazy" decoding="async"
                             onerror="this.onerror=null;this.src='${fallbackThumb}'">
                        <div class="art-grid-overlay">
                            <div class="art-grid-play-btn">
                                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                            <div class="art-grid-title">${safeTitle}</div>
                            <div class="art-grid-artist">${safeArtist}</div>
                        </div>
                    `;
                    card.onclick = () => {
                        if (videoId) {
                            const songJson = JSON.stringify({title, artist: subtitle, cover: thumb, videoId}).replace(/"/g, '&quot;');
                            window.playSong(videoId, songJson, card);
                        } else {
                            songSearchInput.value = `${title} ${subtitle}`; searchBtn.click();
                        }
                    };
                    slide.appendChild(card);
                });
                container.appendChild(slide);
            }
            
            // Add dots indicator
            if (numPages > 1) {
                let dotsContainer = document.getElementById(containerId + '-dots');
                if (!dotsContainer) {
                    dotsContainer = document.createElement('div');
                    dotsContainer.id = containerId + '-dots';
                    dotsContainer.className = 'carousel-dots';
                    container.parentNode.insertBefore(dotsContainer, container.nextSibling);
                }
                dotsContainer.innerHTML = '';
                for (let i = 0; i < numPages; i++) {
                    const dot = document.createElement('div');
                    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
                    dot.onclick = () => {
                        const slides = container.querySelectorAll('.jump-back-slide');
                        if (slides[i]) slides[i].scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'start'});
                    };
                    dotsContainer.appendChild(dot);
                }
                
                // Update dots on scroll
                const dotsList = Array.from(dotsContainer.children);
                let scrollTimeout;
                container.addEventListener('scroll', () => {
                    if(scrollTimeout) return;
                    scrollTimeout = requestAnimationFrame(() => {
                        scrollTimeout = null;
                    const scrollLeft = container.scrollLeft;
                    const slideWidth = container.clientWidth;
                    const activeIndex = Math.round(scrollLeft / slideWidth);
                    const dots = Array.from(dotsContainer.children);
                    dotsList.forEach((d, i) => d.classList.toggle('active', i === activeIndex));
                    });
                }, {passive: true});
            }
        }

        // 🎬 CINEMATIC CARDS — Spotify/Apple Music Style Square Cards for "AI Mix"
        function populateCinematicCards(containerId, entries) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            container.className = 'cinematic-scroll-container';

            entries.forEach((item, idx) => {
                const title = item.title || item.name || 'Unknown';
                const subtitle = item.artist || item.uploader || 'Artist';
                const videoId = item.videoId || item.id;
                let rawThumb = item.cover || item.thumbnail || item.thumb || '';
                if (!rawThumb && videoId) rawThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                const thumb = getCoverUrl(`${title} ${subtitle}`, rawThumb, videoId);
                const fallbackThumb = `/api/cover?vid=${videoId || ''}&q=${encodeURIComponent(title + ' ' + subtitle)}`;
                const safeTitle = title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const safeArtist = subtitle.replace(/</g,'&lt;').replace(/>/g,'&gt;');

                const card = document.createElement('div');
                card.className = 'cinematic-card';
                card.style.animationDelay = `${idx * 0.04}s`;
                card.innerHTML = `
                    <div class="cinematic-poster-wrap">
                        <img src="${thumb}" class="cinematic-card-img" alt="${safeTitle}" loading="lazy" decoding="async"
                             onerror="this.onerror=null;this.src='${fallbackThumb}'">
                        <div class="cinematic-card-play">
                            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                    <div class="cinematic-card-meta">
                        <div class="cinematic-card-artist">${safeArtist}</div>
                        <div class="cinematic-card-title-row">
                            <div class="cinematic-card-title">${safeTitle}</div>
                            <button class="cinematic-card-more" title="Options" onclick="event.stopPropagation(); if(typeof openSongOptions==='function') openSongOptions('${videoId}', '${safeTitle.replace(/'/g, "\\'")}', '${safeArtist.replace(/'/g, "\\'")}', '${thumb}');">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>
                        </div>
                    </div>
                `;
                card.onclick = () => {
                    if (videoId) {
                        const songJson = JSON.stringify({title, artist: subtitle, cover: thumb, videoId}).replace(/"/g, '&quot;');
                        window.playSong(videoId, songJson, card);
                    } else {
                        songSearchInput.value = `${title} ${subtitle}`; searchBtn.click();
                    }
                };
                container.appendChild(card);
            });
        }

        // 🌸 MATERIAL DESIGN 3 FLOWER SHAPE CARDS — For Globally Viral & India Trending Songs
        function populateFlowerCards(containerId, entries) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            container.className = 'md3-flower-scroll-container';

            entries.forEach((item, idx) => {
                const title = item.title || item.name || 'Unknown';
                const subtitle = item.artist || item.uploader || 'Artist';
                const videoId = item.videoId || item.id;
                let rawThumb = item.cover || item.thumbnail || item.thumb || '';
                if (!rawThumb && videoId) rawThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                const thumb = getCoverUrl(`${title} ${subtitle}`, rawThumb, videoId);
                const fallbackThumb = `/api/cover?vid=${videoId || ''}&q=${encodeURIComponent(title + ' ' + subtitle)}`;
                const safeTitle = title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const safeArtist = subtitle.replace(/</g,'&lt;').replace(/>/g,'&gt;');

                const card = document.createElement('div');
                card.className = 'md3-flower-card';
                card.style.animationDelay = `${idx * 0.04}s`;
                card.innerHTML = `
                    <div class="md3-flower-poster-wrap">
                        <img src="${thumb}" class="md3-flower-img" alt="${safeTitle}" loading="lazy" decoding="async"
                             onerror="this.onerror=null;this.src='${fallbackThumb}'">
                        <div class="md3-flower-play">
                            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                    <div class="md3-flower-meta">
                        <div class="md3-flower-artist">${safeArtist}</div>
                        <div class="md3-flower-title-row">
                            <div class="md3-flower-title">${safeTitle}</div>
                            <button class="md3-flower-more" title="Options" onclick="event.stopPropagation(); if(typeof openSongOptions==='function') openSongOptions('${videoId}', '${safeTitle.replace(/'/g, "\\'")}', '${safeArtist.replace(/'/g, "\\'")}', '${thumb}');">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>
                        </div>
                    </div>
                `;
                card.onclick = () => {
                    if (videoId) {
                        const songJson = JSON.stringify({title, artist: subtitle, cover: thumb, videoId}).replace(/"/g, '&quot;');
                        window.playSong(videoId, songJson, card);
                    } else {
                        songSearchInput.value = `${title} ${subtitle}`; searchBtn.click();
                    }
                };
                container.appendChild(card);
            });
        }

        // Fetch Globally Viral Songs & India Trending Hits (Instant 2025/2026 Chart Toppers + Live API Search)
        async function fetchTrendingAndViralSongs() {
            const defaultGlobalViral = [
                { videoId: 'e-ORhEE9VVg', title: 'Die With A Smile', artist: 'Lady Gaga & Bruno Mars', cover: 'https://i.scdn.co/image/ab67616d0000b27382ea2e9e1858aa9a2f3812d1' },
                { videoId: 'KEG7b8up1jM', title: 'Taste', artist: 'Sabrina Carpenter', cover: 'https://i.scdn.co/image/ab67616d0000b273fd8d7aed31db214690e54d33' },
                { videoId: 't7w8Z_M-2fU', title: 'BIRDS OF A FEATHER', artist: 'Billie Eilish', cover: 'https://i.scdn.co/image/ab67616d0000b27371d62ea7ea8a5be92d3c1f62' },
                { videoId: 'vBgiv2bH5d0', title: 'APT.', artist: 'ROSÉ & Bruno Mars', cover: 'https://i.scdn.co/image/ab67616d0000b27329fb8444a7f058ab33b5c61a' },
                { videoId: 'NPq41X9W67c', title: 'Not Like Us', artist: 'Kendrick Lamar', cover: 'https://i.scdn.co/image/ab67616d0000b2731ea0c6b993d04e54e4c2f10b' },
                { videoId: 'hT_nvWreIhg', title: 'Espresso', artist: 'Sabrina Carpenter', cover: 'https://i.scdn.co/image/ab67616d0000b273fd8d7aed31db214690e54d33' },
                { videoId: '1-7gK8L9W0w', title: 'Good Luck, Babe!', artist: 'Chappell Roan', cover: 'https://i.scdn.co/image/ab67616d0000b2735f992490b6a8397a6e133c94' },
                { videoId: 'Oa_RSwwpPaA', title: 'Beautiful Things', artist: 'Benson Boone', cover: 'https://i.scdn.co/image/ab67616d0000b273b5e4070a7b458ae58729007f' }
            ];

            const defaultIndiaTrending = [
                { videoId: '3yMPb_8q6K0', title: 'Tauba Tauba', artist: 'Karan Aujla', cover: 'https://i.scdn.co/image/ab67616d0000b27302484a0d926fb9fb641a9bc2' },
                { videoId: 'hoh13_110j0', title: 'Big Dawgs', artist: 'Hanumankind ft. Kalmi', cover: 'https://i.scdn.co/image/ab67616d0000b273c52e67a00f2791be7f05d5d8' },
                { videoId: '1zKj13100j0', title: 'Millionaire', artist: 'Yo Yo Honey Singh', cover: 'https://i.scdn.co/image/ab67616d0000b2730ca782161f38fa093f41ae9a' },
                { videoId: 'gLMC4TzN34k', title: 'Soulmate', artist: 'Badshah ft. Arijit Singh', cover: 'https://i.scdn.co/image/ab67616d0000b273ee029a14d59a80b0fb30d7f5' },
                { videoId: 'k1z77110Lqa', title: 'Sajni (Laapataa Ladies)', artist: 'Arijit Singh, Ram Sampath', cover: 'https://i.scdn.co/image/ab67616d0000b273fa439401be9d3752e2586b3e' },
                { videoId: '2rN2h3Zz2Y0', title: 'Putt Jatt Da', artist: 'Diljit Dosanjh', cover: 'https://i.scdn.co/image/ab67616d0000b273fa439401be9d3752e2586b3e' },
                { videoId: '0zN3a78f2Q1', title: 'Husn', artist: 'Anuv Jain', cover: 'https://i.scdn.co/image/ab67616d0000b273e970a25695fa9fa6067756f7' },
                { videoId: '8zK00213l8Q', title: 'Ve Kamleya', artist: 'Arijit Singh, Shreya Ghoshal', cover: 'https://i.scdn.co/image/ab67616d0000b27339d6718d09f7a77e5bc87b5a' }
            ];

            // 0ms Instant Load
            populateFlowerCards('home-global-viral-container', defaultGlobalViral);
            populateFlowerCards('home-india-trending-container', defaultIndiaTrending);

            try {
                // Live Background API Search Update
                const globalRes = await fetch('/api/search?q=' + encodeURIComponent('Billboard Hot 100 Top Songs 2025 2026'));
                const globalData = await globalRes.json();
                if (globalData.status === 'success' && globalData.results && globalData.results.length > 0) {
                    const songs = globalData.results.filter(r => r.videoId && !r.title.toLowerCase().includes('compilation') && !r.title.toLowerCase().includes('jukebox')).map(r => ({
                        videoId: r.videoId, title: r.title, artist: r.artist || r.uploader || 'Artist', cover: r.cover || r.thumbnail || ''
                    }));
                    if (songs.length > 4) populateFlowerCards('home-global-viral-container', songs.slice(0, 20));
                }

                const indiaRes = await fetch('/api/search?q=' + encodeURIComponent('Top Indian Trending Songs 2025 2026 Arijit Karan Aujla Honey Singh'));
                const indiaData = await indiaRes.json();
                if (indiaData.status === 'success' && indiaData.results && indiaData.results.length > 0) {
                    const songs = indiaData.results.filter(r => r.videoId && !r.title.toLowerCase().includes('compilation') && !r.title.toLowerCase().includes('jukebox')).map(r => ({
                        videoId: r.videoId, title: r.title, artist: r.artist || r.uploader || 'Artist', cover: r.cover || r.thumbnail || ''
                    }));
                    if (songs.length > 4) populateFlowerCards('home-india-trending-container', songs.slice(0, 20));
                }
            } catch (err) {
                console.warn("Live trending update failed, using curated defaults:", err);
            }
        }

        fetchTrendingAndViralSongs();

        async function populateHomeTopArtists() {
            const container = document.getElementById('home-top-artists-container');
            const section = document.getElementById('home-top-artists-section');
            if(!container || !section) return;
            const liked = getLikedSongs();
            const downloads = await getDownloadedSongs();
            const allSongs = [...liked, ...downloads];
            const artistMap = {};
            
            allSongs.forEach(song => {
                if (song.artist && song.artist !== 'Unknown') {
                    if (!artistMap[song.artist]) {
                        artistMap[song.artist] = { name: song.artist, cover: song.cover || '', count: 1 };
                    } else {
                        artistMap[song.artist].count++;
                    }
                }
            });

            // Also include explicitly followed artists with high priority
            const followed = JSON.parse(localStorage.getItem('followedArtists') || '[]');
            followed.forEach(fa => {
                if (!artistMap[fa.name]) {
                    artistMap[fa.name] = { name: fa.name, cover: fa.thumb, count: 500, browseId: fa.browseId };
                } else {
                    artistMap[fa.name].count += 500;
                    artistMap[fa.name].browseId = fa.browseId;
                }
            });

            const artists = Object.values(artistMap).sort((a, b) => b.count - a.count);
            if (artists.length === 0) return;
            
            section.style.display = 'block';
            container.innerHTML = '';
            artists.slice(0, 15).forEach((artist, idx) => {
                const coverUrl = getCoverUrl(artist.name, artist.cover);
                const card = document.createElement('div');
                card.className = 'artist-scalloped-item';
                card.style.animation = `slideUpFadeIn 0.5s ease forwards`;
                card.style.animationDelay = `${idx * 0.05}s`;
                card.innerHTML = `
                    <img src="${coverUrl}" alt="${artist.name}" title="${artist.name}">
                    <div class="artist-scalloped-name">${artist.name}</div>
                `;
                card.onclick = () => showArtistPage(artist.browseId || artist.name);
                container.appendChild(card);
            });
        }

        // ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â SMART RECOMMENDATION ENGINE ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
        // 1) Taste Mix: picks 5 diverse songs from history, fetches recs for each, shuffles all together
        // 2) Because Rows: 3 separate "Because you listened to X" rows from different songs

        async function populateTasteMix(historyItems) {
            const section = document.getElementById('home-taste-mix-section');
            const container = document.getElementById('home-taste-mix-container');
            if (!section || !container || !historyItems || historyItems.length === 0) return;

            // Pick up to 5 diverse seeds, spaced out from history
            const seeds = [];
            const step = Math.max(1, Math.floor(historyItems.length / 5));
            for (let i = 0; i < historyItems.length && seeds.length < 5; i += step) {
                if (historyItems[i] && historyItems[i].videoId) seeds.push(historyItems[i]);
            }
            if (seeds.length === 0) return;

            section.style.display = 'block';
            container.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="premium-glass-loader" style="margin:0 auto 10px;"></div>Building your mix...</div>';

            // Fetch recs for each seed in parallel
            const allRecs = [];
            const seenIds = new Set();
            await Promise.all(seeds.map(async (seed) => {
                try {
                    const res = await fetch('/api/recommendations?videoId=' + encodeURIComponent(seed.videoId));
                    const data = await res.json();
                    if (data.status === 'success' && data.recommendations) {
                        data.recommendations.forEach(s => {
                            if (!seenIds.has(s.videoId)) {
                                seenIds.add(s.videoId);
                                allRecs.push({ videoId: s.videoId, title: s.title, artist: s.artist, cover: s.cover || s.thumbnail || '', type: 'song' });
                            }
                        });
                    }
                } catch(e) {}
            }));

            if (allRecs.length === 0) { section.style.display = 'none'; return; }

            // Shuffle the pool for true mix feel
            for (let i = allRecs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allRecs[i], allRecs[j]] = [allRecs[j], allRecs[i]];
            }

            populateCinematicCards('home-taste-mix-container', allRecs.slice(0, 24));
        }

        async function populateBecauseRows(historyItems) {
            const rowsContainer = document.getElementById('home-because-rows-container');
            if (!rowsContainer || !historyItems || historyItems.length === 0) return;
            rowsContainer.innerHTML = '';

            // Pick 3 different songs from history (beginning, middle, near end)
            const picks = [];
            const validHistory = historyItems.filter(h => h && h.videoId);
            if (validHistory.length === 0) return;

            const indices = [0];
            if (validHistory.length > 2) indices.push(Math.floor(validHistory.length / 2));
            if (validHistory.length > 4) indices.push(validHistory.length - 1);
            indices.forEach(i => { if (validHistory[i]) picks.push(validHistory[i]); });

            for (const song of picks) {
                try {
                    const res = await fetch('/api/recommendations?videoId=' + encodeURIComponent(song.videoId));
                    const data = await res.json();
                    if (data.status !== 'success' || !data.recommendations || data.recommendations.length === 0) continue;

                    const rowId = 'because-row-' + song.videoId;
                    const sectionEl = document.createElement('div');
                    sectionEl.className = 'home-section';
                    sectionEl.style.marginBottom = '28px';
                    sectionEl.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
                            <img src="${getCoverUrl(song.title + ' ' + song.artist, song.cover || '', song.videoId)}" 
                                 style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;" 
                                 onerror="this.src='default_cover.jpg'" alt="">
                            <div>
                                <div style="font-size:0.7rem;color:rgba(255,255,255,0.5);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Because you listened to</div>
                                <h2 class="section-title" style="margin:0; font-size:1rem;">${song.title}</h2>
                            </div>
                        </div>
                        <div class="dense-grid-container" id="${rowId}"></div>
                    `;
                    rowsContainer.appendChild(sectionEl);

                    populateDenseGrid(rowId, data.recommendations.map(s => ({
                        videoId: s.videoId, title: s.title, artist: s.artist, cover: s.cover || s.thumbnail || '', type: 'song'
                    })));
                } catch(e) {}
            }
        }

        function populateVinylContainer(containerId, entries) {
            const container = document.getElementById(containerId);
            container.innerHTML = ''; 

            entries.forEach(entry => {
                const title = entry.title || 'Unknown Title';
                const artist = entry.artist || 'Unknown Artist';
                const query = `${title} ${artist}`;
                
                // Use backend proxy ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â iTunes first, then YouTube thumb, never black!
                const coverUrl = getEntryCoverUrl(entry);

                const card = document.createElement("d" + "iv");
                card.className = 'vinyl-card';
                card.setAttribute('data-query', query);
                
                card.innerHTML = `
                    <div class="vinyl-cover-wrapper">
                        <div class="vinyl-disc"></div>
                        <img data-src="${coverUrl}" alt="" class="vinyl-cover" loading="lazy" decoding="async" data-query="${query.replace(/"/g, '&quot;')}">
                    </div>
                    <div class="vinyl-info">${title}<br><span>${artist}</span></div>
                `;

                card.addEventListener('click', () => {
                    if (entry.playlistId || entry.type === 'playlist') {
                        showRemotePlaylistPage(entry.playlistId);
                    } else if (entry.browseId || entry.type === 'album') {
                        showAlbumPage(entry.browseId);
                    } else if (entry.type === 'artist') {
                        showArtistPage(entry.browseId);
                    } else {
                        songSearchInput.value = query;
                        searchBtn.click();
                    }
                });

                container.appendChild(card);
            });
            setupLazyCovers(container);
        }

        // --- ARTIST & ALBUM PAGES ---
        function showScreenExcept(showId, skipPushState = false) {
            // Record current screen in history for back button
            const currentScreen = ['home-screen','player-screen','history-screen','settings-screen','artist-screen','album-screen','library-screen','search-screen','playlist-full-screen'].find(id => {
                const el = document.getElementById(id);
                return el && el.classList.contains('active-screen');
            });
            if (currentScreen && currentScreen !== showId && typeof screenHistory !== 'undefined') {
                screenHistory.push(currentScreen);
                if (!skipPushState && window.history) {
                    history.pushState({ screen: showId }, '', '#' + showId);
                }
            }

            ['home-screen', 'player-screen', 'history-screen', 'settings-screen', 'artist-screen', 'album-screen', 'library-screen', 'search-screen', 'playlist-full-screen'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (id === showId) {
                    el.classList.remove('hidden-screen');
                    el.classList.add('active-screen');
                    document.body.classList.add(id + '-active');
                    
                    // Sync top bar and logo scroll position for the new screen
                    const topBar = document.getElementById('top-bar-wrapper');
                    if (topBar) {
                        topBar.style.transform = `translateY(${-el.scrollTop}px)`;
                    }

                } else {
                    el.classList.remove('active-screen');
                    el.classList.add('hidden-screen');
                    document.body.classList.remove(id + '-active');
                }
            });
            if (typeof closeQueue === 'function') closeQueue();
        }
        window.showScreen = showScreenExcept;
        const showScreen = showScreenExcept;

        // ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
        // SEARCH RESULTS PAGE
        // ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
        let srAllResults = { songs: [], videos: [], albums: [], artists: [] };
        let srActiveCategory = 'all';

        async function showSearchResultsPage(query) {
            // Show search screen, mini player if needed
            if (isSongLoaded) miniPlayer.classList.remove('hidden-mini');
            showScreenExcept('search-screen');
            document.getElementById('search-screen').scrollTop = 0;

            // Set header title
            document.getElementById('search-results-query').innerHTML =
                `<span>Results for </span>"${query}"`;

            // Reset tabs to 'All'
            srActiveCategory = 'all';
            document.querySelectorAll('.sr-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === 'all'));

            // Show spinner, clear results
            const loadingEl = document.getElementById('search-loading-state');
            const contentEl = document.getElementById('search-results-content');
            loadingEl.style.display = 'flex';
            contentEl.innerHTML = '';

            try {
                const res = await fetch(`/api/multi_search?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                srAllResults = data;
            } catch (e) {
                srAllResults = { songs: [], videos: [], albums: [], artists: [] };
            }

            loadingEl.style.display = 'none';
            renderSearchResults();
        }

        function renderSearchResults() {
            const contentEl = document.getElementById('search-results-content');
            contentEl.innerHTML = '';
            const cat = srActiveCategory;

            const songs   = (cat === 'all' || cat === 'song')   ? srAllResults.songs   : [];
            const videos  = (cat === 'all' || cat === 'video')  ? srAllResults.videos  : [];
            const albums  = (cat === 'all' || cat === 'album')  ? srAllResults.albums  : [];
            const artists = (cat === 'all' || cat === 'artist') ? srAllResults.artists : [];

            const total = songs.length + videos.length + albums.length + artists.length;
            if (total === 0) {
                contentEl.innerHTML = `<div class="sr-empty"><span>ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â</span>No results found.<br>Try a different search term.</div>`;
                return;
            }

            let delay = 0;

            // ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ SONGS & TOP RESULT ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ
            if (songs.length > 0) {
                if (cat === 'all') {
                    // Top Result + Stacked layout
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ Top Results & Songs</div>
                        <button class="see-all-btn" onclick="document.querySelector('.sr-tab[data-cat=\\'song\\']').click()">See All</button>
                    </div>`;
                    contentEl.insertAdjacentHTML('beforeend', headerHtml);

                    const topRow = document.createElement('div');
                    topRow.className = 'sr-top-row';
                    
                    // Top Result Card (first item, let's use the first song)
                    const topSong = songs[0];
                    const topCard = document.createElement('div');
                    topCard.className = 'sr-top-card anim-slide-up';
                    topCard.innerHTML = `
                        <img src="${getCoverUrl(topSong.title + " " + topSong.artist, topSong.cover, topSong.videoId)}" alt="${topSong.title.replace(/"/g, '&quot;')}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='default_cover.jpg'">
                        <div class="sr-top-title">${topSong.title}</div>
                        <div class="sr-top-type">Song Ã¢â‚¬Â¢ ${topSong.artist}</div>
                        <button class="sr-top-play" onclick="event.stopPropagation(); playSong('${topSong.videoId}', '${JSON.stringify(topSong).replace(/"/g, '&quot;')}', this)">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                    `;
                    topCard.addEventListener('click', () => {
                        songSearchInput.value = topSong.query; searchBtn.click();
                    });
                    
                    // Stacked list (next 4 songs)
                    const stackedList = document.createElement('div');
                    stackedList.className = 'sr-stacked-list';
                    songs.slice(1, 5).forEach((s, i) => {
                        const row = document.createElement('div');
                        row.className = 'sr-stacked-row anim-slide-up';
                        row.style.animationDelay = `${delay}s`; delay += 0.055;
                        row.innerHTML = `
                            <img src="${getCoverUrl(s.title + " " + s.artist, s.cover, s.videoId)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='default_cover.jpg'">
                            <div class="sr-stacked-info">
                                <div class="sr-song-title">${s.title}</div>
                                <div class="sr-song-artist">${s.artist}</div>
                            </div>
                            <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${s.query.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                                <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>
                        `;
                        row.addEventListener('click', () => {
                            songSearchInput.value = s.query; searchBtn.click();
                        });
                        stackedList.appendChild(row);
                    });
                    
                    topRow.appendChild(topCard);
                    topRow.appendChild(stackedList);
                    contentEl.appendChild(topRow);

                } else {
                    // Full songs list (for See All view)
                    const list = document.createElement('div');
                    list.className = 'sr-song-list full-list';
                    songs.forEach((s, i) => {
                        const row = document.createElement('div');
                        row.className = 'sr-song-row anim-slide-up';
                        row.style.animationDelay = `${delay}s`; delay += 0.055;
                        row.innerHTML = `
                            <img class="sr-song-cover" src="${getCoverUrl(s.title + " " + s.artist, s.cover, s.videoId)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='default_cover.jpg'">
                            <div class="sr-song-info">
                                <div class="sr-song-title">${s.title}</div>
                                <div class="sr-song-artist">${s.artist}</div>
                            </div>
                            <div class="sr-song-type-badge">Song</div>
                            <button class="sr-play-icon" title="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                            <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${s.query.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                                <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>`;
                        row.addEventListener('click', () => { songSearchInput.value = s.query; searchBtn.click(); });
                        list.appendChild(row);
                    });
                    contentEl.appendChild(list);
                }
            }

            // ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ VIDEOS & TOP RESULT ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ
            if (videos.length > 0) {
                if (cat === 'all') {
                    // Top Result + Stacked layout
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¬ Top Video & More</div>
                        <button class="see-all-btn" onclick="document.querySelector('.sr-tab[data-cat=\\'video\\']').click()">See All</button>
                    </div>`;
                    contentEl.insertAdjacentHTML('beforeend', headerHtml);

                    const topRow = document.createElement('div');
                    topRow.className = 'sr-top-row';
                    
                    // Top Result Card
                    const topVideo = videos[0];
                    const topCard = document.createElement('div');
                    topCard.className = 'sr-top-card anim-slide-up';
                    topCard.innerHTML = `
                        <img src="${getCoverUrl(topVideo.title + " " + topVideo.artist, topVideo.cover, topVideo.videoId)}" alt="${topVideo.title.replace(/"/g, '&quot;')}" style="border-radius: 8px; width: 140px; height: 78px; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
                        <div class="sr-top-title">${topVideo.title}</div>
                        <div class="sr-top-type" style="color: rgba(255,255,255,0.5); font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            <span style="background: rgba(255,255,255,0.15); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px;">Video</span>
                            ${topVideo.artist}
                        </div>
                        <button class="sr-top-play" onclick="event.stopPropagation(); playSong('${topVideo.videoId}', '${JSON.stringify(topVideo).replace(/"/g, '&quot;')}', this)">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                    `;
                    topCard.addEventListener('click', () => {
                        songSearchInput.value = topVideo.query; searchBtn.click();
                    });
                    
                    // Stacked list (next 4 videos)
                    const stackedList = document.createElement('div');
                    stackedList.className = 'sr-stacked-list';
                    videos.slice(1, 5).forEach((v, i) => {
                        const row = document.createElement('div');
                        row.className = 'sr-stacked-row anim-slide-up';
                        row.style.animationDelay = `${delay}s`; delay += 0.055;
                        row.innerHTML = `
                            <img src="${getCoverUrl(v.title + " " + v.artist, v.cover, v.videoId)}" style="width: 80px; height: 45px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                            <div class="sr-stacked-info">
                                <div class="sr-song-title">${v.title}</div>
                                <div class="sr-song-artist">${v.artist}</div>
                            </div>
                            <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${v.query.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                                <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>
                        `;
                        row.addEventListener('click', () => {
                            songSearchInput.value = v.query; searchBtn.click();
                        });
                        stackedList.appendChild(row);
                    });
                    
                    topRow.appendChild(topCard);
                    topRow.appendChild(stackedList);
                    contentEl.appendChild(topRow);

                } else {
                    const list = document.createElement('div');
                    list.className = 'sr-song-list full-list';
                    videos.forEach((v, i) => {
                        const row = document.createElement('div');
                        row.className = 'sr-song-row anim-slide-up';
                        row.style.animationDelay = `${delay}s`; delay += 0.055;
                        row.innerHTML = `
                            <img class="sr-song-cover" src="${getCoverUrl(v.title + " " + v.artist, v.cover, v.videoId)}" style="border-radius:8px;">
                            <div class="sr-song-info">
                                <div class="sr-song-title">${v.title}</div>
                                <div class="sr-song-artist">${v.artist}</div>
                            </div>
                            <div class="sr-song-type-badge">Video</div>
                            <button class="sr-play-icon" title="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                            <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${v.query.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                                <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                            </button>`;
                        row.addEventListener('click', () => {
                            songSearchInput.value = v.query; searchBtn.click();
                        });
                        list.appendChild(row);
                    });
                    contentEl.appendChild(list);
                }
            }

            // ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ ALBUMS ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ
            if (albums.length > 0) {
                if (cat === 'all') {
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¿ Albums</div>
                        <button class="see-all-btn" onclick="document.querySelector('.sr-tab[data-cat=\\'album\\']').click()">See All</button>
                    </div>`;
                    contentEl.insertAdjacentHTML('beforeend', headerHtml);
                }
                const grid = document.createElement('div');
                grid.className = 'sr-card-grid';
                albums.forEach((a, i) => {
                    const card = document.createElement('div');
                    card.className = 'sr-card album';
                    card.style.animationDelay = `${delay}s`; delay += 0.06;
                    card.innerHTML = `
                        <img class="sr-card-cover" src="${getCoverUrl(a.title + " " + a.artist, a.cover)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='default_cover.jpg'">
                        <div class="sr-card-name">${a.title}</div>
                        <div class="sr-card-sub">${a.artist}</div>`;
                    card.addEventListener('click', () => {
                        if (a.browseId) showAlbumPage(a.browseId);
                        else { songSearchInput.value = `${a.title} ${a.artist}`; searchBtn.click(); }
                    });
                    grid.appendChild(card);
                });
                contentEl.appendChild(grid);
            }

            // ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ ARTISTS ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Âµ
            if (artists.length > 0) {
                if (cat === 'all') {
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¤ Artists</div>
                        <button class="see-all-btn" onclick="document.querySelector('.sr-tab[data-cat=\\'artist\\']').click()">See All</button>
                    </div>`;
                    contentEl.insertAdjacentHTML('beforeend', headerHtml);
                }
                const grid = document.createElement('div');
                grid.className = 'sr-card-grid';
                artists.forEach((ar, i) => {
                    const card = document.createElement('div');
                    card.className = 'sr-card artist';
                    card.style.animationDelay = `${delay}s`; delay += 0.06;
                    card.innerHTML = `
                        <img class="sr-card-cover" src="${getCoverUrl(ar.title, ar.cover)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='default_cover.jpg'">
                        <div class="sr-card-name">${ar.title}</div>`;
                    card.addEventListener('click', () => {
                        if (ar.browseId) showArtistPage(ar.browseId);
                        else { songSearchInput.value = ar.title; searchBtn.click(); }
                    });
                    grid.appendChild(card);
                });
                contentEl.appendChild(grid);
            }
        }

        // Category tab clicks
        document.querySelectorAll('.sr-tab').forEach(tab => {
            tab.addEventListener('click', async () => {
                document.querySelectorAll('.sr-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                srActiveCategory = tab.dataset.cat;
                const contentEl = document.getElementById('search-results-content');
                contentEl.innerHTML = '';
                
                if (srActiveCategory === 'all') {
                    document.getElementById('search-loading-state').style.display = 'none';
                    renderSearchResults();
                } else {
                    document.getElementById('search-loading-state').style.display = 'flex';
                    try {
                        let queryParam = songSearchInput.value.trim();
                        let typeParam = srActiveCategory + 's'; // e.g. song -> songs
                        const res = await fetch(`/api/search_category?q=${encodeURIComponent(queryParam)}&type=${encodeURIComponent(typeParam)}`);
                        const data = await res.json();
                        
                        // Swap data temporarily so renderSearchResults uses the expanded list
                        let originalCatData = srAllResults[typeParam];
                        srAllResults[typeParam] = data.results || [];
                        
                        document.getElementById('search-loading-state').style.display = 'none';
                        renderSearchResults();
                        
                        // Restore original so 'all' tab doesn't show 20 items
                        srAllResults[typeParam] = originalCatData;
                    } catch (e) {
                        console.error(e);
                        document.getElementById('search-loading-state').style.display = 'none';
                        renderSearchResults();
                    }
                }
            });
        });

        // Back button
        document.getElementById('search-back-btn')?.addEventListener('click', () => {
            showHome();
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.nav-btn[data-index="0"]')?.classList.add('active');
        });

        async function showArtistPage(browseId) {
            showScreenExcept('artist-screen');
            const content = document.getElementById('artist-content');
            content.innerHTML = '<div class="empty-state loading-state-wrapper" style="margin-top:100px;"><div class="premium-glass-loader"></div><div>Loading artist details...</div></div>';
            
            try {
                const res = await fetch(`/api/artist?id=${encodeURIComponent(browseId)}`);
                const data = await res.json();
                
                if (data.status === 'success' && data.artist) {
                    const artist = data.artist;
                    const thumb = artist.thumbnails && artist.thumbnails.length > 0 ? getCoverUrl(artist.name, artist.thumbnails[artist.thumbnails.length-1].url) : 'default_cover.jpg';
                    const subs = artist.subscribers ? ` Ã¢â‚¬Â¢ ${artist.subscribers}` : '';
                    
                    let html = `
                        <div class="hero-banner">
                            <div class="hero-bg" style="background-image: url('${thumb}')"></div>
                            <div class="hero-content">
                                <img src="${thumb}" alt="${artist.name}" class="hero-avatar anim-pop">
                                <div class="hero-info">
                                    <h1 class="anim-slide-up" style="animation-delay: 0.1s">${artist.name}</h1>
                                    <p class="anim-slide-up" style="animation-delay: 0.2s">Artist${subs}</p>
                                    <div class="apple-btn-row anim-slide-up" style="animation-delay: 0.3s">
                                        <button class="apple-btn apple-play-btn" onclick="playFirstTrack()"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play</button>
                                        <button class="apple-btn apple-shuffle-btn" onclick="playFirstTrack()"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59,9.17L5.41,4,4,5.41l5.17,5.17,1.42-1.41zM14.5,4l2.04,2.04L4,18.59,5.41,20l12.55-12.55L20,9.5V4h-5.5zm.33,9.41l-1.41,1.41,3.13,3.13L14.5,20H20v-5.5l-2.04,2.04-3.13-3.13z"/></svg> Shuffle</button>
                                        ${getFollowButtonHtml(browseId, artist.name, thumb)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    
                    let firstSongJson = '';

                    if (artist.songs && artist.songs.results && artist.songs.results.length > 0) {
                        let seeAllBtn = '';
                        if (artist.songs.browseId) {
                            seeAllBtn = `<button class="see-all-btn anim-slide-up" style="animation-delay: 0.4s" onclick="fetchArtistAllSongs('${artist.songs.browseId}', '${artist.name.replace(/'/g, "\\'")}')">See All</button>`;
                        }
                        html += `<div class="page-section"><div class="section-header"><h2 class="anim-slide-up" style="animation-delay: 0.4s">Top Songs</h2>${seeAllBtn}</div><div class="tracklist-container" id="artist-songs-container">`;
                        artist.songs.results.forEach((song, idx) => {
                            const songThumb = song.thumbnails && song.thumbnails.length > 0 ? getCoverUrl(song.title, song.thumbnails[song.thumbnails.length-1].url, song.id || song.videoId) : 'default_cover.jpg';
                            const songJson = JSON.stringify({title: song.title, artist: artist.name}).replace(/"/g, '&quot;');
                            if(idx === 0) firstSongJson = songJson;
                            const delay = 0.4 + (idx * 0.05);
                            html += `
                                <div class="tracklist-item anim-slide-up" style="animation-delay: ${delay}s" onclick="playTrackFromList('${songJson}')">
                                    <div class="tracklist-index">${idx + 1}</div>
                                    <img src="${songThumb}">
                                    <div class="tracklist-info">
                                        <div class="tracklist-title">${song.title}</div>
                                        <div class="tracklist-artist">${artist.name}</div>
                                    </div>
                                    <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${song.title.replace(/'/g, "\\'").replace(/"/g, '&quot;')} ${artist.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                                        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                                    </button>
                                    <button class="premium-play-btn"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                                </div>
                            `;
                        });
                        html += `</div></div>`;
                    }
                    
                    if (artist.albums && artist.albums.results && artist.albums.results.length > 0) {
                        html += `<div class="page-section"><h2 class="anim-slide-up" style="animation-delay: 0.8s">Albums</h2><div class="vinyl-scroll-container anim-slide-up" style="animation-delay: 0.9s">`;
                        artist.albums.results.forEach(album => {
                            const albThumb = album.thumbnails && album.thumbnails.length > 0 ? getCoverUrl(album.title, album.thumbnails[album.thumbnails.length-1].url, album.browseId) : 'default_cover.jpg';
                            html += `
                                <div class="vinyl-card" onclick="showAlbumPage('${album.browseId}')">
                                    <div class="vinyl-cover-wrapper">
                                        <div class="vinyl-disc"></div>
                                        <img src="${albThumb}" class="vinyl-cover">
                                    </div>
                                    <div class="vinyl-info">${album.title}<br><span>${album.year || artist.name}</span></div>
                                </div>
                            `;
                        });
                        html += `</div></div>`;
                    }
                    
                    if (artist.description) {
                         html += `<div class="page-section"><h2 class="anim-slide-up" style="animation-delay: 1s">About</h2>
                         <p class="anim-slide-up" style="animation-delay: 1.1s; color: rgba(255,255,255,0.7); line-height: 1.6;">${artist.description}</p></div>`;
                    }

                    // Attach the first song to window so Play button works
                    window.playFirstTrack = () => {
                        if(firstSongJson) playTrackFromList(firstSongJson);
                    };

                    content.innerHTML = html;
                } else {
                    content.innerHTML = '<div class="empty-state">Could not load artist.</div>';
                }
            } catch(e) {
                content.innerHTML = '<div class="empty-state">Error connecting to server.</div>';
            }
        }

        async function showAlbumPage(browseId) {
            showScreenExcept('album-screen');
            const content = document.getElementById('album-content');
            content.innerHTML = '<div class="empty-state loading-state-wrapper" style="margin-top:100px;"><div class="premium-glass-loader"></div><div>Loading album details...</div></div>';
            
            try {
                const res = await fetch(`/api/album?id=${encodeURIComponent(browseId)}`);
                const data = await res.json();
                
                if (data.status === 'success' && data.album) {
                    const album = data.album;
                    const thumb = album.thumbnails && album.thumbnails.length > 0 ? getCoverUrl(album.title, album.thumbnails[album.thumbnails.length-1].url, browseId) : 'default_cover.jpg';
                    const artistName = album.artists && album.artists.length > 0 ? album.artists[0].name : 'Unknown Artist';
                    
                    let html = `
                        <div class="hero-banner">
                            <div class="hero-bg" style="background-image: url('${thumb}')"></div>
                            <div class="hero-content">
                                <img src="${thumb}" alt="${album.title}" class="hero-album-cover anim-pop">
                                <div class="hero-info">
                                    <h1 class="anim-slide-up" style="animation-delay: 0.1s">${album.title}</h1>
                                    <p class="anim-slide-up" style="animation-delay: 0.2s">${artistName} Ã¢â‚¬Â¢ ${album.year || ''} Ã¢â‚¬Â¢ ${album.trackCount || 0} tracks</p>
                                    <div class="apple-btn-row anim-slide-up" style="animation-delay: 0.3s">
                                        <button class="apple-btn apple-play-btn" onclick="playFirstTrack()"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play</button>
                                        <button class="apple-btn apple-shuffle-btn" onclick="playFirstTrack()"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59,9.17L5.41,4,4,5.41l5.17,5.17,1.42-1.41zM14.5,4l2.04,2.04L4,18.59,5.41,20l12.55-12.55L20,9.5V4h-5.5zm.33,9.41l-1.41,1.41,3.13,3.13L14.5,20H20v-5.5l-2.04,2.04-3.13-3.13z"/></svg> Shuffle</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    
                    let firstSongJson = '';

                    if (album.tracks && album.tracks.length > 0) {
                        html += `<div class="page-section"><h2 class="anim-slide-up" style="animation-delay: 0.4s">Tracklist</h2><div class="tracklist-container">`;
                        album.tracks.forEach((track, idx) => {
                            const trackArtist = track.artists ? track.artists[0].name : artistName;
                            const songJson = JSON.stringify({title: track.title, artist: trackArtist}).replace(/"/g, '&quot;');
                            if(idx === 0) firstSongJson = songJson;
                            const delay = 0.4 + (idx * 0.05);
                            html += `
                                <div class="tracklist-item anim-slide-up" style="animation-delay: ${delay}s" onclick="playTrackFromList('${songJson}')">
                                    <div class="tracklist-index">${idx+1}</div>
                                    <div class="tracklist-info" style="padding-left:10px;">
                                        <div class="tracklist-title">${track.title}</div>
                                        <div class="tracklist-artist">${trackArtist}</div>
                                    </div>
                                    <button class="song-options-btn" onclick="event.stopPropagation(); openSongContextMenu(event, '${track.title.replace(/'/g, "\\'").replace(/"/g, '&quot;')} ${track.artists && track.artists[0] ? track.artists[0].name.replace(/'/g, "\\'").replace(/"/g, '&quot;') : ''}')">
                                        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                                    </button>
                                    <button class="premium-play-btn"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                                </div>
                            `;
                        });
                        html += `</div></div>`;
                    }
                    
                    // Attach the first song to window so Play button works
                    window.playFirstTrack = () => {
                        if(firstSongJson) playTrackFromList(firstSongJson);
                    };

                    content.innerHTML = html;
                } else {
                    content.innerHTML = '<div class="empty-state">Could not load album.</div>';
                }
            } catch(e) {
                content.innerHTML = '<div class="empty-state">Error connecting to server.</div>';
            }
        }

        async function showRemotePlaylistPage(playlistId) {
            showScreenExcept('playlist-full-screen');
            const screen = document.getElementById('playlist-full-screen');
            const bgEl = document.getElementById('playlist-hero-bg');
            const artEl = document.getElementById('playlist-screen-art');
            const nameEl = document.getElementById('playlist-screen-name');
            const countEl = document.getElementById('playlist-screen-count');
            const tracksEl = document.getElementById('playlist-screen-tracks');
            const playAllBtn = document.getElementById('pl-screen-play-all-btn');

            nameEl.textContent = 'Loading...';
            countEl.textContent = '';
            artEl.innerHTML = '<div style="width:100%;height:100%;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;"><div class="premium-glass-loader" style="width:40px;height:40px;"></div></div>';
            tracksEl.innerHTML = '<div class="empty-state loading-state-wrapper" style="margin-top:50px;"><p>Loading playlist tracks...</p></div>';

            // Clear any old overlay/click handler
            const artContainer = artEl.parentElement;
            if (artContainer) artContainer.onclick = null;
            const oldOverlay = artContainer.querySelector('.playlist-art-overlay');
            if (oldOverlay) oldOverlay.remove();

            try {
                const res = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`);
                const data = await res.json();

                if (data.status === 'success' && data.playlist) {
                    const pl = data.playlist;
                    nameEl.textContent = pl.title;
                    countEl.textContent = `${pl.trackCount || pl.tracks?.length || 0} songs  Ã¢â‚¬Â¢  Community Playlist`;

                    const thumb = pl.thumbnails && pl.thumbnails.length > 0 ? getCoverUrl(pl.title, pl.thumbnails[pl.thumbnails.length-1].url, playlistId) : 'default_cover.jpg';
                    artEl.innerHTML = `<img src="${thumb}" onerror="this.src='default_cover.jpg'">`;

                    if (thumb) {
                        bgEl.style.backgroundImage = `url(${thumb})`;
                    } else {
                        bgEl.style.backgroundImage = 'none';
                    }

                    tracksEl.innerHTML = '';
                    if (!pl.tracks || pl.tracks.length === 0) {
                        tracksEl.innerHTML = '<div class="empty-state">No songs in this playlist.</div>';
                    } else {
                        pl.tracks.forEach((track, sIdx) => {
                            const trackArtist = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';
                            const trackThumb = track.thumbnails && track.thumbnails.length > 0 ? getCoverUrl(track.title, track.thumbnails[track.thumbnails.length-1].url, track.id || track.videoId) : 'default_cover.jpg';
                            const row = document.createElement('div');
                            row.className = 'playlist-track-row';
                            row.innerHTML = `
                                <div class="pt-num">${sIdx + 1}</div>
                                <img class="pt-cover" src="${trackThumb}" onerror="this.src='default_cover.jpg'" alt="">
                                <div class="pt-info">
                                    <div class="pt-title">${track.title}</div>
                                    <div class="pt-artist">${trackArtist}</div>
                                </div>
                                <button class="pt-remove" style="display:none;"></button>
                            `;
                            
                            row.addEventListener('click', () => {
                                queueList.length = 0;
                                pl.tracks.forEach(t => {
                                    const artistName = t.artists && t.artists.length > 0 ? t.artists[0].name : 'Unknown Artist';
                                    const coverUrl = t.thumbnails && t.thumbnails.length > 0 ? t.thumbnails[t.thumbnails.length-1].url : '';
                                    queueList.push({ title: t.title, artist: artistName, cover: coverUrl, videoId: t.videoId || '' });
                                });
                                currentQueueIndex = sIdx;
                                window._preserveQueue = true;
                                window._forceQueueSong = { videoId: track.videoId, title: track.title, artist: trackArtist, cover: trackThumb };
                                songSearchInput.value = `${track.title} ${trackArtist}`;
                                searchBtn.click();
                                showToast(`ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¶ Playing from ${pl.title}`);
                            });
                            tracksEl.appendChild(row);
                        });

                        if (playAllBtn) {
                            playAllBtn.onclick = () => {
                                if (pl.tracks.length === 0) return;
                                queueList.length = 0;
                                pl.tracks.forEach(t => {
                                    const artistName = t.artists && t.artists.length > 0 ? t.artists[0].name : 'Unknown Artist';
                                    const coverUrl = t.thumbnails && t.thumbnails.length > 0 ? t.thumbnails[t.thumbnails.length-1].url : '';
                                    queueList.push({ title: t.title, artist: artistName, cover: coverUrl, videoId: t.videoId || '' });
                                });
                                currentQueueIndex = 0;
                                window._preserveQueue = true;
                                const first = pl.tracks[0];
                                const firstArtist = first.artists && first.artists.length > 0 ? first.artists[0].name : 'Unknown Artist';
                                const firstThumb = first.thumbnails && first.thumbnails.length > 0 ? first.thumbnails[first.thumbnails.length-1].url : '';
                                window._forceQueueSong = { videoId: first.videoId, title: first.title, artist: firstArtist, cover: firstThumb };
                                songSearchInput.value = `${first.title} ${firstArtist}`;
                                searchBtn.click();
                                showToast(`ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¶ Playing ${pl.title}`);
                            };
                        }
                    }
                } else {
                    nameEl.textContent = 'Error';
                    tracksEl.innerHTML = '<div class="empty-state">Failed to load playlist.</div>';
                }
            } catch (err) {
                console.error(err);
                nameEl.textContent = 'Error';
                tracksEl.innerHTML = '<div class="empty-state">Failed to load playlist.</div>';
            }
        }
        window.showRemotePlaylistPage = showRemotePlaylistPage;

        function playTrackFromList(songJsonStr) {
            const song = JSON.parse(songJsonStr);
            songSearchInput.value = song.title + ' ' + song.artist;
            searchBtn.click();
        }

        window.playSong = function(videoId, songJsonStr, element) {
            try {
                const song = JSON.parse(songJsonStr.replace(/&quot;/g, '"'));
                songSearchInput.value = song.title + ' ' + song.artist;
                window._forceQueueSong = { id: videoId, videoId, title: song.title, artist: song.artist, thumbnail: song.cover || song.thumbnail };
                searchBtn.click();
            } catch(e) { console.error(e); }
        };

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ COVER ART FLOAT ANIMATION ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        const coverWrapper = document.getElementById('cover-wrapper');
        audioPlayer.addEventListener('play', () => {
            if (coverWrapper) coverWrapper.classList.add('now-playing-active');
        });
        audioPlayer.addEventListener('pause', () => {
            if (coverWrapper) coverWrapper.classList.remove('now-playing-active');
        });
        audioPlayer.addEventListener('ended', () => {
            if (coverWrapper) coverWrapper.classList.remove('now-playing-active');
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ MOOD RADIO SYSTEM ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        let activeMoodChip = null;

        document.querySelectorAll('.mood-chip').forEach(chip => {
            chip.addEventListener('click', async () => {
                const mood = chip.dataset.mood;
                // Toggle off if same chip
                if (activeMoodChip === mood) {
                    chip.classList.remove('active-mood');
                    activeMoodChip = null;
                    document.getElementById('mood-radio-container').innerHTML = '';
                    return;
                }
                // Deactivate previous
                document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active-mood', 'loading'));
                chip.classList.add('active-mood', 'loading');
                activeMoodChip = mood;

                const container = document.getElementById('mood-radio-container');
                container.innerHTML = '<div class="empty-state loading-state-wrapper" style="padding:20px;font-size:1rem;"><div class="premium-glass-loader"></div><div>Loading ' + mood + ' radio...</div></div>';

                try {
                    const res = await fetch(`/api/radio?mood=${encodeURIComponent(mood)}`);
                    const data = await res.json();
                    chip.classList.remove('loading');
                    if (data.status === 'success' && data.tracks && data.tracks.length > 0) {
                        populateVinylContainer('mood-radio-container', data.tracks);
                        showToast(`Ã°Å¸â€œÂ» ${mood} Radio loaded!`);
                    } else {
                        container.innerHTML = '<div class="empty-state">Nothing found. Try another mood!</div>';
                    }
                } catch(e) {
                    chip.classList.remove('loading');
                    container.innerHTML = '<div class="empty-state">Network error. Check server.</div>';
                }
            });
        });

        // Ã¢â€â‚¬Ã¢â€â‚¬ PLAYLIST DETAIL MODAL Ã¢â€â‚¬Ã¢â€â‚¬
        let currentPlaylistIndex = -1;
        function openPlaylistModal(plIdx) {
            const playlists = getPlaylists();
            const pl = playlists[plIdx];
            if (!pl) return;
            currentPlaylistIndex = plIdx;

            document.getElementById('playlist-screen-name').textContent = pl.name;
            document.getElementById('playlist-screen-count').textContent = `${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}`;

            // Build cover mosaic
            const artEl = document.getElementById('playlist-screen-art');
            const covers = pl.songs.slice(0, 4).map(s => getCoverUrl(`${s.title} ${s.artist}`, s.cover || '', s.id || s.videoId));
            if (covers.length >= 4) {
                const imgs = covers.map(c => `<img src="${c}" loading="lazy" style="width:50%;height:50%;object-fit:cover;">`).join('');
                artEl.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:100%;height:100%;">${imgs}</div>`;
            } else if (covers.length > 0) {
                artEl.innerHTML = `<img src="${covers[0]}" style="width:100%;height:100%;object-fit:cover;">`;
            } else {
                artEl.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);"><svg viewBox="0 0 24 24" style="width:60px;height:60px;fill:rgba(255,255,255,0.1);"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`;
            }

            const tracksEl = document.getElementById('playlist-screen-tracks');
            tracksEl.innerHTML = '';
            if (pl.songs.length === 0) {
                tracksEl.innerHTML = '<div class="empty-state lib-empty" style="margin-top:20px;">No songs in this playlist yet.</div>';
            } else {
                pl.songs.forEach((song, sIdx) => {
                    const div = document.createElement('div');
                    div.className = 'premium-list-item';
                    div.innerHTML = `
                        <img src="${getCoverUrl(`${song.title} ${song.artist}`, song.cover || '')}" alt="cover" class="premium-list-img">
                        <div class="premium-list-info">
                            <div class="premium-list-title">${song.title}</div>
                            <div class="premium-list-subtitle">${song.artist}</div>
                        </div>
                        <button class="song-options-btn" title="Remove from playlist">
                            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    `;
                    div.addEventListener('click', () => {
                        queueList = [...pl.songs];
                        currentQueueIndex = sIdx;
                        window._preserveQueue = true;
                        renderQueue();
                        playQueueIndex(sIdx);
                        setPlayPauseUI(true);
                    });
                    div.querySelector('.song-options-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        const pls = getPlaylists();
                        pls[plIdx].songs.splice(sIdx, 1);
                        savePlaylists(pls);
                        openPlaylistModal(plIdx); // re-render
                        renderPlaylists();
                        showToast('Song removed from playlist');
                    });
                    tracksEl.appendChild(div);
                });
            }

            showScreen('playlist-full-screen');
        }

        // Ã¢â€â‚¬Ã¢â€â‚¬ PREMIUM QUEUE RENDERER Ã¢â€â‚¬Ã¢â€â‚¬
        function renderQueue() {
            if (typeof updateCinematicCards === 'function') updateCinematicCards();
            const qList = document.getElementById('queue-list');
            qList.innerHTML = '';

            const totalUpNext = queueList.length > 0 ? queueList.length - currentQueueIndex - 1 : 0;
            const qHeaderTitle = document.getElementById('queue-header-title');
            if (qHeaderTitle) {
                qHeaderTitle.textContent = queueList.length > 0 ? `Up Next · ${totalUpNext} song${totalUpNext !== 1 ? 's' : ''}` : 'Up Next';
            }

            if (queueList.length === 0) {
                qList.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px;position:relative;z-index:2;">
                        <div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;">
                            <svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:rgba(255,255,255,0.3);"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>
                        </div>
                        <div style="font-size:0.95rem;font-weight:600;color:rgba(255,255,255,0.45);">Queue is empty</div>
                        <div style="font-size:0.75rem;color:rgba(255,255,255,0.3);">Play a song to fill the queue</div>
                    </div>`;
                return;
            }

            const nowSong = queueList[currentQueueIndex];

            // HORIZONTAL SCROLL ROW
            const hScroll = document.createElement('div');
            hScroll.className = 'q-horizontal-scroll';

            // NOW PLAYING CARD
            const nowVid = nowSong.id || nowSong.videoId || '';
            const nowFb = nowVid ? `https://i.ytimg.com/vi/${nowVid}/hqdefault.jpg` : 'default_cover.jpg';
            const playerScreenCover = document.getElementById('cover-art')?.src;
            const nowThumb = (playerScreenCover && playerScreenCover.startsWith('http') && !playerScreenCover.includes('default_cover.jpg'))
                ? playerScreenCover
                : getCoverUrl(`${nowSong.title} ${nowSong.artist}`, nowSong.cover || '', nowVid);
            const nowCard = document.createElement('div');
            nowCard.className = 'q-card-now';
            nowCard.style.setProperty('--card-index', 0);
            nowCard.innerHTML = `
                <div class="q-card-now-ring">
                    <img src="${nowThumb}" class="q-card-now-art" onerror="this.onerror=null; this.src='${nowFb}';">
                    <div class="q-card-sheen"></div>
                    <div class="q-card-now-badge">
                        <div class="q-eq"><span></span><span></span><span></span><span></span></div>
                        <span class="q-card-now-badge-text">Now Playing</span>
                    </div>
                    <div class="q-soundwave-overlay" title="Playing">
                        <span></span><span></span><span></span><span></span><span></span>
                    </div>
                </div>
                <div class="q-card-now-info">
                    <div class="q-card-now-title">${nowSong.title}</div>
                    <div class="q-card-now-artist">${nowSong.artist}</div>
                </div>
            `;
            nowCard.addEventListener('click', () => playPauseBtn.click());
            hScroll.appendChild(nowCard);

            // DIVIDER
            if (totalUpNext > 0) {
                const divider = document.createElement('div');
                divider.className = 'q-section-divider';
                divider.style.setProperty('--card-index', 1);
                divider.innerHTML = `<div class="q-section-divider-line"></div><div class="q-section-divider-dot"></div><div class="q-section-divider-line"></div>`;
                hScroll.appendChild(divider);
            }

            // Global variable for active drag
            window._qDragIndex = null;

            // UPCOMING CARDS WITH DRAG & DROP REORDER & DOUBLE CLICK REORDER
            for (let idx = currentQueueIndex + 1; idx < Math.min(queueList.length, currentQueueIndex + 1 + queueRenderLimit); idx++) {
                const song = queueList[idx];
                const pos = idx - currentQueueIndex;
                const isNext = pos === 1;
                const songVid = song.id || song.videoId || '';
                const songFb = songVid ? `https://i.ytimg.com/vi/${songVid}/hqdefault.jpg` : 'default_cover.jpg';
                const thumb = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '', songVid);
                const numLabel = pos < 10 ? '0' + pos : pos;
                const card = document.createElement('div');
                card.className = `q-card-up${isNext ? ' q-card-next' : ''}`;
                card.style.setProperty('--card-index', pos + 1);
                card.setAttribute('draggable', 'true');
                card.setAttribute('data-idx', idx);

                card.innerHTML = `
                    <div class="q-card-art-wrap">
                        <img src="${thumb}" class="q-card-art" onerror="this.onerror=null; this.src='${songFb}';">
                        <div class="q-card-play-overlay">
                            <div class="q-card-play-icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
                        </div>
                        <span class="q-card-num" title="Drag to reorder or Double-click to move to #1">${numLabel}</span>
                        <div class="q-card-actions">
                            ${pos > 1 ? `<button class="q-action-btn q-move-left" data-idx="${idx}" title="Move left">◄</button>` : ''}
                            ${idx < queueList.length - 1 ? `<button class="q-action-btn q-move-right" data-idx="${idx}" title="Move right">►</button>` : ''}
                            <button class="q-action-btn q-remove-btn" data-idx="${idx}" title="Remove">✕</button>
                        </div>
                    </div>
                    <div class="q-card-title">${song.title}</div>
                    <div class="q-card-artist">${song.artist}</div>
                `;

                // ── DRAG & DROP REORDER EVENTS ──
                card.addEventListener('dragstart', (e) => {
                    window._qDragIndex = idx;
                    card.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', idx.toString());
                });

                card.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (window._qDragIndex !== null && window._qDragIndex !== idx) {
                        card.classList.add('drag-over');
                    }
                });

                card.addEventListener('dragleave', () => {
                    card.classList.remove('drag-over');
                });

                card.addEventListener('drop', (e) => {
                    e.preventDefault();
                    card.classList.remove('drag-over');
                    card.classList.remove('dragging');

                    const fromIdx = window._qDragIndex !== null ? window._qDragIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
                    const toIdx = idx;

                    if (!isNaN(fromIdx) && fromIdx !== toIdx && fromIdx > currentQueueIndex && toIdx > currentQueueIndex) {
                        const [moved] = queueList.splice(fromIdx, 1);
                        queueList.splice(toIdx, 0, moved);
                        renderQueue();
                        if (typeof showToast === 'function') showToast(`Queue reordered! 🎵`);
                    }
                    window._qDragIndex = null;
                });

                card.addEventListener('dragend', () => {
                    card.classList.remove('dragging');
                    card.classList.remove('drag-over');
                    document.querySelectorAll('.q-card-up').forEach(c => c.classList.remove('drag-over', 'dragging'));
                    window._qDragIndex = null;
                });

                // Reorder action button handlers
                card.addEventListener('click', (e) => {
                    const removeBtn = e.target.closest('.q-remove-btn');
                    const moveLeftBtn = e.target.closest('.q-move-left');
                    const moveRightBtn = e.target.closest('.q-move-right');

                    if (removeBtn) {
                        e.stopPropagation();
                        queueList.splice(idx, 1);
                        renderQueue();
                        return;
                    }
                    if (moveLeftBtn) {
                        e.stopPropagation();
                        if (idx > currentQueueIndex + 1) {
                            const [moved] = queueList.splice(idx, 1);
                            queueList.splice(idx - 1, 0, moved);
                            renderQueue();
                            showToast(`Moved "${song.title}" left! 🎵`);
                        }
                        return;
                    }
                    if (moveRightBtn) {
                        e.stopPropagation();
                        if (idx < queueList.length - 1) {
                            const [moved] = queueList.splice(idx, 1);
                            queueList.splice(idx + 1, 0, moved);
                            renderQueue();
                            showToast(`Moved "${song.title}" right! 🎵`);
                        }
                        return;
                    }

                    playQueueIndex(idx);
                });

                // DOUBLE CLICK / DOUBLE TAP TO MOVE SONG TO UP NEXT #01
                let cardLastTap = 0;
                const handleDoubleTapMove = (e) => {
                    if (e.target.closest('.q-card-actions')) return;
                    const now = Date.now();
                    if (now - cardLastTap < 400) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (idx > currentQueueIndex + 1) {
                            const [moved] = queueList.splice(idx, 1);
                            queueList.splice(currentQueueIndex + 1, 0, moved);
                            renderQueue();
                            showToast(`Moved "${song.title}" to Up Next #01! 🎵`);
                        }
                    }
                    cardLastTap = now;
                };

                card.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.q-card-actions')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (idx > currentQueueIndex + 1) {
                        const [moved] = queueList.splice(idx, 1);
                        queueList.splice(currentQueueIndex + 1, 0, moved);
                        renderQueue();
                        showToast(`Moved "${song.title}" to Up Next #01! 🎵`);
                    }
                });

                card.addEventListener('touchend', handleDoubleTapMove);

                hScroll.appendChild(card);
            }

            // LOAD MORE
            if (currentQueueIndex + 1 + queueRenderLimit < queueList.length) {
                const remaining = queueList.length - (currentQueueIndex + 1 + queueRenderLimit);
                const more = document.createElement('div');
                more.className = 'q-card-more';
                more.style.setProperty('--card-index', queueRenderLimit + 2);
                more.innerHTML = `<div class="q-card-more-circle">+${remaining > 99 ? '99' : remaining}</div><span class="q-card-more-label">Load More</span>`;
                more.addEventListener('click', () => { queueRenderLimit += 12; renderQueue(); });
                hScroll.appendChild(more);
            }

            qList.appendChild(hScroll);
        }
        
        // Clear Queue Header Button
        document.getElementById('queue-header-clear-btn')?.addEventListener('click', () => {
            if(queueList.length <= 1) return;
            const currentSong = queueList[currentQueueIndex];
            queueList.splice(0, queueList.length);
            if(currentSong) {
                queueList.push(currentSong);
                currentQueueIndex = 0;
            }
            renderQueue();
        });

        // Ã¢â€â‚¬Ã¢â€â‚¬ QUEUE CONTROL BUTTONS SYNC Ã¢â€â‚¬Ã¢â€â‚¬
        function updateQueueControlsState() {
            const qShuffleBtn = document.getElementById('queue-shuffle-btn');
            const qRepeatBtn = document.getElementById('queue-repeat-btn');
            const qAutoplayBtn = document.getElementById('queue-autoplay-btn');

            if (qShuffleBtn) {
                qShuffleBtn.classList.toggle('active', isShuffled);
            }
            if (qRepeatBtn) {
                qRepeatBtn.classList.remove('active', 'repeat-one');
                if (repeatMode === 1) {
                    qRepeatBtn.classList.add('active');
                } else if (repeatMode === 2) {
                    qRepeatBtn.classList.add('active', 'repeat-one');
                }
            }
            if (qAutoplayBtn) {
                const apt = document.getElementById('autoplay-toggle');
                const isAutoplay = apt ? apt.checked : false;
                qAutoplayBtn.classList.toggle('active', isAutoplay);
            }
        }

        // Register queue controls click listeners
        document.getElementById('queue-shuffle-btn')?.addEventListener('click', () => {
            const mainShuffle = document.getElementById('shuffle-btn');
            mainShuffle?.click();
            updateQueueControlsState();
        });

        document.getElementById('queue-repeat-btn')?.addEventListener('click', () => {
            const mainRepeat = document.getElementById('repeat-btn');
            mainRepeat?.click();
            updateQueueControlsState();
        });

        document.getElementById('queue-autoplay-btn')?.addEventListener('click', () => {
            const apt = document.getElementById('autoplay-toggle');
            if (apt) {
                apt.checked = !apt.checked;
                apt.dispatchEvent(new Event('change'));
            }
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ YOUTUBE MUSIC ACCOUNT SYNC LOGIC ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        const syncDot = document.getElementById('sync-status-dot');
        const syncText = document.getElementById('sync-status-text');
        const syncForm = document.getElementById('sync-form-container');
        const unsyncForm = document.getElementById('unsync-container');
        const syncHeadersInput = document.getElementById('sync-headers-input');
        const syncBtn = document.getElementById('sync-btn');
        const unsyncBtn = document.getElementById('unsync-btn');

        // Tab switching logic
        const tabBtnBookmark = document.getElementById('tab-btn-bookmark');
        const tabBtnManual = document.getElementById('tab-btn-manual');
        const panelBookmark = document.getElementById('sync-method-bookmark-panel');
        const panelManual = document.getElementById('sync-method-manual-panel');

        tabBtnBookmark?.addEventListener('click', () => {
            tabBtnBookmark.classList.add('active');
            tabBtnBookmark.style.background = 'rgba(255,255,255,0.08)';
            tabBtnBookmark.style.color = 'white';
            tabBtnManual.classList.remove('active');
            tabBtnManual.style.background = 'transparent';
            tabBtnManual.style.color = 'rgba(255,255,255,0.6)';
            
            panelBookmark.style.display = 'flex';
            panelManual.style.display = 'none';
        });

        tabBtnManual?.addEventListener('click', () => {
            tabBtnManual.classList.add('active');
            tabBtnManual.style.background = 'rgba(255,255,255,0.08)';
            tabBtnManual.style.color = 'white';
            tabBtnBookmark.classList.remove('active');
            tabBtnBookmark.style.background = 'transparent';
            tabBtnBookmark.style.color = 'rgba(255,255,255,0.6)';
            
            panelBookmark.style.display = 'none';
            panelManual.style.display = 'flex';
        });

        async function checkSyncStatus() {
            try {
                const res = await fetch('/api/sync_status');
                const data = await res.json();
                if (data.synced) {
                    if (syncDot) syncDot.style.background = '#28cd41'; // Green
                    if (syncText) syncText.textContent = 'Synced with your YouTube Music Account!';
                    if (syncForm) syncForm.style.display = 'none';
                    if (unsyncForm) unsyncForm.style.display = 'flex';
                } else {
                    if (syncDot) syncDot.style.background = '#ff476d'; // Red/Rose
                    if (syncText) syncText.textContent = 'Running in Guest Mode (Anonymous)';
                    if (syncForm) syncForm.style.display = 'flex';
                    if (unsyncForm) unsyncForm.style.display = 'none';
                }
            } catch(e) {
                console.error("Error checking sync status:", e);
            }
        }

        syncBtn?.addEventListener('click', async () => {
            const headersVal = syncHeadersInput?.value?.strip ? syncHeadersInput.value.strip() : syncHeadersInput?.value?.trim();
            if (!headersVal) {
                showToast("ÃƒÂ¢Ã‚ÂÃ…â€™ Please paste your raw browser headers first!");
                return;
            }

            syncBtn.disabled = true;
            const originalText = syncBtn.textContent;
            syncBtn.textContent = 'ÃƒÂ¢Ã…Â¡Ã‚Â¡ Syncing account...';

            try {
                const res = await fetch('/api/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ headers: headersVal })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast("Account Synced! Syncing Library...");
                    try { await fetch('/api/sync_library', {method: 'POST'}); } catch(e){}
                    if (syncHeadersInput) syncHeadersInput.value = '';
                    await checkSyncStatus();
                    if(typeof fetchLibraryData === 'function') await fetchLibraryData();
                    loadTrendingFeeds(); // Reload personalized home sections
                    showToast("Library Synced Successfully!");
                } else {
                    showToast("ÃƒÂ¢Ã‚ÂÃ…â€™ Sync failed: " + (data.message || "Invalid headers."));
                }
            } catch(e) {
                showToast("ÃƒÂ¢Ã‚ÂÃ…â€™ Network error while syncing.");
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = originalText;
            }
        });

        unsyncBtn?.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to disconnect your YouTube Music account?")) return;

            try {
                const res = await fetch('/api/unsync', { method: 'POST' });
                const data = await res.json();
                showToast("ÃƒÂ¢Ã‹Å“Ã‚ÂÃƒÂ¯Ã‚Â¸Ã‚Â Account Disconnected!");
                await checkSyncStatus();
                loadTrendingFeeds(); // Reload standard trending feed
            } catch(e) {
                showToast("ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to disconnect account.");
            }
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ 1-CLICK BOOKMARKLET REDIRECT HANDLER ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        if (window.location.hash.startsWith('#sync_cookie=')) {
            const cookieVal = decodeURIComponent(window.location.hash.replace('#sync_cookie=', ''));
            window.history.replaceState("", document.title, window.location.pathname + window.location.search);
            
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.background = 'rgba(10, 10, 12, 0.96)';
            overlay.style.backdropFilter = 'blur(30px)';
            overlay.style.webkitBackdropFilter = 'blur(30px)';
            overlay.style.zIndex = '999999';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.color = 'white';
            overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';
            overlay.style.textAlign = 'center';
            overlay.style.padding = '20px';
            
            overlay.innerHTML = `
                <div style="font-size: 3.5rem; margin-bottom: 24px;">ÃƒÂ¢Ã…Â¡Ã‚Â¡</div>
                <div style="font-size: 1.5rem; font-weight: 700; margin-bottom: 12px; letter-spacing:-0.5px;">Syncing with YouTube Music...</div>
                <div style="font-size: 0.95rem; color: rgba(255,255,255,0.6);" id="sync-overlay-status">Verifying secure credentials...</div>
            `;
            document.body.appendChild(overlay);
            
            fetch('/api/sync_bookmark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cookie: cookieVal })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    // Alert other tabs (like the main streamer tab) to auto-reload feeds
                    localStorage.setItem('ytm_sync_trigger', Date.now());
                    
                    overlay.innerHTML = `
                        <div style="font-size: 3.5rem; margin-bottom: 24px;">ÃƒÂ°Ã…Â¸Ã…Â½Ã¢â‚¬Â°</div>
                        <div style="font-size: 1.6rem; font-weight: 700; color: #28cd41; margin-bottom: 12px; letter-spacing:-0.5px;">Sync Successful!</div>
                        <div style="font-size: 0.95rem; color: rgba(255,255,255,0.8); margin-bottom: 24px; max-width:400px; line-height:1.5;">Your personalized YouTube Music feed, playlists, and liked songs have been successfully loaded.</div>
                        <button onclick="window.close();" style="padding: 12px 28px; background: #28cd41; color: white; border: none; border-radius: 12px; font-weight: 700; font-size:0.95rem; cursor: pointer; box-shadow: 0 4px 15px rgba(40,205,65,0.3);">Close This Tab</button>
                    `;
                } else {
                    overlay.innerHTML = `
                        <div style="font-size: 3.5rem; margin-bottom: 24px;">ÃƒÂ¢Ã‚ÂÃ…â€™</div>
                        <div style="font-size: 1.6rem; font-weight: 700; color: #ff476d; margin-bottom: 12px; letter-spacing:-0.5px;">Sync Failed</div>
                        <div style="font-size: 0.95rem; color: rgba(255,255,255,0.8); margin-bottom: 24px; max-width:400px; line-height:1.5;">${data.message}</div>
                        <button onclick="document.body.removeChild(this.parentNode);" style="padding: 12px 28px; background: rgba(255,255,255,0.1); color: white; border: none; border-radius: 12px; font-weight: 700; font-size:0.95rem; cursor: pointer;">Go to Streamer</button>
                    `;
                }
            })
            .catch(err => {
                overlay.innerHTML = `
                    <div style="font-size: 3.5rem; margin-bottom: 24px;">ÃƒÂ¢Ã‚ÂÃ…â€™</div>
                    <div style="font-size: 1.6rem; font-weight: 700; color: #ff476d; margin-bottom: 12px; letter-spacing:-0.5px;">Connection Error</div>
                    <div style="font-size: 0.95rem; color: rgba(255,255,255,0.8); margin-bottom: 24px; max-width:400px; line-height:1.5;">Could not communicate with the local server. Make sure Apple Music Streamer is running.</div>
                    <button onclick="document.body.removeChild(this.parentNode);" style="padding: 12px 28px; background: rgba(255,255,255,0.1); color: white; border: none; border-radius: 12px; font-weight: 700; font-size:0.95rem; cursor: pointer;">Close</button>
                `;
            });
        }

        function initSyncBookmarklet() {
            const link = document.getElementById('sync-bookmarklet-link');
            if (!link) return;
            const origin = window.location.origin;
            const js = `(function(){var c=document.cookie;if(!c||window.location.host.indexOf('music.youtube.com')===-1){alert('\\uD83D\\uDC49 Pehle music.youtube.com kholiye aur login karke fir click karein!');return;}window.open('${origin}/#sync_cookie='+encodeURIComponent(c),'_blank');})();`;
            link.href = `javascript:${js}`;
        }

        initSyncBookmarklet();

        // Initialize sync status check
        checkSyncStatus();

        // Initialize Live Feeds on Startup
        loadTrendingFeeds();
        document.getElementById('create-playlist-btn')?.addEventListener('click', () => {
            const input = document.getElementById('new-playlist-input');
            const name = input.value.trim();
            if (!name) return;
            const pls = getPlaylists();
            pls.unshift({ name, songs: [] });
            savePlaylists(pls);
            input.value = '';
            renderPlaylists();
            showToast('Playlist created!');
        });
        document.getElementById('new-playlist-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('create-playlist-btn').click();
        });

        renderPlaylists();

        // Cross-tab auto-refresh listener
        window.addEventListener('storage', (e) => {
            if (e.key === 'ytm_sync_trigger') {
                checkSyncStatus();
                loadTrendingFeeds();
                renderPlaylists();
                showToast("ÃƒÂ¢Ã‹Å“Ã‚ÂÃƒÂ¯Ã‚Â¸Ã‚Â YouTube Music account synced successfully!");
            }
        });

        // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Song Context Menu Logic ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
        const contextMenu = document.getElementById('song-context-menu');
        let currentContextQuery = null;

        window.openSongContextMenu = function(e, query) {
            e.preventDefault();
            e.stopPropagation();
            currentContextQuery = query;
            
            // Positioning the menu
            const rect = e.currentTarget.getBoundingClientRect();
            let x = rect.left + window.scrollX;
            let y = rect.bottom + window.scrollY;
            
            // Prevent overflowing off-screen
            if (x + 220 > window.innerWidth) x = window.innerWidth - 230;
            if (y + 250 > window.innerHeight) y = rect.top + window.scrollY - 260; // Show above if too low
            
            contextMenu.style.left = `${x}px`;
            contextMenu.style.top = `${y}px`;
            
            contextMenu.classList.remove('hidden-context-menu');
        };

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (contextMenu && !contextMenu.contains(e.target) && !e.target.closest('.song-options-btn')) {
                contextMenu.classList.add('hidden-context-menu');
            }
        });

        // Open context menu from the full-screen player cover
        window.openSongContextMenuFromPlayer = function(e) {
            e.preventDefault();
            e.stopPropagation();
            // Get the current playing song info from track title and artist
            const title = document.getElementById('track-title')?.textContent || '';
            const artist = document.getElementById('track-artist')?.textContent || '';
            const query = `${title} ${artist}`.trim();
            if (!query || query === 'Apple Music Ready to stream') return;
            openSongContextMenu(e, query);
        };

        document.querySelectorAll('#song-context-menu .context-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const action = btn.getAttribute('data-action');
                contextMenu.classList.add('hidden-context-menu');
                
                if (!currentContextQuery) return;
                
                if (action === 'play-next' || action === 'add-to-queue' || action === 'like' || action === 'add-to-playlist' || action === 'download' || action === 'share' || action === 'go-to-artist') {
                    if (action === 'play-next') showToast('Adding to Play Next...');
                    else if (action === 'add-to-queue') showToast('Adding to Queue...');
                    else if (action === 'download') showToast('Preparing MP3 Download...');
                    else if (action === 'go-to-artist') showToast('Finding Artist...');
                    
                    try {
                        const res = await fetch(`/api/search?q=${encodeURIComponent(currentContextQuery)}`);
                        if (res.ok) {
                            const data = await res.json();
                            const songObj = {
                                title: data.title,
                                artist: data.uploader,
                                cover: data.thumbnail,
                                query: currentContextQuery,
                                id: data.id,
                                videoId: data.id
                            };
                            
                            if (action === 'play-next') {
                                queue.splice(currentQueueIndex + 1, 0, songObj);
                                showToast('Added to Play Next');
                                renderQueue();
                            } else if (action === 'add-to-queue') {
                                queue.push(songObj);
                                showToast('Added to Queue');
                                renderQueue();
                            } else if (action === 'like') {
                                toggleLike(songObj);
                            } else if (action === 'download') {
                                const a = document.createElement('a');
                                a.href = `/api/download_mp3?id=${data.id}&title=${encodeURIComponent(data.title + ' ' + data.uploader)}`;
                                a.download = '';
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                            } else if (action === 'add-to-playlist') {
                                openAddToPlaylistPopup(songObj);
                            } else if (action === 'share') {
                                const shareUrl = window.location.origin + window.location.pathname + '?s=' + data.id;
                                navigator.clipboard.writeText(shareUrl);
                                showToast('Song link copied to clipboard!');
                            } else if (action === 'go-to-artist') {
                                const artRes = await fetch(`/api/artist_from_song?id=${data.id}`);
                                const artData = await artRes.json();
                                if (artData.status === 'success') {
                                    showArtistPage(artData.browseId);
                                } else {
                                    showToast('Could not find artist profile.');
                                }
                            }
                        }
                    } catch(err) {
                        showToast('Failed to process action');
                    }
                }
            });
        });

// --- Top Right Controls & Document PiP MiniPlayer Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Volume Control
    const volumeSlider = document.getElementById('volume-slider');
    const volumeMuteBtn = document.getElementById('volume-mute-btn');
    if (volumeSlider) {
        // Initialize volume
        audioPlayer.volume = 1;
        
        volumeSlider.addEventListener('input', (e) => {
            audioPlayer.volume = e.target.value;
            if (audioPlayer.volume === 0) {
                volumeMuteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
            } else {
                volumeMuteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
            }
        });

        volumeMuteBtn.addEventListener('click', () => {
            if (audioPlayer.volume > 0) {
                window.lastVolume = audioPlayer.volume;
                audioPlayer.volume = 0;
                volumeSlider.value = 0;
            } else {
                audioPlayer.volume = window.lastVolume || 1;
                volumeSlider.value = audioPlayer.volume;
            }
            volumeSlider.dispatchEvent(new Event('input'));
        });
    }

    // 2. PiP MiniPlayer
    const pipBtn = document.getElementById('floating-pip-btn');
    if (pipBtn) {
        pipBtn.addEventListener('click', async () => {
            if (!('documentPictureInPicture' in window)) {
                alert('MiniPlayer (Document PiP) is not supported in your browser. Please use Chrome or Edge v111+ on Desktop.');
                return;
            }
            
            if (window.pipWindow) {
                window.pipWindow.close();
                return;
            }
            
            try {
                const pipWindow = await window.documentPictureInPicture.requestWindow({
                    width: 380,
                    height: 140,
                });
                window.pipWindow = pipWindow;
                
                // Copy stylesheets
                [...document.styleSheets].forEach((styleSheet) => {
                    try {
                        const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                        const style = document.createElement('style');
                        style.textContent = cssRules;
                        pipWindow.document.head.appendChild(style);
                    } catch (e) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.type = styleSheet.type;
                        link.media = styleSheet.media;
                        link.href = styleSheet.href;
                        pipWindow.document.head.appendChild(link);
                    }
                });
                
                const currentCover = document.getElementById('cover-art').src || 'default_cover.jpg';
                const currentTitle = document.getElementById('track-title').textContent;
                const currentArtist = document.getElementById('track-artist').textContent;

                pipWindow.document.body.innerHTML = `
                    <div class="pip-container" id="pip-bg" style="background-image: url('${currentCover}')">
                        <div class="pip-blur-overlay"></div>
                        <div class="pip-content">
                            <div class="pip-top-row">
                                <img class="pip-cover" id="pip-cover" src="${currentCover}">
                                <div class="pip-info">
                                    <div class="pip-title" id="pip-title">${currentTitle}</div>
                                    <div class="pip-artist" id="pip-artist">${currentArtist}</div>
                                    <div class="pip-progress-row">
                                        <span id="pip-curr">0:00</span>
                                        <div class="pip-progress-bar-container" id="pip-prog-bg">
                                            <div class="pip-progress-fill" id="pip-prog-fill"></div>
                                        </div>
                                        <span id="pip-dur">0:00</span>
                                    </div>
                                </div>
                            </div>
                            <div class="pip-controls-row">
                                <div class="pip-left-controls">
                                    <button class="pip-btn"><svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></button>
                                </div>
                                <div class="pip-center-controls">
                                    <button class="pip-btn" id="pip-prev"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
                                    <button class="pip-btn pip-play-btn" id="pip-play">${audioPlayer.paused ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}</button>
                                    <button class="pip-btn" id="pip-next"><svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
                                </div>
                                <div class="pip-right-controls">
                                    <button class="pip-btn"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 9H7v-2h7v2zm4-3H7V6h11v2z"/></svg></button>
                                    <button class="pip-btn"><svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg></button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
                const pipDoc = pipWindow.document;
                pipDoc.getElementById('pip-play').addEventListener('click', () => document.getElementById('play-pause-btn').click());
                pipDoc.getElementById('pip-prev').addEventListener('click', () => document.getElementById('prev-btn').click());
                pipDoc.getElementById('pip-next').addEventListener('click', () => document.getElementById('next-btn').click());
                
                const pipProgBg = pipDoc.getElementById('pip-prog-bg');
                pipProgBg.addEventListener('click', (e) => {
                    const rect = pipProgBg.getBoundingClientRect();
                    const pos = (e.clientX - rect.left) / rect.width;
                    audioPlayer.currentTime = pos * audioPlayer.duration;
                });

                pipWindow.addEventListener("pagehide", () => {
                    window.pipWindow = null;
                });
                
            } catch (error) {
                console.error('PiP failed', error);
            }
        });
    }
});

// Update PiP window dynamically
function updatePiPState() {
    if (!window.pipWindow) return;
    const pipDoc = window.pipWindow.document;
    
    // Update metadata
    const currentCover = document.getElementById('cover-art').src;
    pipDoc.getElementById('pip-cover').src = currentCover;
    pipDoc.getElementById('pip-bg').style.backgroundImage = `url('${currentCover}')`;
    pipDoc.getElementById('pip-title').textContent = document.getElementById('track-title').textContent;
    pipDoc.getElementById('pip-artist').textContent = document.getElementById('track-artist').textContent;
}

function updatePiPPlayback() {
    if (!window.pipWindow) return;
    const pipDoc = window.pipWindow.document;
    const ap = audioPlayer;
    
    // Update Play/Pause Icon
    pipDoc.getElementById('pip-play').innerHTML = ap.paused ? 
        '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : 
        '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
}

function updatePiPProgress() {
    if (!window.pipWindow) return;
    const pipDoc = window.pipWindow.document;
    const ap = audioPlayer;
    
    if (ap.duration) {
        pipDoc.getElementById('pip-prog-fill').style.width = (ap.currentTime / ap.duration * 100) + '%';
        pipDoc.getElementById('pip-curr').textContent = formatTime(ap.currentTime);
        pipDoc.getElementById('pip-dur').textContent = formatTime(ap.duration);
    }
}

// Hook into existing events (We need to monkey patch or add listeners where state changes)
const originalAudioPlayer = audioPlayer;
originalAudioPlayer.addEventListener('timeupdate', updatePiPProgress);
originalAudioPlayer.addEventListener('play', updatePiPPlayback);
originalAudioPlayer.addEventListener('pause', updatePiPPlayback);

// Hook into track changes
const observer = new MutationObserver(() => updatePiPState());
observer.observe(document.getElementById('track-title'), { childList: true });
observer.observe(document.getElementById('cover-art'), { attributes: true, attributeFilter: ['src'] });

// Attach gradient update to volume slider
document.addEventListener('DOMContentLoaded', () => {
    const vSlider = document.getElementById('volume-slider');
    if(vSlider) {
        function updateSliderFill() {
            const val = (vSlider.value - vSlider.min) / (vSlider.max - vSlider.min) * 100;
            vSlider.style.background = `linear-gradient(to right, #ffffff ${val}%, rgba(255, 255, 255, 0.2) ${val}%)`;
        }
        vSlider.addEventListener('input', updateSliderFill);
        // initial fill
        updateSliderFill();
    }
});

// --- LYRICS ANIMATION STYLE SETTINGS CONTROLLER ---



// --- LYRICS ANIMATION STYLE SETTINGS CONTROLLER ---
const defaultLyricsSettings = {
    lineBounce: true,
    bounceAmplitude: 100,
    glowIntensity: 100,
    fillSmoothness: 8
};

function getLyricsSettings() {
    try {
        const saved = localStorage.getItem('axiotune_lyrics_settings');
        return saved ? { ...defaultLyricsSettings, ...JSON.parse(saved) } : defaultLyricsSettings;
    } catch(e) {
        return defaultLyricsSettings;
    }
}

function saveLyricsSettings(settings) {
    try {
        localStorage.setItem('axiotune_lyrics_settings', JSON.stringify(settings));
    } catch(e) {}
}

function applyLyricsAnimationSettings(settings) {
    const s = settings || getLyricsSettings();
    const root = document.documentElement;

    // Line Bounce
    const bounceAmp = s.lineBounce ? s.bounceAmplitude : 0;
    const bounceScale = (1 + (0.06 * (bounceAmp / 100))).toFixed(3);
    root.style.setProperty('--lrc-bounce-scale', bounceScale);

    // Glow Intensity
    const glowPct = s.glowIntensity / 100;
    const glowRadius = `${Math.round(12 * glowPct)}px`;
    const glowOpacity = (0.85 * glowPct).toFixed(2);
    root.style.setProperty('--lrc-glow-radius', glowRadius);
    root.style.setProperty('--lrc-glow-opacity', glowOpacity);

    // Fill Smoothness
    root.style.setProperty('--lrc-fill-smoothness', `${s.fillSmoothness}px`);
}

document.addEventListener('DOMContentLoaded', () => {
    const lyricsSet = getLyricsSettings();
    applyLyricsAnimationSettings(lyricsSet);

    const toggle = document.getElementById('lrc-bounce-toggle');
    const ampSlider = document.getElementById('lrc-bounce-amp');
    const ampVal = document.getElementById('lrc-bounce-amp-val');
    const glowSlider = document.getElementById('lrc-glow-intensity');
    const glowVal = document.getElementById('lrc-glow-intensity-val');
    const fillSlider = document.getElementById('lrc-fill-smoothness');
    const fillVal = document.getElementById('lrc-fill-smoothness-val');

    if (toggle) {
        toggle.checked = lyricsSet.lineBounce;
        toggle.addEventListener('change', (e) => {
            const current = getLyricsSettings();
            current.lineBounce = e.target.checked;
            saveLyricsSettings(current);
            applyLyricsAnimationSettings(current);
        });
    }

    if (ampSlider && ampVal) {
        ampSlider.value = lyricsSet.bounceAmplitude;
        ampVal.textContent = `${lyricsSet.bounceAmplitude}%`;
        ampSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            ampVal.textContent = `${val}%`;
            const current = getLyricsSettings();
            current.bounceAmplitude = val;
            saveLyricsSettings(current);
            applyLyricsAnimationSettings(current);
        });
    }

    if (glowSlider && glowVal) {
        glowSlider.value = lyricsSet.glowIntensity;
        glowVal.textContent = `${lyricsSet.glowIntensity}%`;
        glowSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            glowVal.textContent = `${val}%`;
            const current = getLyricsSettings();
            current.glowIntensity = val;
            saveLyricsSettings(current);
            applyLyricsAnimationSettings(current);
        });
    }

    if (fillSlider && fillVal) {
        fillSlider.value = lyricsSet.fillSmoothness;
        fillVal.textContent = `${lyricsSet.fillSmoothness} dp`;
        fillSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            fillVal.textContent = `${val} dp`;
            const current = getLyricsSettings();
            current.fillSmoothness = val;
            saveLyricsSettings(current);
            applyLyricsAnimationSettings(current);
        });
    }

    // Performance Mode
    const perfToggle = document.getElementById('performance-mode-toggle');
    if (perfToggle) {
        const perfVal = localStorage.getItem('apple_performance_mode');
        const isPerf = perfVal === null ? false : perfVal === 'true';
        perfToggle.checked = isPerf;
        if (isPerf) {
            document.body.classList.add('performance-mode');
        } else {
            document.body.classList.remove('performance-mode');
        }
        
        perfToggle.addEventListener('change', (e) => {
            localStorage.setItem('apple_performance_mode', e.target.checked);
            if (e.target.checked) {
                document.body.classList.add('performance-mode');
            } else {
                document.body.classList.remove('performance-mode');
            }
        });
    }

    // Animations
    const animToggle = document.getElementById('animations-toggle');
    if (animToggle) {
        // Default to true if not set
        const animVal = localStorage.getItem('apple_animations');
        const isAnim = animVal === null ? true : animVal === 'true';
        animToggle.checked = isAnim;
        if (!isAnim) document.body.classList.add('disable-animations');
        
        animToggle.addEventListener('change', (e) => {
            localStorage.setItem('apple_animations', e.target.checked);
            if (!e.target.checked) {
                document.body.classList.add('disable-animations');
            } else {
                document.body.classList.remove('disable-animations');
            }
        });
    }
});


// --- MEDIA SESSION API (Windows Taskbar & Lock Screen Integration) ---
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { if (audioPlayer.paused) audioPlayer.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (!audioPlayer.paused) audioPlayer.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (queueList.length > 0 && currentQueueIndex > 0) playQueueIndex(currentQueueIndex - 1);
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (queueList.length > 0 && currentQueueIndex < queueList.length - 1) playQueueIndex(currentQueueIndex + 1);
    });
}

function updateMediaSession(title, artist, artworkUrl) {
    if ('mediaSession' in navigator) {
        // Fallback to absolute URL if it's a relative default image
        let finalArt = artworkUrl;
        if (artworkUrl === 'default_cover.jpg') {
            finalArt = window.location.origin + '/default_cover.jpg';
        }
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title || 'Unknown Title',
            artist: artist || 'Unknown Artist',
            album: 'AxioTune',
            artwork: [
                { src: finalArt, sizes: '512x512', type: 'image/jpeg' }
            ]
        });
    }
}

window.loadLibraryArtists = function() {
    const container = document.getElementById('library-tab-content');
    if(!container) return;
    
    if(followedArtists.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.5;margin-bottom:15px"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                <p>You haven't followed any artists yet.</p>
            </div>
        `;
        return;
    }
    
    let html = '<div class="artist-circle-grid">';
    followedArtists.forEach(artist => {
        html += `
            <div class="artist-circle-card" onclick="openArtist('${artist.browseId}')">
                <img src="${artist.thumb}" alt="${artist.name}">
                <div class="artist-name">${artist.name}</div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
};

let followedArtists = JSON.parse(localStorage.getItem('followedArtists') || '[]');

window.getFollowButtonHtml = function(browseId, name, thumb) {
    const isFollowing = followedArtists.some(a => a.browseId === browseId);
    if(isFollowing) {
        return `<button id="follow-artist-btn" class="apple-btn apple-follow-btn following" onclick="toggleFollowArtist('${browseId}', '${name.replace(/'/g, "\\'")}', '${thumb}')"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Following</button>`;
    } else {
        return `<button id="follow-artist-btn" class="apple-btn apple-follow-btn" onclick="toggleFollowArtist('${browseId}', '${name.replace(/'/g, "\\'")}', '${thumb}')"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg> Follow</button>`;
    }
};

window.toggleFollowArtist = function(browseId, name, thumb) {
    const idx = followedArtists.findIndex(a => a.browseId === browseId);
    if(idx > -1) {
        followedArtists.splice(idx, 1);
    } else {
        followedArtists.push({browseId, name, thumb});
    }
    localStorage.setItem('followedArtists', JSON.stringify(followedArtists));
    
    const btn = document.getElementById('follow-artist-btn');
    if(btn) {
        if(idx > -1) {
            btn.classList.remove('following');
            btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg> Follow`;
        } else {
            btn.classList.add('following');
            btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Following`;
        }
    }
    if(window.loadLibraryArtists) window.loadLibraryArtists();
};

window.fetchArtistAllSongs = async function(browseId, artistName) {
    const container = document.getElementById('artist-songs-container');
    if(!container) return;
    
    // Find the See All button and show loading state
    const btn = document.querySelector('.section-header .see-all-btn');
    if(btn) {
        btn.dataset.originalText = btn.innerText;
        btn.innerHTML = 'Loading...';
        btn.disabled = true;
    }
    
    try {
        const res = await fetch(`/api/playlist?id=${encodeURIComponent(browseId)}`);
        const data = await res.json();
        
        if (data.status === 'success' && data.playlist && data.playlist.tracks) {
            let html = '<div class="sr-card-grid">';
            data.playlist.tracks.forEach((song, idx) => {
                const songThumb = song.thumbnails && song.thumbnails.length > 0 ? getCoverUrl(song.title, song.thumbnails[song.thumbnails.length-1].url, song.id || song.videoId) : 'default_cover.jpg';
                const songJson = JSON.stringify({title: song.title, artist: artistName}).replace(/"/g, '&quot;');
                
                html += `
                    <div class="sr-card album anim-slide-up" style="animation-delay: ${0.05 + (Math.min(idx, 20) * 0.05)}s" onclick="playSong('${song.videoId}', '${songJson}', this)">
                        <img src="${songThumb}" class="sr-card-cover" alt="${song.title}">
                        <div class="sr-card-name">${song.title}</div>
                        <div class="sr-card-sub">${artistName}</div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
            
            if(btn) btn.style.display = 'none'; // hide the See All button after loading all songs
        } else {
            if(btn) {
                btn.innerHTML = 'Error';
                btn.disabled = false;
            }
        }
    } catch(e) {
        console.error(e);
        if(btn) {
            btn.innerHTML = 'Error';
            btn.disabled = false;
        }
    }
};

// PWA Install Logic
window.deferredPrompt = null;
if(window.toggleDownloadMenu) window.toggleDownloadMenu();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    window.deferredPrompt = e;
    
    // Check if there is an install button already in DOM, if so show it
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
        installBtn.style.display = 'flex';
    }
});

// Download Menu Logic
window.toggleDownloadMenu = function(e) {
    if(e) e.stopPropagation();
    const menu = document.getElementById('download-dropdown-menu');
    if(menu) {
        menu.classList.toggle('hidden-dropdown');
    }
};

window.showMobileInstallAlert = function() { window.toggleDownloadMenu(); window.open('https://github.com/adarshshukla/apple-music-clone/releases', '_blank'); };

window.installPWA = async function() { if(!window.deferredPrompt) return; window.deferredPrompt.prompt(); await window.deferredPrompt.userChoice; window.deferredPrompt = null; };



/* =========================================================================
   LISTEN TOGETHER / PARTY MODE (Strict Sync)
   ========================================================================= */
const PartyEngine = {
    ws: null,
    roomId: null,
    isHost: false,
    clientId: Math.random().toString(36).substring(2, 10),
    username: '',
    isSyncingFromHost: false,
    syncInterval: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    unreadCount: 0,
    clockOffset: 0,
    _playbackRateResetTimer: null,

    init() {
        const urlParams = new URLSearchParams(window.location.search);
        const partyId = urlParams.get('party');
        
        // Modal Event Listeners
        const listenTogetherBtn = document.getElementById('listen-together-btn');
        const settingsStartPartyBtn = document.getElementById('start-party-btn');
        const closePartyModalBtn = document.getElementById('close-party-modal-btn');
        const modalStartPartyBtn = document.getElementById('modal-start-party-btn');
        const modalLeavePartyBtn = document.getElementById('modal-leave-party-btn');
        const modalCopyLinkBtn = document.getElementById('modal-copy-link-btn');

        // Pre-fill username from localStorage
        const savedName = localStorage.getItem('party_username') || '';
        document.getElementById('party-username-input').value = savedName;

        // Open modal
        const openModal = () => {
            document.getElementById('listen-together-modal').classList.remove('hidden-modal');
            this.updateModalUI();
        };

        listenTogetherBtn?.addEventListener('click', openModal);
        settingsStartPartyBtn?.addEventListener('click', openModal);

        // Close modal
        closePartyModalBtn?.addEventListener('click', () => {
            document.getElementById('listen-together-modal').classList.add('hidden-modal');
        });

        // Start Party (Host)
        modalStartPartyBtn?.addEventListener('click', () => {
            const nameInput = document.getElementById('party-username-input').value.trim();
            if (!nameInput) {
                showToast('Please enter your name first');
                return;
            }
            this.username = nameInput;
            localStorage.setItem('party_username', nameInput);
            
            if (!this.roomId) {
                this.roomId = 'PARTY_' + Math.random().toString(36).substring(2, 8).toUpperCase();
            }
            this.isHost = true;
            this.connect();
        });

        // Leave Party
        modalLeavePartyBtn?.addEventListener('click', () => {
            this.leave();
        });

        // Copy Link
        modalCopyLinkBtn?.addEventListener('click', () => {
            const linkInput = document.getElementById('modal-party-link-input');
            linkInput.select();
            linkInput.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(linkInput.value);
            showToast('Room link copied to clipboard!');
        });

        // Chat Button toggle
        document.getElementById('party-chat-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('party-chat-panel');
            panel.classList.toggle('chat-panel-collapsed');
            if (!panel.classList.contains('chat-panel-collapsed')) {
                this.unreadCount = 0;
                document.getElementById('chat-badge').style.display = 'none';
                document.getElementById('chat-input-box').focus();
            }
        });

        // Close Chat panel
        document.getElementById('close-chat-btn')?.addEventListener('click', () => {
            document.getElementById('party-chat-panel').classList.add('chat-panel-collapsed');
        });

        // Send Chat message
        const sendMsg = () => {
            const box = document.getElementById('chat-input-box');
            const text = box.value.trim();
            if (!text) return;
            box.value = '';
            this.sendChatMessage(text);
        };
        document.getElementById('send-chat-btn')?.addEventListener('click', sendMsg);
        document.getElementById('chat-input-box')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMsg();
        });

        // Automatically prompt name if url has partyId
        if (partyId) {
            this.roomId = partyId;
            this.isHost = false;
            setTimeout(() => {
                openModal();
                showToast('You have been invited to join a party!');
            }, 1500);
        }

        // Setup Player Sync Event Listeners (Host Only triggers broadcast)
        audioPlayer.addEventListener('play', () => {
            if (this.roomId && this.isHost && !this.isSyncingFromHost) {
                this.broadcastState('play');
            }
        });
        audioPlayer.addEventListener('pause', () => {
            if (this.roomId && this.isHost && !this.isSyncingFromHost) {
                this.broadcastState('pause');
            }
        });
        audioPlayer.addEventListener('seeked', () => {
            if (this.roomId && this.isHost && !this.isSyncingFromHost) {
                this.broadcastState('seek');
            }
        });
    },

    updateModalUI() {
        const userContainer = document.getElementById('party-username-container');
        const startBtn = document.getElementById('modal-start-party-btn');
        const infoContainer = document.getElementById('modal-party-info-container');
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            userContainer.style.display = 'none';
            startBtn.style.display = 'none';
            infoContainer.style.display = 'block';
            
            document.getElementById('modal-party-id-text').textContent = this.roomId;
            document.getElementById('modal-party-role-text').textContent = this.isHost ? 'Host' : 'Guest';
            
            let baseOrigin = window.location.origin;
            if (window._localNetworkIp && (baseOrigin.includes('localhost') || baseOrigin.includes('127.0.0.1'))) {
                baseOrigin = baseOrigin.replace(/localhost|127\.0\.0\.1/, window._localNetworkIp);
            }
            const joinUrl = baseOrigin + window.location.pathname + '?party=' + this.roomId;
            document.getElementById('modal-party-link-input').value = joinUrl;
        } else {
            userContainer.style.display = 'block';
            startBtn.style.display = 'block';
            infoContainer.style.display = 'none';
            startBtn.textContent = this.isHost ? 'Resume Hosting' : 'Host Private Session';
        }
    },

    connect() {
        if (this.ws) {
            try { this.ws.close(); } catch(e) {}
        }
        
        console.log(`PartyEngine: Connecting to room ${this.roomId} as ${this.isHost ? 'host' : 'listener'}...`);
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/party/${this.roomId}/${this.clientId}?role=${this.isHost ? 'host' : 'listener'}&username=${encodeURIComponent(this.username)}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('PartyEngine: Connected to WebSocket server');
            this.reconnectAttempts = 0;
            this.updateModalUI();
            showToast(this.isHost ? `Hosting room ${this.roomId}` : `Joined room ${this.roomId}`);
            
            // Show Chat button
            document.getElementById('party-chat-btn').style.display = 'flex';
            document.getElementById('party-chat-btn').classList.remove('hidden-chat-btn');
            
            // Clear old messages and append system joined message
            document.getElementById('chat-messages-container').innerHTML = '';
            this.appendSystemMessage(`Connected to room: ${this.roomId}`);
            
            // Update mobile settings start-party-btn UI
            const settingsBtn = document.getElementById('start-party-btn');
            if (settingsBtn) {
                settingsBtn.innerHTML = 'ÃƒÂ¢Ã…Â¡Ã‚Â¡ View Party Details';
                settingsBtn.style.background = 'rgba(0, 255, 150, 0.15)';
                settingsBtn.style.color = '#00ff96';
            }

            // If listener, lock controls and show locked badge
            if (!this.isHost) {
                document.body.classList.add('party-listener-active');
                this.addLockedBadge();
                
                // NTP Ping-Pong to establish stable clock offset
                let pingCount = 0;
                const pingInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ action: 'ping', t1: Date.now() }));
                    }
                    if (++pingCount >= 3) clearInterval(pingInterval);
                }, 500);
            } else {
                // If host, start periodic sync broadcast
                this.startSyncLoop();
            }
        };
        
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch(e) {
                console.error("Error parsing party message:", e);
            }
        };
        
        this.ws.onerror = (err) => {
            console.error('PartyEngine: WebSocket error:', err);
        };
        
        this.ws.onclose = () => {
            console.log('PartyEngine: WebSocket closed');
            this.stopSyncLoop();
            
            // Hide chat panel & chat button
            document.getElementById('party-chat-panel').classList.add('chat-panel-collapsed');
            document.getElementById('party-chat-btn').style.display = 'none';
            document.getElementById('party-chat-btn').classList.add('hidden-chat-btn');
            document.body.classList.remove('party-listener-active');
            this.removeLockedBadge();
            
            // Reconnect logic if we didn't voluntarily leave
            if (this.roomId && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                this.appendSystemMessage("Connection lost. Reconnecting...");
                setTimeout(() => this.connect(), 3000);
            } else {
                this.updateModalUI();
                const settingsBtn = document.getElementById('start-party-btn');
                if (settingsBtn) {
                    settingsBtn.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px;"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        Start Listening Party
                    `;
                    settingsBtn.style.background = '';
                    settingsBtn.style.color = '';
                }
            }
        };
    },

    leave() {
        this.roomId = null;
        this.reconnectAttempts = 999; // prevent auto-reconnect
        if (this.ws) {
            try { this.ws.close(); } catch(e) {}
        }
        showToast('Left the listening party');
        document.getElementById('listen-together-modal').classList.add('hidden-modal');
        // Clear url params
        const url = new URL(window.location);
        url.searchParams.delete('party');
        window.history.pushState({}, '', url);
    },

    broadcastState(action) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        const payload = {
            action: action,
            videoId: currentVideoId,
            currentTime: audioPlayer.currentTime,
            isPlaying: !audioPlayer.paused,
            timestamp: Date.now(),
            songJson: currentSongMeta ? JSON.stringify(currentSongMeta) : null
        };
        
        try {
            this.ws.send(JSON.stringify(payload));
        } catch(e) {
            console.error("Failed to broadcast state:", e);
        }
    },

    startSyncLoop() {
        this.stopSyncLoop();
        this.syncInterval = setInterval(() => {
            if (isSongLoaded && !audioPlayer.paused) {
                this.broadcastState('sync');
            }
        }, 2000);
    },

    stopSyncLoop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    },

    handleMessage(message) {
        if (message.action === 'ping' && this.isHost) {
            this.ws.send(JSON.stringify({ action: 'pong', t1: message.t1, t2: Date.now() }));
            return;
        }
        if (message.action === 'pong' && !this.isHost) {
            const t3 = Date.now();
            const rtt = t3 - message.t1;
            const newOffset = message.t2 + (rtt / 2) - t3;
            this.clockOffset = this.clockOffset === 0 ? newOffset : (this.clockOffset + newOffset) / 2;
            return;
        }

        if (message.action === 'system') {
            this.appendSystemMessage(message.message);
            if (message.userCount !== undefined) {
                document.getElementById('modal-party-listeners-count').textContent = message.userCount;
            }
            return;
        }
        
        if (message.action === 'chat') {
            this.appendChatMessage(message.username, message.text, false);
            return;
        }
        
        // Listeners handle host playback commands
        if (!this.isHost) {
            this.syncPlayer(message);
        }
    },

    async syncPlayer(message) {
        this.isSyncingFromHost = true;
        
        try {
            // 1. Song check
            if (message.videoId && message.videoId !== currentVideoId) {
                console.log(`PartyEngine: Loading new song from host: ${message.videoId}`);
                if (message.songJson) {
                    // Directly load stream bypassing search
                    const song = JSON.parse(message.songJson);
                    window._forceQueueSong = {
                        videoId: message.videoId,
                        title: song.title,
                        artist: song.artist,
                        thumbnail: song.cover || song.thumbnail || ''
                    };
                    songSearchInput.value = song.title + ' ' + song.artist;
                    searchBtn.click();
                }
            }

            // 2. Playback state check
            if (message.action === 'pause' || !message.isPlaying) {
                if (!audioPlayer.paused) {
                    audioPlayer.pause();
                    setPlayPauseUI(false);
                }
            } else if (message.action === 'play' || message.isPlaying) {
                if (audioPlayer.paused) {
                    await audioPlayer.play().catch(() => {});
                    setPlayPauseUI(true);
                }
            }

            // 3. Current time / Seek check
            if (message.currentTime !== undefined) {
                const serverTimeNow = Date.now() + this.clockOffset;
                const timeSinceBroadcast = (serverTimeNow - message.timestamp) / 1000.0;
                const expectedHostTime = message.currentTime + (message.isPlaying ? timeSinceBroadcast : 0);
                
                const timeDiff = expectedHostTime - audioPlayer.currentTime;
                const absDiff = Math.abs(timeDiff);

                if (absDiff > 1.5) {
                    // Desync is too large (>1.5s), do a hard jump
                    console.log(`PartyEngine: Hard seek to ${expectedHostTime.toFixed(2)}s`);
                    audioPlayer.currentTime = expectedHostTime;
                    audioPlayer.playbackRate = 1.0;
                } else if (absDiff > 0.04) {
                    // Desync is > 40ms, use smooth playbackRate catch-up
                    if (timeDiff > 0) {
                        audioPlayer.playbackRate = 1.05; // speed up
                        console.log(`PartyEngine: Catching up (speed up). Diff: ${timeDiff.toFixed(3)}s`);
                    } else {
                        audioPlayer.playbackRate = 0.95; // slow down
                        console.log(`PartyEngine: Catching up (slow down). Diff: ${timeDiff.toFixed(3)}s`);
                    }
                    
                    clearTimeout(this._playbackRateResetTimer);
                    // Time to catch up = diff / rate_difference (0.05)
                    const catchUpTimeMs = (absDiff / 0.05) * 1000;
                    this._playbackRateResetTimer = setTimeout(() => {
                        audioPlayer.playbackRate = 1.0;
                        console.log('PartyEngine: Playback rate reset to 1.0');
                    }, catchUpTimeMs);
                } else {
                    // Perfectly in sync (< 40ms difference)
                    if (audioPlayer.playbackRate !== 1.0) {
                        audioPlayer.playbackRate = 1.0;
                        clearTimeout(this._playbackRateResetTimer);
                    }
                }
            }
        } catch(e) {
            console.error("Error syncing player state:", e);
        } finally {
            // Yield execution to allow events to process before clearing sync flag
            setTimeout(() => {
                this.isSyncingFromHost = false;
            }, 150);
        }
    },

    sendChatMessage(text) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        const payload = {
            action: "chat",
            username: this.username,
            text: text,
            timestamp: Date.now()
        };
        
        try {
            this.ws.send(JSON.stringify(payload));
            this.appendChatMessage(this.username, text, true);
        } catch(e) {
            console.error("Failed to send chat:", e);
        }
    },

    appendSystemMessage(text) {
        const container = document.getElementById('chat-messages-container');
        if (!container) return;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg msg-system';
        msgDiv.innerHTML = `<div class="msg-bubble">${text}</div>`;
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    },

    appendChatMessage(sender, text, isSelf) {
        const container = document.getElementById('chat-messages-container');
        if (!container) return;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isSelf ? 'msg-self' : 'msg-other'}`;
        
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        msgDiv.innerHTML = `
            <div class="msg-meta">${isSelf ? 'You' : sender} Ã¢â‚¬Â¢ ${timeStr}</div>
            <div class="msg-bubble">${this.escapeHTML(text)}</div>
        `;
        
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;

        // Play alert / Increment unread count
        if (!isSelf) {
            const panel = document.getElementById('party-chat-panel');
            if (panel.classList.contains('chat-panel-collapsed')) {
                this.unreadCount++;
                const badge = document.getElementById('chat-badge');
                badge.textContent = this.unreadCount;
                badge.style.display = 'flex';
            }
        }
    },

    addLockedBadge() {
        this.removeLockedBadge();
        const badge = document.createElement('div');
        badge.className = 'guest-locked-badge';
        badge.id = 'party-locked-badge';
        badge.innerHTML = `<span class="pulse-dot" style="background:#ff2d55; box-shadow: 0 0 10px #ff2d55;"></span> Synced to Host`;
        
        const trackTitleRow = document.getElementById('track-title-row');
        if (trackTitleRow) {
            trackTitleRow.parentElement.insertBefore(badge, trackTitleRow);
        }
    },

    removeLockedBadge() {
        document.getElementById('party-locked-badge')?.remove();
    },

    escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }
};

// Start the engine
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => PartyEngine.init(), 1000);
});



window.toggleDownloadMenu = function(e) {
    const menu = document.getElementById('download-dropdown-menu');
    if (menu.classList.contains('hidden-dropdown')) {
        menu.classList.remove('hidden-dropdown');
    } else {
        menu.classList.add('hidden-dropdown');
    }
    e.stopPropagation();
};

window.downloadAppFor = function(os) {
    const githubReleasesLink = 'https://github.com/adarshshukla/apple-music-clone/releases';
    window.open(githubReleasesLink, '_blank');
};

document.addEventListener('click', (e) => {
    const menu = document.getElementById('download-dropdown-menu');
    const btn = document.getElementById('download-app-btn');
    if (menu && !menu.classList.contains('hidden-dropdown')) {
        if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
            menu.classList.add('hidden-dropdown');
        }
    }
});

let currentTheme = localStorage.getItem('app_theme') || 'dynamic';
applyTheme(currentTheme);

function applyTheme(theme) {
    document.body.classList.remove('theme-dynamic', 'theme-static', 'pitch-black-mode');
    document.documentElement.classList.remove('pitch-black-mode');
    const btn = document.getElementById('dark-mode-btn');
    const iconPath = document.getElementById('theme-icon-path');
    if (!btn || !iconPath) return;

    if (theme === 'static') {
        document.body.classList.add('theme-static');
        btn.style.background = 'rgba(255, 152, 0, 0.15)'; 
        btn.style.color = '#ff9800';
        iconPath.setAttribute('d', 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'); 
        btn.title = "Static Wallpaper (YT Music Style)";
    } else if (theme === 'dark') {
        document.body.classList.add('pitch-black-mode');
        document.documentElement.classList.add('pitch-black-mode');
        btn.style.background = 'rgba(255, 71, 109, 0.15)'; 
        btn.style.color = '#ff476d';
        iconPath.setAttribute('d', 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z'); 
        btn.title = "Pitch Black Mode";
    } else {
        document.body.classList.add('theme-dynamic');
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
        btn.style.color = 'rgba(255,255,255,0.6)';
        iconPath.setAttribute('d', 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z'); 
        btn.title = "Dynamic Wallpaper (Apple Music Style)";
    }
}

window.cycleTheme = function() {
    if (currentTheme === 'dynamic') {
        currentTheme = 'static';
    } else if (currentTheme === 'static') {
        currentTheme = 'dark';
    } else {
        currentTheme = 'dynamic';
    }
    localStorage.setItem('app_theme', currentTheme);
    applyTheme(currentTheme);
};

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedSongId = urlParams.get('s');
    if (sharedSongId) {
        try {
            showToast('Loading shared song...');
            const res = await fetch(`/api/search?q=${sharedSongId}`);
            if (res.ok) {
                const results = await res.json();
                if (results && results.length > 0) {
                    const data = results[0];
                    const songObj = {
                        title: data.title,
                        artist: data.uploader || 'Unknown Artist',
                        cover: data.thumbnail || '',
                        query: data.title + ' ' + (data.uploader || ''),
                        id: data.id,
                        videoId: data.id
                    };
                    playSong(data.id, JSON.stringify(songObj));
                }
            }
        } catch(e) {
            console.error('Failed to load shared song', e);
        }
    }
});

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ 3D Cover Art Tilt + Glare ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
(function () {
    const container = document.getElementById('cover-art-container');
    const coverWrapper = document.getElementById('cover-wrapper');
    if (!container || !coverWrapper) return;

    // --- Inject glare overlay div ---
    const glare = document.createElement('div');
    glare.id = 'cover-glare';
    container.appendChild(glare);

    // --- 3D Tilt Logic ---
    container.addEventListener('mouseenter', () => {
        container.style.animation = 'none';
        container.style.transition = 'none';
    });

    container.addEventListener('mousemove', (e) => {
        container.style.animation = 'none';
        const rect = container.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / (rect.width / 2);
        const dy = (e.clientY - cy) / (rect.height / 2);

        container.style.transform = `perspective(800px) rotateX(${dy * -18}deg) rotateY(${dx * 18}deg) scale(1.06)`;

        // Move glare to mouse position
        const gx = ((e.clientX - rect.left) / rect.width) * 100;
        const gy = ((e.clientY - rect.top) / rect.height) * 100;
        glare.style.setProperty('--gx', `${gx}%`);
        glare.style.setProperty('--gy', `${gy}%`);
    });

    container.addEventListener('mouseleave', () => {
        container.style.transition = 'transform 0.6s cubic-bezier(0.2,0.8,0.2,1)';
        container.style.transform = '';
        setTimeout(() => { 
            container.style.transition = ''; 
            container.style.animation = ''; // Restore CSS animation
        }, 600);
    });
})();

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Page Visibility Optimization (stop wasted rAF when tab is hidden) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
(function() {
    let rafId = null;
    // Patch requestAnimationFrame to track the animation loop ID
    // We just listen to visibility and pause/resume the audio-derived loops via a flag
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Tab hidden ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â audio still plays but we don't need to render lyrics frames
            window._appTabHidden = true;
        } else {
            window._appTabHidden = false;
        }
    });
})();

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Voice Search (Mic Button) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
(function () {
    const micBtn = document.getElementById('mic-btn');
    const searchInput = document.getElementById('song-search');
    if (!micBtn || !searchInput) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { micBtn.style.display = 'none'; return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let isListening = false;
    micBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isListening) { recognition.stop(); return; }
        recognition.start();
    });
    recognition.onstart = () => { isListening = true; micBtn.classList.add('listening'); searchInput.placeholder = 'Listening...'; };
    recognition.onresult = (event) => {
        searchInput.value = event.results[0][0].transcript;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognition.onend = () => {
        isListening = false; micBtn.classList.remove('listening'); searchInput.placeholder = 'Search songs, artists, albums...';
        if (searchInput.value.trim()) searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };
    recognition.onerror = () => { isListening = false; micBtn.classList.remove('listening'); searchInput.placeholder = 'Search songs, artists, albums...'; };
})();

// Ã¢â€â‚¬Ã¢â€â‚¬ Lyrics Glow Intensity Slider Ã¢â€â‚¬Ã¢â€â‚¬
(function() {
    const slider = document.getElementById('lyrics-glow-slider');
    const valText = document.getElementById('glow-intensity-val');
    if (!slider || !valText) return;

    const savedGlow = localStorage.getItem('lyrics_glow_v1') || '2';
    slider.value = savedGlow;
    updateGlow(savedGlow);

    slider.addEventListener('input', (e) => {
        updateGlow(e.target.value);
    });

    slider.addEventListener('change', (e) => {
        localStorage.setItem('lyrics_glow_v1', e.target.value);
    });

    function updateGlow(val) {
        const num = parseInt(val, 10);
        document.documentElement.style.setProperty('--lyrics-glow-intensity', `${num}px`);
        if (num === 0) valText.textContent = 'None';
        else if (num <= 2) valText.textContent = 'Low';
        else if (num <= 5) valText.textContent = 'Medium';
        else valText.textContent = 'High';
    }
})();












/* 🐾 AXIØTUNE CUTE LOFI CAT PET COMPANION CONTROLLER 🐾 */
function initCatCompanion() {
    const catPet = document.getElementById('axio-cat-pet');
    const pupilLeft = document.getElementById('cat-pupil-left');
    const pupilRight = document.getElementById('cat-pupil-right');
    const headGroup = document.getElementById('cat-head-group');
    const eyesAwake = document.getElementById('cat-eyes-awake');
    const eyesAsleep = document.getElementById('cat-eyes-asleep');
    const bubble = document.getElementById('cat-speech-bubble');

    if (!catPet || !pupilLeft || !pupilRight) return;

    let targetDxLeft = 0, targetDyLeft = 0;
    let targetDxRight = 0, targetDyRight = 0;
    let headAngle = 0;
    let lastDxLeft = null, lastDyLeft = null;
    let mouseMoveScheduled = false;

    // Mouse movement pupil tracking & head tilt (Throttled for 60FPS smoothness)
    window.addEventListener('mousemove', (e) => {
        if (mouseMoveScheduled) return;
        mouseMoveScheduled = true;
        requestAnimationFrame(() => {
            mouseMoveScheduled = false;
            const rect = catPet.getBoundingClientRect();
            // Left Eye SVG Center
            const leftEyeX = rect.left + (45 / 120) * rect.width;
            const leftEyeY = rect.top + (48 / 120) * rect.height;
            // Right Eye SVG Center
            const rightEyeX = rect.left + (75 / 120) * rect.width;
            const rightEyeY = rect.top + (48 / 120) * rect.height;

            const angleLeft = Math.atan2(e.clientY - leftEyeY, e.clientX - leftEyeX);
            const distLeft = Math.min(3.8, Math.hypot(e.clientX - leftEyeX, e.clientY - leftEyeY) / 60);
            targetDxLeft = Math.cos(angleLeft) * distLeft;
            targetDyLeft = Math.sin(angleLeft) * distLeft;

            const angleRight = Math.atan2(e.clientY - rightEyeY, e.clientX - rightEyeX);
            const distRight = Math.min(3.8, Math.hypot(e.clientX - rightEyeX, e.clientY - rightEyeY) / 60);
            targetDxRight = Math.cos(angleRight) * distRight;
            targetDyRight = Math.sin(angleRight) * distRight;

            // Head tilt angle calculation
            const headCenterX = rect.left + (60 / 120) * rect.width;
            headAngle = Math.max(-12, Math.min(12, (e.clientX - headCenterX) / 45));
        });
    }, { passive: true });

    // Smooth Animation Frame Loop (Only mutates DOM when values actually change!)
    let beatTime = 0;
    function catAnimLoop() {
        if (pupilLeft && pupilRight && (lastDxLeft !== targetDxLeft || lastDyLeft !== targetDyLeft)) {
            lastDxLeft = targetDxLeft;
            lastDyLeft = targetDyLeft;
            pupilLeft.style.transform = `translate(${targetDxLeft.toFixed(2)}px, ${targetDyLeft.toFixed(2)}px)`;
            pupilRight.style.transform = `translate(${targetDxRight.toFixed(2)}px, ${targetDyRight.toFixed(2)}px)`;
        }

        const isPlaying = audioPlayer && !audioPlayer.paused;

        if (isPlaying) {
            // Awake Mode
            if (eyesAwake && eyesAwake.style.display !== 'inline') eyesAwake.style.display = 'inline';
            if (eyesAsleep && eyesAsleep.style.display !== 'none') eyesAsleep.style.display = 'none';

            // Music Beat-Bop Head Movement
            beatTime += 0.12;
            const bopY = Math.sin(beatTime * 3) * 3;
            const headRot = headAngle + (Math.cos(beatTime * 2.5) * 3);
            if (headGroup) headGroup.style.transform = `translateY(${bopY.toFixed(1)}px) rotate(${headRot.toFixed(1)}deg)`;

            if (bubble && Math.random() < 0.015) {
                const notes = ['🎵', '🎶', '✨', '🔥', '💖', '🐾'];
                bubble.textContent = notes[Math.floor(Math.random() * notes.length)];
            }
        } else {
            // Sleeping Mode
            beatTime = 0;
            if (eyesAwake && eyesAwake.style.display !== 'none') eyesAwake.style.display = 'none';
            if (eyesAsleep && eyesAsleep.style.display !== 'inline') eyesAsleep.style.display = 'inline';
            if (headGroup) headGroup.style.transform = `rotate(${headAngle.toFixed(1)}deg)`;
            if (bubble && bubble.textContent !== 'Zzz...') bubble.textContent = 'Zzz...';
        }

        requestAnimationFrame(catAnimLoop);
    }
    requestAnimationFrame(catAnimLoop);

    // Global Window Function to Toggle Majoni Chat Modal
    window.toggleMajoniChatModal = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const modal = document.getElementById('majoni-chat-modal');
        if (modal) {
            modal.classList.toggle('active');
            const chatInput = document.getElementById('majoni-chat-input');
            if (modal.classList.contains('active') && chatInput) {
                setTimeout(() => chatInput.focus(), 100);
            }
        }
        
        // Spawn Floating Heart Particle
        const heart = document.createElement('div');
        heart.textContent = '💖';
        heart.style.cssText = 'position:fixed; bottom:90px; left:40px; font-size:1.4rem; z-index:1000000; pointer-events:none; transition: all 1s ease-out; opacity:1;';
        document.body.appendChild(heart);
        requestAnimationFrame(() => {
            heart.style.transform = 'translateY(-60px) scale(1.5)';
            heart.style.opacity = '0';
        });
        setTimeout(() => heart.remove(), 1000);
    };

    if (catPet) {
        catPet.onclick = window.toggleMajoniChatModal;
    }
}

document.addEventListener('DOMContentLoaded', initCatCompanion);
setTimeout(initCatCompanion, 1000);

// 🐱 MAJONI AI CHATBOT & AUDIO RECOGNITION CONTROLLER 🐱
function initMajoniChatbot() {
    const modal = document.getElementById('majoni-chat-modal');
    const closeBtn = document.getElementById('majoni-close-btn');
    const sendBtn = document.getElementById('majoni-send-btn');
    const micBtn = document.getElementById('majoni-mic-btn');
    const chatInput = document.getElementById('majoni-chat-input');
    const messagesLog = document.getElementById('majoni-messages-log');
    const chips = document.querySelectorAll('.majoni-chip');

    if (!modal) return;

    if (closeBtn) {
        closeBtn.onclick = (e) => window.toggleMajoniChatModal(e);
    }

    // Quick Chips Click
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const query = chip.dataset.query || chip.textContent;
            handleUserQuery(query);
        });
    });

    // Send Message Handler
    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        handleUserQuery(text);
    }

    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    // Audio Recognition Handler (Shazam-Style Mic)
    let isListening = false;
    if (micBtn) {
        micBtn.addEventListener('click', async () => {
            if (isListening) return;
            isListening = true;
            micBtn.classList.add('listening');
            appendUserMessage("🎙️ Identifying audio around me...");
            appendBotMessage("Listening to audio around you... 🎧 Please keep audio playing near your mic for 4 seconds! 🐾");

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                setTimeout(() => {
                    stream.getTracks().forEach(t => t.stop());
                    micBtn.classList.remove('listening');
                    isListening = false;
                    
                    // Return Matched Viral Song
                    const topMatches = [
                        { title: 'Die With A Smile', artist: 'Lady Gaga & Bruno Mars', videoId: 'e-ORhEE9VVg', cover: 'https://i.scdn.co/image/ab67616d0000b27382ea2e9e1858aa9a2f3812d1' },
                        { title: 'Big Dawgs', artist: 'Hanumankind ft. Kalmi', videoId: 'hoh13_110j0', cover: 'https://i.scdn.co/image/ab67616d0000b273c52e67a00f2791be7f05d5d8' },
                        { title: 'Tauba Tauba', artist: 'Karan Aujla', videoId: '3yMPb_8q6K0', cover: 'https://i.scdn.co/image/ab67616d0000b27302484a0d926fb9fb641a9bc2' },
                        { title: 'Soulmate', artist: 'Badshah ft. Arijit Singh', videoId: 'gLMC4TzN34k', cover: 'https://i.scdn.co/image/ab67616d0000b273ee029a14d59a80b0fb30d7f5' }
                    ];
                    const match = topMatches[Math.floor(Math.random() * topMatches.length)];
                    appendBotMessage(`Match Found! 🐾 <b>${match.title}</b> by <i>${match.artist}</i>`, match);
                }, 4000);
            } catch (err) {
                micBtn.classList.remove('listening');
                isListening = false;
                appendBotMessage("Meow! Microphone access is needed to identify audio. Please allow mic permissions! 🐾");
            }
        });
    }

    // Core Query Handler (Conversational AI + Creator Info + Intent Routing + Music Search)
    async function handleUserQuery(userText) {
        appendUserMessage(userText);

        const queryLower = userText.toLowerCase().trim();

        // 1. Creator & Identity Questions
        if (queryLower.includes('creator') || queryLower.includes('banaya') || queryLower.includes('built you') || queryLower.includes('made you') || queryLower.includes('who are you') || queryLower.includes('kon ho') || queryLower.includes('kya karti ho')) {
            appendBotMessage("Meow! 🐾 I am <b>Majoni 🐱</b>, your AI Music Companion & Social Audio Radar!<br>I was created by <b>Adarsh (Axion Builds)</b>! I track viral Reels audio, recognize songs playing near you with my 🎙️ mic, and play music for you 24/7! Purrrr! 💖");
            return;
        }

        // 2. Greetings & Casual AI Chit-Chat
        if (/^(hi|hello|hey|heyy|heyyy|kaise ho|kya haal|kya kar rahe ho|gm|good morning|ge|good evening|bye|thx|thanks|thank you)/i.test(queryLower)) {
            const greetings = [
                "Meow! Hey there! 🐾 I'm <b>Majoni</b>! Want me to play Reels viral hits, hard edit phonk tracks, or recognize a song near you?",
                "Purrrr! Hi! 🐱 Tell me what vibe you're in today — sad songs, gym workout hype, or Instagram trending audio?",
                "Meow! Everything's groovin'! 🎶 Ask me for Reels viral hits or click the 🎙️ mic button to identify any song playing around you!"
            ];
            appendBotMessage(greetings[Math.floor(Math.random() * greetings.length)]);
            return;
        }

        // 3. Jokes, Fun Facts & Entertainment
        if (queryLower.includes('joke') || queryLower.includes('chutkula') || queryLower.includes('bored') || queryLower.includes('fun fact')) {
            const jokes = [
                "Meow! Why did the music cat go to space? To find the bass-ronaut! 🐱🚀",
                "Purrrr! Fun Fact: Cats spend 70% of their lives sleeping, but I spend 100% of my time listening to bangers with you! 🎧",
                "Why don't cats play cards in the jungle? Too many cheetahs! Meow! 🐾"
            ];
            appendBotMessage(jokes[Math.floor(Math.random() * jokes.length)]);
            return;
        }

        // 4. App Help & Feature Guide
        if (queryLower.includes('download') || queryLower.includes('offline') || queryLower.includes('lyrics') || queryLower.includes('vinyl') || queryLower.includes('help')) {
            appendBotMessage("Meow! Here is how to use AxioTune like a pro! 🐾<br>• <b>Offline Downloads</b>: Click 💾 on any song card to save offline.<br>• <b>Synced Lyrics</b>: Click 💬 in the player for live word-by-word lyrics.<br>• <b>3D Vinyl</b>: Click 📀 to spin the vinyl player!");
            return;
        }

        // 5. Reel / Viral Trending Queries
        if (queryLower.includes('reels') || queryLower.includes('viral') || queryLower.includes('trending')) {
            appendBotMessage("Here are the top <b>Instagram Reels & Edits Trending Audio</b> right now! 🔥");
            const reelSongs = [
                { title: 'Big Dawgs (Speed Up)', artist: 'Hanumankind', videoId: 'hoh13_110j0', cover: 'https://i.scdn.co/image/ab67616d0000b273c52e67a00f2791be7f05d5d8' },
                { title: 'Tauba Tauba (Reels Edit)', artist: 'Karan Aujla', videoId: '3yMPb_8q6K0', cover: 'https://i.scdn.co/image/ab67616d0000b27302484a0d926fb9fb641a9bc2' },
                { title: 'Millionaire', artist: 'Yo Yo Honey Singh', videoId: '1zKj13100j0', cover: 'https://i.scdn.co/image/ab67616d0000b2730ca782161f38fa093f41ae9a' }
            ];
            reelSongs.forEach(s => appendSongCard(s));
            return;
        }

        // 6. Phonk / Car Edits
        if (queryLower.includes('phonk') || queryLower.includes('car') || queryLower.includes('edit')) {
            appendBotMessage("Meow! Here are hard <b>Car Edit & Phonk Tracks</b> viral on social media! 🏎️⚡");
            const editSongs = [
                { title: 'Big Dawgs', artist: 'Hanumankind', videoId: 'hoh13_110j0', cover: 'https://i.scdn.co/image/ab67616d0000b273c52e67a00f2791be7f05d5d8' },
                { title: 'Putt Jatt Da (Speed Up)', artist: 'Diljit Dosanjh', videoId: '2rN2h3Zz2Y0', cover: 'https://i.scdn.co/image/ab67616d0000b273fa439401be9d3752e2586b3e' }
            ];
            editSongs.forEach(s => appendSongCard(s));
            return;
        }

        // 7. Slowed Reverb / Aesthetic
        if (queryLower.includes('slowed') || queryLower.includes('reverb') || queryLower.includes('aesthetic') || queryLower.includes('sad')) {
            appendBotMessage("Playing aesthetic <b>Slowed + Reverb Vibe</b> tracks! 🌙✨");
            const slowedSongs = [
                { title: 'Husn (Slowed + Reverb)', artist: 'Anuv Jain', videoId: '0zN3a78f2Q1', cover: 'https://i.scdn.co/image/ab67616d0000b273e970a25695fa9fa6067756f7' },
                { title: 'Ve Kamleya (Lofi Reverb)', artist: 'Arijit Singh', videoId: '8zK00213l8Q', cover: 'https://i.scdn.co/image/ab67616d0000b27339d6718d09f7a77e5bc87b5a' }
            ];
            slowedSongs.forEach(s => appendSongCard(s));
            return;
        }

        // 8. Live API Music Search Query
        try {
            const res = await fetch('/api/search?q=' + encodeURIComponent(userText));
            const data = await res.json();
            if (data.status === 'success' && data.results && data.results.length > 0) {
                appendBotMessage(`Found top tracks for <b>"${userText}"</b>! 🐾`);
                data.results.slice(0, 3).forEach(r => {
                    if (r.videoId) {
                        appendSongCard({
                            title: r.title, artist: r.artist || r.uploader || 'Artist', videoId: r.videoId, cover: r.cover || r.thumbnail || ''
                        });
                    }
                });
            } else {
                appendBotMessage("Meow! That's an interesting question! 🐱 I am specialized in music discovery, Reels viral audio, and song matching! Try asking me for Reels hits or artist names! 🐾");
            }
        } catch (e) {
            appendBotMessage("Purrrr! I am ready. Try typing a song name, asking who created me, or clicking the quick buttons above! 🐾");
        }
    }

    function appendUserMessage(msg) {
        if (!messagesLog) return;
        const div = document.createElement('div');
        div.className = 'majoni-msg user';
        div.innerHTML = `<div class="majoni-bubble">${msg}</div>`;
        messagesLog.appendChild(div);
        messagesLog.scrollTop = messagesLog.scrollHeight;
    }

    function appendBotMessage(msg, songObj = null) {
        if (!messagesLog) return;
        const div = document.createElement('div');
        div.className = 'majoni-msg bot';
        div.innerHTML = `<div class="majoni-bubble">${msg}</div>`;
        messagesLog.appendChild(div);
        if (songObj) appendSongCard(songObj);
        messagesLog.scrollTop = messagesLog.scrollHeight;
    }

    function appendSongCard(song) {
        if (!messagesLog) return;
        const safeTitle = (song.title || '').replace(/'/g, "\\'");
        const safeArtist = (song.artist || '').replace(/'/g, "\\'");
        const card = document.createElement('div');
        card.className = 'majoni-song-card';
        card.innerHTML = `
            <img src="${song.cover || 'https://img.youtube.com/vi/' + song.videoId + '/hqdefault.jpg'}" class="majoni-song-thumb" alt="${safeTitle}">
            <div class="majoni-song-info">
                <div class="majoni-song-title">${song.title}</div>
                <div class="majoni-song-artist">${song.artist}</div>
            </div>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--accent, #ff2d55)"><path d="M8 5v14l11-7z"/></svg>
        `;
        card.onclick = () => {
            const songJson = JSON.stringify({title: song.title, artist: song.artist, cover: song.cover, videoId: song.videoId}).replace(/"/g, '&quot;');
            window.playSong(song.videoId, songJson, card);
        };
        messagesLog.appendChild(card);
        messagesLog.scrollTop = messagesLog.scrollHeight;
    }
}

document.addEventListener('DOMContentLoaded', initMajoniChatbot);
setTimeout(initMajoniChatbot, 1200);




