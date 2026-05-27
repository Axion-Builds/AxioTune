const audioPlayer = document.getElementById('audio-player');
        const playPauseBtn = document.getElementById('play-pause-btn');
        const songSearchInput = document.getElementById('song-search');
        const searchBtn = document.getElementById('search-btn');
        const lyricsContainer = document.getElementById('lyrics-container');
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

        // ── IndexedDB Offline Storage Setup ──
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
        async function removeDownloadedSong(id) {
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

        // ── Offline Mode Handler ──
        function updateNetworkStatus() {
            if (!navigator.onLine) {
                document.body.classList.add('offline-mode');
                showToast('You are offline. Showing downloaded songs.');
                // Force to Library -> Downloads
                showScreen('library-screen');
                document.querySelector('.lib-tab[data-tab="local"]')?.click();
            } else {
                document.body.classList.remove('offline-mode');
                showToast('Back online!');
            }
        }
        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);
        
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

        // ── NEW FEATURE STATE ──
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
        document.getElementById('mini-like-btn')?.addEventListener('click', () => toggleLike());
        
        document.getElementById('download-btn')?.addEventListener('click', () => {
            if (!currentSongMeta || !currentSongMeta.id) return;
            showToast('Starting Download...');
            window.location.href = `/api/download?id=${currentSongMeta.id}&title=${encodeURIComponent(currentSongMeta.title)}`;
        });

        // ── SHUFFLE ──
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
        });

        // ── REPEAT ──
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
        });

        // ── TOAST NOTIFICATION ──
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

        // ── LIBRARY SCREEN LOGIC ──
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
                        <button class="song-options-btn" onclick="event.stopPropagation(); removeDownloadedSong('${song.id}');">
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
            
            queue = songs.map(s => ({
                ...s,
                localUrl: window._downloadedCache[s.id] || URL.createObjectURL(s.blob)
            }));
            const index = queue.findIndex(s => s.id === id);
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
                        <img src="${artist.thumb}" crossorigin="anonymous" alt="${artist.name}">
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
                container.innerHTML = '<div class="empty-state lib-empty">No liked songs yet.<br><span>Tap ♥ while a song plays to save it here.</span></div>';
                return;
            }
            container.innerHTML = '';
            liked.forEach((song, idx) => {
                const coverUrl = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '');
                const row = document.createElement('div');
                row.className = 'liked-song-row';
                row.style.animationDelay = `${idx * 0.04}s`;
                row.innerHTML = `
                    <img src="${coverUrl}" crossorigin="anonymous">
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
                        <img src="${coverUrl}" style="width: 100%; height: 100%; object-fit: cover;" crossorigin="anonymous">
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
                const covers = pl.songs.slice(0, 4).map(s => getCoverUrl(`${s.title} ${s.artist}`, s.cover || ''));
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

        // ═══ PLAYLIST FULL PAGE ═══
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
            countEl.textContent = `${pl.songs.length} song${pl.songs.length !== 1 ? 's' : ''}  •  Your Playlist`;

            // Build mosaic art or use custom cover
            const covers = pl.songs.slice(0, 4).map(s => getCoverUrl(`${s.title} ${s.artist}`, s.cover || ''));
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
                    const coverUrl = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '');
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
                        showToast(`▶ Playing from ${pl.name}`);
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
                    showToast(`▶ Playing ${pl.name}`);
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

        // Handle ENTER key in search — show results page first
        songSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = songSearchInput.value.trim();
                if (q) showSearchResultsPage(q);
            }
        });

        // ============================================================
        // VOLUME CONTROLS (Keyboard & Scroll)
        // ============================================================
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                let v = Math.min(1, audioPlayer.volume + 0.05);
                audioPlayer.volume = v;
                showToast(`Volume: ${Math.round(v * 100)}%`);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                let v = Math.max(0, audioPlayer.volume - 0.05);
                audioPlayer.volume = v;
                showToast(`Volume: ${Math.round(v * 100)}%`);
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
        // GLOBAL COVER URL HELPER — routes ALL images through backend
        // This proxy: 1) fetches iTunes artwork, 2) falls back to YT thumb
        // No CORS, no expiry, works from any device on the network!
        // ============================================================
        function resolveYtThumb(ytThumb) {
            if (!ytThumb || typeof ytThumb !== 'string') return '';
            if (ytThumb.includes('/api/cover')) return ''; // Avoid double proxying
            return ytThumb;
        }

        function getCoverUrl(query, ytThumb) {
            const params = new URLSearchParams();
            if (query) params.set('q', query);
            const thumb = resolveYtThumb(ytThumb);
            if (thumb) params.set('yt_thumb', thumb);
            return `/api/cover?${params.toString()}`;
        }

        function getEntryCoverUrl(entry) {
            const title = entry.title || '';
            const artist = entry.artist || '';
            const query = `${title} ${artist}`.trim();
            const thumb = resolveYtThumb(entry.cover) || resolveYtThumb(entry.ytThumb) || '';
            return getCoverUrl(query, thumb);
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
        // SETTINGS ENGINE — All settings, fully working, persisted
        // ============================================================
        const SETTINGS_KEY = 'app_settings_v1';
        const DEFAULT_SETTINGS = {
            accentColor: '#ff476d', accentRgb: '255,71,109',
            bgBrightness: 50, glassBlur: '30px', cardLayout: 'vinyl',
            audioQuality: 'hq', playbackSpeed: 100, crossfade: 3,
            autoplay: true, sleepTimerMins: 0,
            normalizeVolume: false, lyricsFontSize: 'clamp(1.2rem,2.5vw,2.2rem)',
            lyricsFont: 'inherit', lyricsStyle: 'bold',
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
            // Lyrics font size & family & style
            root.style.setProperty('--lyrics-font-size', s.lyricsFontSize);
            root.style.setProperty('--lyrics-font-family', s.lyricsFont);
            // Lyrics active style
            const styleTag = document.getElementById('dynamic-lyric-style') || (() => {
                const t = document.createElement('style'); t.id = 'dynamic-lyric-style';
                document.head.appendChild(t); return t;
            })();
            if (s.lyricsStyle === 'glow') {
                styleTag.textContent = '.lyric-line.active-line { text-shadow: 0 0 20px var(--accent), 0 0 40px var(--accent); filter: none !important; }';
            } else if (s.lyricsStyle === 'underline') {
                styleTag.textContent = '.lyric-line.active-line { text-decoration: underline; text-decoration-color: var(--accent); filter: none !important; }';
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
            // Volume normalize via Web Audio
            if (s.normalizeVolume && !gainNode) {
                try {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const source = audioContext.createMediaElementSource(audioPlayer);
                    const compressor = audioContext.createDynamicsCompressor();
                    gainNode = audioContext.createGain();
                    gainNode.gain.value = 1.0;
                    source.connect(compressor); compressor.connect(gainNode); gainNode.connect(audioContext.destination);
                } catch(e) { console.warn('Normalize init fail:', e); }
            }
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
                display.textContent = `Sleeping in ${mins}:00`;
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

        // ── Global Back Button ──
        const globalBackBtn = document.getElementById('global-back-btn');
        const screenHistory = []; // Track screen navigation history

        globalBackBtn?.addEventListener('click', () => {
            if (screenHistory.length > 0) {
                const prev = screenHistory.pop();
                // Use the built-in show helpers if they're available, else raw switch
                if (prev === 'home-screen' && typeof showHome === 'function') { showHome(); return; }
                if (prev === 'player-screen' && typeof showPlayer === 'function') { showPlayer(); return; }
                if (prev === 'history-screen' && typeof showHistory === 'function') { showHistory(); return; }
                if (prev === 'settings-screen' && typeof showSettings === 'function') { showSettings(); return; }
                // Fallback raw switch
                if (typeof showScreenExcept === 'function') { showScreenExcept(prev); return; }
            }
            // No history — go home
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
                const coverSrc = r.cover ? getCoverUrl(r.query, r.cover) : 'default_cover.jpg';
                const badgeClass = `suggest-badge badge-${r.type}`;
                const badgeLabel = r.type === 'video' ? '🎬 Video' : r.type === 'artist' ? '👤 Artist' : r.type === 'album' ? '💿 Album' : '🎵 Song';
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

        // Double-tap seek on player screen
        let lastTapTime = 0, lastTapSide = '';
        document.getElementById('player-screen')?.addEventListener('touchend', (e) => {
            if (!appSettings.doubleTapSeek || !isSongLoaded) return;
            const now = Date.now();
            const screenW = window.innerWidth;
            const tapX = e.changedTouches[0].clientX;
            const side = tapX < screenW / 2 ? 'left' : 'right';
            if (now - lastTapTime < 350 && side === lastTapSide) {
                if (side === 'right') audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
                else audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
                if (appSettings.haptic && navigator.vibrate) navigator.vibrate(30);
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
        ['play-pause-btn','next-btn','prev-btn','mini-play-pause-btn'].forEach(id => {
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
                const fromRect = fromEl.getBoundingClientRect();
                
                // Force destination screen to active state temporarily for perfect measurement
                const toScreen = toEl.closest('.screen-view');
                let screenWasHidden = false;
                let screenOriginalTransition = '';
                if (toScreen && toScreen.classList.contains('hidden-screen')) {
                    screenWasHidden = true;
                    screenOriginalTransition = toScreen.style.transition;
                    toScreen.style.transition = 'none';
                    toScreen.classList.remove('hidden-screen');
                    toScreen.classList.add('active-screen');
                }
                
                const wasHidden = miniPlayer.classList.contains('hidden-mini');
                if (wasHidden) {
                    miniPlayer.style.transition = 'none';
                    miniPlayer.classList.remove('hidden-mini');
                }
                
                const toRect = toEl.getBoundingClientRect();
                
                if (wasHidden) {
                    miniPlayer.classList.add('hidden-mini');
                    miniPlayer.style.transition = '';
                }
                
                if (screenWasHidden) {
                    toScreen.classList.remove('active-screen');
                    toScreen.classList.add('hidden-screen');
                    toScreen.offsetHeight; // force reflow
                    toScreen.style.transition = screenOriginalTransition;
                }
                
                ghostCover.src = coverArt.src || 'default_cover.jpg';
                ghostCover.style.transition = 'none';
                ghostCover.style.left = `${fromRect.left}px`;
                ghostCover.style.top = `${fromRect.top}px`;
                ghostCover.style.width = `${fromRect.width}px`;
                ghostCover.style.height = `${fromRect.height}px`;
                ghostCover.style.borderRadius = window.getComputedStyle(fromEl).borderRadius;
                ghostCover.style.opacity = '1';
                
                // Hide actual elements immediately without transition trailing
                fromEl.style.transition = 'none';
                toEl.style.transition = 'none';
                fromEl.style.opacity = '0';
                toEl.style.opacity = '0';
                
                ghostCover.offsetHeight; // force reflow
                
                // Match the 0.85s screen transition for perfectly synchronized movement
                ghostCover.style.transition = 'all 0.85s cubic-bezier(0.33, 1, 0.68, 1)';
                ghostCover.style.left = `${toRect.left}px`;
                ghostCover.style.top = `${toRect.top}px`;
                ghostCover.style.width = `${toRect.width}px`;
                ghostCover.style.height = `${toRect.height}px`;
                ghostCover.style.borderRadius = window.getComputedStyle(toEl).borderRadius;
                
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
        
        miniPlayPauseBtn.addEventListener('click', () => {
            if (audioPlayer.paused) audioPlayer.play();
            else audioPlayer.pause();
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
            if (appSettings.incognito) return; // Incognito mode — skip saving
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

        // ── QUEUE SYSTEM ──
        let queueList = [];
        let currentQueueIndex = -1;
        const queueNavBtn = document.getElementById('floating-queue-btn');
        const queuePanel = document.getElementById('queue-panel');
        const closeQueueBtn = document.getElementById('close-queue-btn');
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        let queueOpen = false;

        function openQueue() {
            queueOpen = true;
            queuePanel.style.transform = 'translateX(0)';
            queueNavBtn.classList.add('active');
            renderQueue();
        }

        function closeQueue() {
            queueOpen = false;
            queuePanel.style.transform = 'translateX(100%)';
            queueNavBtn.classList.remove('active');
        }

        let queueCloseTimer = null;
        
        function toggleQueue() {
            if (queueOpen) closeQueue(); else openQueue();
        }

        queueNavBtn.addEventListener('click', toggleQueue);
        queueNavBtn.addEventListener('mouseenter', () => {
            clearTimeout(queueCloseTimer);
            openQueue();
        });
        queueNavBtn.addEventListener('mouseleave', () => {
            queueCloseTimer = setTimeout(() => {
                if (!queuePanel.matches(':hover')) closeQueue();
            }, 300);
        });
        
        closeQueueBtn.addEventListener('click', closeQueue);
        
        queuePanel.addEventListener('mouseenter', () => clearTimeout(queueCloseTimer));
        queuePanel.addEventListener('mouseleave', () => {
            queueCloseTimer = setTimeout(closeQueue, 400);
        });
        
        document.addEventListener('click', (e) => {
            if (queueOpen && !queuePanel.contains(e.target) && !queueNavBtn.contains(e.target)) {
                closeQueue();
            }
        });

        const playSVG = ''; // Legacy — black hole uses bh-icon approach
        const pauseSVG = ''; // Legacy — black hole uses bh-icon approach

        // Black hole icon toggle helper
        function setBhIcon(playing) {
            const playIcon = playPauseBtn.querySelector('.bh-play-icon');
            const pauseIcon = playPauseBtn.querySelector('.bh-pause-icon');
            if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
            if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
        }

        async function populateQueue(videoId, append = false) {
            try {
                const res = await fetch(`/api/recommendations?videoId=${encodeURIComponent(videoId)}`);
                const data = await res.json();
                if(data.status === 'success' && data.recommendations.length > 0) {
                    if (append) {
                        const existingIds = new Set(queueList.map(s => s.videoId));
                        data.recommendations.forEach(s => {
                            if (!existingIds.has(s.videoId)) {
                                queueList.push(s);
                            }
                        });
                    } else {
                        // FIX: Prepend the currently playing song since the backend recommendations omit the seed song
                        queueList = [
                            {
                                videoId: currentVideoId,
                                title: currentSongMeta ? currentSongMeta.title : 'Unknown',
                                artist: currentSongMeta ? currentSongMeta.artist : 'Unknown',
                                cover: currentSongMeta ? currentSongMeta.cover : ''
                            },
                            ...data.recommendations
                        ];
                        currentQueueIndex = 0; 
                    }
                    renderQueue();
                    prefetchNextSong(); // Start prefetching the next song for zero latency
                }
            } catch(e) {}
        }
        
        window.playTrackFromList = function(songJsonStr) {
            try {
                const song = JSON.parse(songJsonStr.replace(/&quot;/g, '"'));
//                 songSearchInput.value = `${song.title} ${song.artist}`;
                searchBtn.click();
            } catch(e) { console.error(e); }
        };

        let prefetchedStreamUrl = null;
        let prefetchVideoId = null;

        async function fetchStreamUrl(videoId, refresh = false) {
            const refreshParam = refresh ? '&refresh=true' : '';
            const res = await fetch(`/api/stream?id=${encodeURIComponent(videoId)}${refreshParam}`);
            if (!res.ok) throw new Error('Stream request failed');
            const data = await res.json();
            if (!data.url) throw new Error(data.message || 'No stream URL returned');
            return data;
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
                audioPlayer.src = streamData.url;
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
                showToast('Could not refresh stream — try searching again');
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

        // 🎬 CINEMATIC CARDS UPDATER 🎬
        window.updateCinematicCards = function() {
            const prevContainer = document.getElementById('cinematic-prev');
            const nextContainer = document.getElementById('cinematic-next');
            if (!prevContainer || !nextContainer) return;

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
                prevImg.src = getCoverUrl(`${prevSong.title} ${prevSong.artist}`, prevSong.cover || '');
                prevContainer.style.opacity = '';
                prevContainer.onclick = () => playQueueIndex(currentQueueIndex - 1);
            } else {
                prevContainer.style.opacity = '0';
                prevContainer.onclick = null;
            }

            // Next Card
            if (currentQueueIndex < queueList.length - 1) {
                const nextSong = queueList[currentQueueIndex + 1];
                nextImg.src = getCoverUrl(`${nextSong.title} ${nextSong.artist}`, nextSong.cover || '');
                nextContainer.style.opacity = '';
                nextContainer.onclick = () => playQueueIndex(currentQueueIndex + 1);
            } else {
                nextContainer.style.opacity = '0';
                nextContainer.onclick = null;
            }
        };

        function renderQueue() {
            if (typeof updateCinematicCards === 'function') updateCinematicCards();
            const qList = document.getElementById('queue-list');
            qList.innerHTML = '';
            if (queueList.length === 0) {
                qList.innerHTML = '<div class="empty-state" style="font-size:1.2rem;">Queue is empty</div>';
                return;
            }
            queueList.forEach((song, idx) => {
                const thumbUrl = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '');

                const div = document.createElement('div');
                div.className = `premium-list-item ${idx === currentQueueIndex ? 'playing' : ''}`;
                div.style.transitionDelay = `${idx * 0.05}s`;
                div.innerHTML = `
                    <img src="${thumbUrl}" class="queue-cover">
                    <div class="premium-list-info">
                        <div class="premium-list-title">${song.title}</div>
                        <div class="premium-list-artist">${song.artist}</div>
                    </div>
                    ${idx === currentQueueIndex ? `
                        <div class="premium-play-btn" style="opacity:1; transform:scale(1); background:rgba(255, 71, 109, 0.8);">
                            <svg viewBox="0 0 24 24" style="width:12px; height:12px;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        </div>
                    ` : `
                        <button class="premium-play-btn">
                            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                    `}
                `;
                div.addEventListener('click', () => {
                    if(idx === currentQueueIndex) { playPauseBtn.click(); return; }
                    playQueueIndex(idx);
                });
                
                setTimeout(() => { div.style.opacity = '1'; }, 50);
                qList.appendChild(div);
            });
        }

        // ── Reliable queue navigation — no DOM click dependency ──
        function playQueueIndex(idx) {
            if (idx < 0 || idx >= queueList.length) return;
            const isNext = (idx === currentQueueIndex + 1);
            currentQueueIndex = idx;
            renderQueue();
            const song = queueList[idx];
            
            if (song.localUrl) {
                // Local File Pipeline Bypass
                isSongLoaded = true;
                currentSongMeta = song;
                document.getElementById('track-title').textContent = song.title;
                document.getElementById('track-artist').textContent = song.artist;
                document.getElementById('mini-track-title').textContent = song.title;
                document.getElementById('mini-track-artist').textContent = song.artist;
                coverArt.src = song.cover;
                miniCover.src = song.cover;
                backgroundLayer.style.backgroundImage = `url(${song.cover})`;
                document.body.classList.add('song-playing');
                
                // Clear old lyrics
                lyricsData = [];
                wordElements = [];
                lineElements = [];
                lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">Lyrics not available offline</div>';
                
                audioPlayer.src = song.localUrl;
                audioPlayer.play().catch(e => console.log('Local play error:', e));
                setPlayPauseUI(true);
                showPlayer();
                return;
            }
            
            // Handle gapless prefetch handover
            if (isNext && prefetchVideoId === song.videoId && prefetchedStreamUrl) {
                window.prefetchedStreamData = { url: prefetchedStreamUrl, quality: "Prefetched" };
                audioPlayer.src = prefetchedStreamUrl;
                audioPlayer.play().catch(e => console.warn("Prefetch play failed:", e));
                prefetchedStreamUrl = null;
                prefetchVideoId = null;
            } else {
                window.prefetchedStreamData = null;
                audioPlayer.pause();
                // Do not clear src abruptly, it breaks Chrome's media pipeline under rapid skips
            }
            
            // Trigger fast direct playback bypassing search
            window._forceQueueSong = song;
            songSearchInput.value = song.title + ' ' + song.artist;
            searchBtn.click();
        }

        // --- PIPELINE ---
        let currentPlaybackToken = 0;
        let searchAbortController = null;
        
        searchBtn.addEventListener('click', async () => {
            initAudioVisualizer(); // Initialize visualizer on first interaction
            const query = songSearchInput.value.trim();
            if (!query) return;

            currentPlaybackToken++;
            const myToken = currentPlaybackToken;

            if (searchAbortController) searchAbortController.abort();
            searchAbortController = new AbortController();
            const signal = searchAbortController.signal;

            showPlayer(); // Switch to player UI when searching
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
            
            try {
                // STEP 1: Get song metadata (Bypass search if forced from queue)
                let songData;
                const isFromQueue = !!window._forceQueueSong;
                
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

                // Immediately update UI with what we have
                trackTitleEl.textContent = songData.title;
                trackArtistEl.textContent = songData.uploader;
                miniTitle.textContent = songData.title;
                miniArtist.textContent = songData.uploader;
                trackTitleEl.classList.remove('title-changing');
                void trackTitleEl.offsetWidth;
                trackTitleEl.classList.add('title-changing');

                // Set cover immediately (show spinner-style blur while loading)
                const rawYtThumb = resolveYtThumb(songData.thumbnail);
                const actualSongQuery = `${songData.title} ${songData.uploader}`;
                const coverUrl = getCoverUrl(actualSongQuery, rawYtThumb, true);
                coverArt.style.opacity = '0.4';
                
                // Instantly show low-res YouTube thumbnail for snappy UI
                if (rawYtThumb) {
                    coverArt.src = rawYtThumb;
                    miniCover.src = rawYtThumb;
                    // Keep background layer low-res! Blurring HD images kills GPU performance.
                    backgroundLayer.style.backgroundImage = `url(${rawYtThumb})`;
                    document.body.classList.add('song-playing');
                }
                updateMediaSession(songData.title, songData.uploader, rawYtThumb || 'default_cover.jpg');
                
                coverArt.style.display = 'block';
                document.getElementById('default-cover-icon').style.display = 'none';
                
                // Upgrade to HD iTunes cover silently in background (Only for the actual cover art, NOT the blurred background)
                const hdImg = new Image();
                hdImg.onload = () => {
                    coverArt.src = hdImg.src;
                    miniCover.src = hdImg.src;
                    updateMediaSession(songData.title, songData.uploader, hdImg.src);
                    coverArt.style.opacity = '1';
                    coverArt.classList.remove('cover-changing');
                    void coverArt.offsetWidth;
                    coverArt.classList.add('cover-changing');
                };
                hdImg.src = coverUrl;

                saveToHistory(songData, rawYtThumb);

                // Update currentSongMeta and sync Like button UI
                currentSongMeta = {
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
                
                // If it was injected by playQueueIndex, it's valid.
                // If it was lingering from prefetchNextSong but doesn't match the new search, discard it!
                if (window.prefetchedStreamData && (!prefetchVideoId || prefetchVideoId === currentVideoId)) {
                    streamData = window.prefetchedStreamData;
                    window.prefetchedStreamData = null;
                    lrc1 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { signal });
                    if (myToken !== currentPlaybackToken) return; // Race condition check
                    
                    // src and play() were already triggered seamlessly in playQueueIndex
                    // Just ensure it's playing in case of browser autoplay blocks
                    if (audioPlayer.paused) audioPlayer.play().catch(e => console.warn("Play failed:", e));
                } else {
                    const [streamRes, lrcRes] = await Promise.all([
                        fetch(`/api/stream?id=${encodeURIComponent(songData.id)}`, { signal }).then(r => {
                            if (!r.ok) throw new Error('Stream request failed');
                            return r.json();
                        }),
                        fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { signal })
                    ]);
                    
                    if (myToken !== currentPlaybackToken) return; // Race condition check
                    
                    streamData = streamRes;
                    if (!streamData.url) throw new Error(streamData.message || 'No stream URL returned');
                    lrc1 = lrcRes;
                    
                    // Set src — this automatically triggers load. Then play.
                    audioPlayer.src = streamData.url;
                    audioPlayer.play().catch(e => console.warn("Play failed:", e));
                }

                isSongLoaded = true;
                playPauseBtn.disabled = false;
                nextBtn.disabled = false;
                prevBtn.disabled = false;
                
                // If it's a manual search, replace the queue. If auto-playing from queue, append to infinite radio!
                populateQueue(songData.videoId || songData.id, isFromQueue);

                // Quality badge
                if (streamData.quality) {
                    const badge = document.createElement('div');
                    badge.style.cssText = 'position:fixed;top:20px;right:80px;background:rgba(var(--accent-rgb),0.85);color:white;padding:6px 14px;border-radius:20px;font-size:0.8rem;font-weight:600;z-index:9999;backdrop-filter:blur(10px);transition:opacity 1s;';
                    badge.textContent = `🎵 ${streamData.quality}`;
                    document.body.appendChild(badge);
                    setTimeout(() => { badge.style.opacity = '0'; setTimeout(() => badge.remove(), 1000); }, 3000);
                }

                // STEP 3: Now process lyrics (already fetched in parallel)
                lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">🎵 Syncing lyrics...</div>';
                try {
                    let bestMatch = null;
                    let lrcData = await lrc1.json();
                    if (lrcData && lrcData.length > 0) bestMatch = lrcData.find(item => item.syncedLyrics);

                    // Try 2: Clean Title + Clean Artist
                    if (!bestMatch) {
                        const lrc2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`);
                        lrcData = await lrc2.json();
                        if (lrcData && lrcData.length > 0) bestMatch = lrcData.find(item => item.syncedLyrics);
                    }

                    // Try 3: Just clean title
                    if (!bestMatch) {
                        const lrc3 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`);
                        lrcData = await lrc3.json();
                        if (lrcData && lrcData.length > 0) bestMatch = lrcData.find(item => item.syncedLyrics);
                    }

                    // Render Lyrics if found
                    if (bestMatch && bestMatch.syncedLyrics) {
                        lyricsData = convertLrcToJson(bestMatch.syncedLyrics);
                        renderLyrics();
                    } else {
                        lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">No synced lyrics found for this specific song yet.<br><br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
                    }
                } catch (lrcErr) {
                    lyricsContainer.innerHTML = '<div class="empty-state" style="margin-top:0;">Lyrics Database overloaded.<br><span style="font-size:1rem; opacity:0.7">Audio is playing beautifully though!</span></div>';
                }
                
                                                
            } catch (e) {
                if (e.name === 'AbortError') return; // Ignore aborted fetches from rapid skipping
                lyricsContainer.innerHTML = `<div class="empty-state" style="margin-top:0;">Error connecting to Audio Server. Make sure the python terminal is open.</div>`;
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
        });

        audioPlayer.addEventListener('pause', () => {
            setBhIcon(false);
            miniPlayPauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
            playPauseBtn.classList.remove('playing');
            coverArtContainer.classList.remove('playing');
            document.getElementById('cover-wrapper').classList.remove('playing');
            hideCatWidget && hideCatWidget();
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
            if (!audioPlayer.duration) return;
            progressBar.style.width = `${(audioPlayer.currentTime / audioPlayer.duration) * 100}%`;
            currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
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
            for (let i = 0; i < parsedData.length; i++) {
                const current = parsedData[i];
                let endTime = (i < parsedData.length - 1) ? parsedData[i + 1].start : current.start + 5;
                if (endTime - current.start > 6) endTime = current.start + 6;
                
                const lineData = { start: current.start, end: endTime, words: [] };
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
            }
            return converted;
        }

        function renderLyrics() {
            lyricsContainer.innerHTML = '';
            wordElements = []; lineElements = []; activeLineIndex = -1;

            if (lyricsData.length === 0) return;

            lyricsData.forEach((line, lineIdx) => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'lyric-line';
                lineDiv.dataset.index = lineIdx;
                lineDiv.addEventListener('click', () => {
                    audioPlayer.currentTime = line.start;
                    if (audioPlayer.paused) audioPlayer.play();
                });

                line.words.forEach((word) => {
                    const wordSpan = document.createElement('span');
                    wordSpan.className = 'lyric-word';
                    wordSpan.textContent = word.text;
                    wordSpan.dataset.start = word.start;
                    wordSpan.dataset.end = word.end;
                    lineDiv.appendChild(wordSpan);
                    lineDiv.appendChild(document.createTextNode(' '));
                    wordElements.push({ el: wordSpan, start: word.start, end: word.end, state: 'future' });
                });

                lyricsContainer.appendChild(lineDiv);
                lineElements.push({ el: lineDiv, start: line.start, end: line.end });
            });
            
            requestAnimationFrame(processLyricsFrame);
        }

        window.addEventListener('resize', processLyricsFrame);

        function animationLoop() {
            if (!audioPlayer.paused) processLyricsFrame();
            else if (Math.abs(targetY - currentY) > 0.1) lerpScroll();
            requestAnimationFrame(animationLoop);
        }

        function processLyricsFrame() {
            const time = audioPlayer.currentTime;
            let currentLineIndex = -1;

            for (let i = 0; i < wordElements.length; i++) {
                const w = wordElements[i];
                if (time < w.start) {
                    if (w.state !== 'future') { w.el.className = 'lyric-word'; w.el.style.setProperty('--progress', '0%'); w.state = 'future'; }
                } else if (time >= w.start && time <= w.end) {
                    let percentage = Math.max(0, Math.min(100, ((time - w.start) / (w.end - w.start)) * 100));
                    w.el.style.setProperty('--progress', `${percentage}%`);
                    if (w.state !== 'active') { w.el.className = 'lyric-word active'; w.state = 'active'; }
                } else {
                    if (w.state !== 'passed') { w.el.className = 'lyric-word passed'; w.el.style.setProperty('--progress', '100%'); w.state = 'passed'; }
                }
            }

            for (let i = 0; i < lineElements.length; i++) {
                if (time >= lineElements[i].start) currentLineIndex = i;
            }

            if (activeLineIndex !== currentLineIndex) {
                if (activeLineIndex !== -1 && lineElements[activeLineIndex]) lineElements[activeLineIndex].el.classList.remove('active-line');
                if (currentLineIndex !== -1 && lineElements[currentLineIndex]) lineElements[currentLineIndex].el.classList.add('active-line');
                activeLineIndex = currentLineIndex;
            }

            const panelHeight = rightPanel.offsetHeight;
            if (activeLineIndex !== -1 && lineElements[activeLineIndex]) {
                targetY = (panelHeight / 2) - (lineElements[activeLineIndex].el.offsetHeight / 2) - lineElements[activeLineIndex].el.offsetTop;
            } else if (lineElements.length > 0) {
                targetY = (panelHeight / 2) - (lineElements[0].el.offsetHeight / 2) - lineElements[0].el.offsetTop;
            } else targetY = panelHeight / 2;

            lerpScroll();
        }

        function lerpScroll() {
            const diff = targetY - currentY;
            if (Math.abs(diff) > 0.5) {
                currentY += diff * 0.08; 
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
                if(btn.id === 'queue-nav-btn') return; // Handled separately
                
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

        // Chameleon Glow Logic
        function updateChameleonGlow() {
            try {
                if (!coverArt.src || coverArt.src === window.location.href) return;
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 1; canvas.height = 1;
                // Draw entire image into 1x1 canvas to get the average color
                ctx.drawImage(coverArt, 0, 0, coverArt.naturalWidth || 600, coverArt.naturalHeight || 600, 0, 0, 1, 1);
                const data = ctx.getImageData(0, 0, 1, 1).data;
                const r = data[0], g = data[1], b = data[2];
                // Set custom CSS variable for the drop shadow glow
                sideNavEl.style.setProperty('--chameleon-glow', `rgba(${r},${g},${b},0.5)`);
            } catch(e) {
                // Ignore CORS errors if image doesn't allow canvas extraction
                sideNavEl.style.setProperty('--chameleon-glow', `rgba(255,255,255,0.05)`);
            }
        }
        
        coverArt.addEventListener('load', updateChameleonGlow);

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
                    populateDenseGrid('jump-back-in-container', uniqueHistory.slice(0, 16));
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
                                            <h2 class="section-title">🔥 ${q}</h2>
                                            <div class="dense-grid-container" id="${sectionId}"></div>
                                        </div>`);
                                    populateDenseGrid(sectionId, [{ title: tData.title, artist: tData.uploader, cover: tData.thumbnail, query: q }]);
                                }
                            }
                        } catch(e2) { /* ignore */ }
                    }
                    if (!dynamicContainer.innerHTML.trim()) {
                        dynamicContainer.innerHTML = '<div class="empty-state" style="opacity:0.5; font-size:0.9rem;">Sync your YouTube Music account in ⚙️ Settings to see personalized recommendations.</div>';
                    }
                }
            } catch(e) {
                console.error("Failed to load home feeds", e);
                document.getElementById('dynamic-sections').innerHTML = '<div class="empty-state">Network error fetching feeds.</div>';
            }
        }

        function populateDenseGrid(containerId, entries) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            entries.forEach((item, idx) => {
                const title = item.title || item.name || 'Unknown Title';
                const subtitle = item.artist || item.uploader || 'Unknown Artist';
                const rawThumb = item.cover || item.thumbnail || item.thumb || '';
                // Use backend cover proxy for reliable images
                const thumb = getCoverUrl(`${title} ${subtitle}`, rawThumb);
                const videoId = item.videoId || item.id;
                const query = `${title} ${subtitle}`;
                
                const card = document.createElement('div');
                card.className = 'dense-card';
                card.style.animationDelay = `${idx * 0.03}s`;
                card.setAttribute('data-query', query);
                card.innerHTML = `
                    <img src="${thumb}" crossorigin="anonymous" alt="" class="dense-card-cover" loading="lazy" decoding="async" onerror="this.src='default_cover.jpg'">
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
                    <img src="${coverUrl}" crossorigin="anonymous" alt="${artist.name}" title="${artist.name}">
                    <div class="artist-scalloped-name">${artist.name}</div>
                `;
                card.onclick = () => showArtistPage(artist.name);
                container.appendChild(card);
            });
        }

        // ═══ SMART RECOMMENDATION ENGINE ═══
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
                                allRecs.push({ videoId: s.videoId, title: s.title, artist: s.artist, cover: s.thumbnail, type: 'song' });
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

            populateDenseGrid('home-taste-mix-container', allRecs.slice(0, 24));
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
                            <img src="${getCoverUrl(song.title + ' ' + song.artist, song.cover || '')}" 
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
                        videoId: s.videoId, title: s.title, artist: s.artist, cover: s.thumbnail, type: 'song'
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
                
                // Use backend proxy — iTunes first, then YouTube thumb, never black!
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
        function showScreenExcept(showId) {
            // Record current screen in history for back button
            const currentScreen = ['home-screen','player-screen','history-screen','settings-screen','artist-screen','album-screen','library-screen','search-screen','playlist-full-screen'].find(id => {
                const el = document.getElementById(id);
                return el && el.classList.contains('active-screen');
            });
            if (currentScreen && currentScreen !== showId && typeof screenHistory !== 'undefined') {
                screenHistory.push(currentScreen);
            }

            ['home-screen', 'player-screen', 'history-screen', 'settings-screen', 'artist-screen', 'album-screen', 'library-screen', 'search-screen', 'playlist-full-screen'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (id === showId) {
                    el.classList.remove('hidden-screen');
                    el.classList.add('active-screen');
                } else {
                    el.classList.remove('active-screen');
                    el.classList.add('hidden-screen');
                }
            });
            document.getElementById('queue-panel').classList.remove('open');
        }
        window.showScreen = showScreenExcept;
        const showScreen = showScreenExcept;

        // ═══════════════════════════════════════════════
        // SEARCH RESULTS PAGE
        // ═══════════════════════════════════════════════
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
                contentEl.innerHTML = `<div class="sr-empty"><span>🔍</span>No results found.<br>Try a different search term.</div>`;
                return;
            }

            let delay = 0;

            // 🎵 SONGS & TOP RESULT 🎵
            if (songs.length > 0) {
                if (cat === 'all') {
                    // Top Result + Stacked layout
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">🎵 Top Results & Songs</div>
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
                        <img src="${topSong.cover || 'default_cover.jpg'}" alt="${topSong.title.replace(/"/g, '&quot;')}">
                        <div class="sr-top-title">${topSong.title}</div>
                        <div class="sr-top-type">Song • ${topSong.artist}</div>
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
                            <img src="${s.cover || 'default_cover.jpg'}">
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
                            <img class="sr-song-cover" src="${s.cover || 'default_cover.jpg'}">
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

            // 🎵 VIDEOS & TOP RESULT 🎵
            if (videos.length > 0) {
                if (cat === 'all') {
                    // Top Result + Stacked layout
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">🎬 Top Video & More</div>
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
                        <img src="${topVideo.cover || 'default_cover.jpg'}" alt="${topVideo.title.replace(/"/g, '&quot;')}" style="border-radius: 8px; width: 140px; height: 78px; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
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
                            <img src="${v.cover || 'default_cover.jpg'}" style="width: 80px; height: 45px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
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
                            <img class="sr-song-cover" src="${v.cover || 'default_cover.jpg'}" style="border-radius:8px;">
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

            // 🎵 ALBUMS 🎵
            if (albums.length > 0) {
                if (cat === 'all') {
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">💿 Albums</div>
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
                        <img class="sr-card-cover" src="${a.cover || 'default_cover.jpg'}">
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

            // 🎵 ARTISTS 🎵
            if (artists.length > 0) {
                if (cat === 'all') {
                    const headerHtml = `<div class="section-header">
                        <div class="sr-section-title" style="margin:0;">🎤 Artists</div>
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
                        <img class="sr-card-cover" src="${ar.cover || 'default_cover.jpg'}">
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
                    const subs = artist.subscribers ? ` • ${artist.subscribers}` : '';
                    
                    let html = `
                        <div class="hero-banner">
                            <div class="hero-bg" style="background-image: url('${thumb}')"></div>
                            <div class="hero-content">
                                <img src="${thumb}" alt="${artist.name}" class="hero-avatar anim-pop" crossorigin="anonymous">
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
                            const songThumb = song.thumbnails && song.thumbnails.length > 0 ? getCoverUrl(song.title, song.thumbnails[song.thumbnails.length-1].url) : 'default_cover.jpg';
                            const songJson = JSON.stringify({title: song.title, artist: artist.name}).replace(/"/g, '&quot;');
                            if(idx === 0) firstSongJson = songJson;
                            const delay = 0.4 + (idx * 0.05);
                            html += `
                                <div class="tracklist-item anim-slide-up" style="animation-delay: ${delay}s" onclick="playTrackFromList('${songJson}')">
                                    <div class="tracklist-index">${idx + 1}</div>
                                    <img src="${songThumb}" crossorigin="anonymous">
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
                            const albThumb = album.thumbnails && album.thumbnails.length > 0 ? getCoverUrl(album.title, album.thumbnails[album.thumbnails.length-1].url) : 'default_cover.jpg';
                            html += `
                                <div class="vinyl-card" onclick="showAlbumPage('${album.browseId}')">
                                    <div class="vinyl-cover-wrapper">
                                        <div class="vinyl-disc"></div>
                                        <img src="${albThumb}" class="vinyl-cover" crossorigin="anonymous">
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
                    const thumb = album.thumbnails && album.thumbnails.length > 0 ? getCoverUrl(album.title, album.thumbnails[album.thumbnails.length-1].url) : 'default_cover.jpg';
                    const artistName = album.artists && album.artists.length > 0 ? album.artists[0].name : 'Unknown Artist';
                    
                    let html = `
                        <div class="hero-banner">
                            <div class="hero-bg" style="background-image: url('${thumb}')"></div>
                            <div class="hero-content">
                                <img src="${thumb}" alt="${album.title}" class="hero-album-cover anim-pop" crossorigin="anonymous">
                                <div class="hero-info">
                                    <h1 class="anim-slide-up" style="animation-delay: 0.1s">${album.title}</h1>
                                    <p class="anim-slide-up" style="animation-delay: 0.2s">${artistName} • ${album.year || ''} • ${album.trackCount || 0} tracks</p>
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
                    countEl.textContent = `${pl.trackCount || pl.tracks?.length || 0} songs  •  Community Playlist`;

                    const thumb = pl.thumbnails && pl.thumbnails.length > 0 ? getCoverUrl(pl.title, pl.thumbnails[pl.thumbnails.length-1].url) : 'default_cover.jpg';
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
                            const trackThumb = track.thumbnails && track.thumbnails.length > 0 ? getCoverUrl(track.title, track.thumbnails[track.thumbnails.length-1].url) : 'default_cover.jpg';
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
                                window._forceQueueSong = { videoId: track.videoId, title: track.title, artist: trackArtist, cover: trackThumb };
                                songSearchInput.value = `${track.title} ${trackArtist}`;
                                searchBtn.click();
                                showToast(`▶ Playing from ${pl.title}`);
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
                                const first = pl.tracks[0];
                                const firstArtist = first.artists && first.artists.length > 0 ? first.artists[0].name : 'Unknown Artist';
                                const firstThumb = first.thumbnails && first.thumbnails.length > 0 ? first.thumbnails[first.thumbnails.length-1].url : '';
                                window._forceQueueSong = { videoId: first.videoId, title: first.title, artist: firstArtist, cover: firstThumb };
                                songSearchInput.value = `${first.title} ${firstArtist}`;
                                searchBtn.click();
                                showToast(`▶ Playing ${pl.title}`);
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
                window._forceQueueSong = { videoId, title: song.title, artist: song.artist, thumbnail: song.cover || song.thumbnail };
                searchBtn.click();
            } catch(e) { console.error(e); }
        };

        // ── COVER ART FLOAT ANIMATION ──
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

        // ── MOOD RADIO SYSTEM ──
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
                        showToast(`📻 ${mood} Radio loaded!`);
                    } else {
                        container.innerHTML = '<div class="empty-state">Nothing found. Try another mood!</div>';
                    }
                } catch(e) {
                    chip.classList.remove('loading');
                    container.innerHTML = '<div class="empty-state">Network error. Check server.</div>';
                }
            });
        });

        // ── PLAYLIST DETAIL MODAL ──
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
            const covers = pl.songs.slice(0, 4).map(s => getCoverUrl(`${s.title} ${s.artist}`, s.cover || ''));
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
                        queue = [...pl.songs];
                        currentQueueIndex = sIdx;
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

        // renderPlaylists is defined at line 485 — no duplicate needed here

        // ── PREMIUM QUEUE RENDERER ──
        function renderQueue() {
            if (typeof updateCinematicCards === 'function') updateCinematicCards();
            const qList = document.getElementById('queue-list');
            qList.innerHTML = '';

            if (queueList.length === 0) {
                qList.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;opacity:0.5;">
                        <svg viewBox="0 0 24 24" style="width:48px;height:48px;fill:white;"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>
                        <div style="font-size:0.95rem;color:rgba(255,255,255,0.6);">Queue is empty</div>
                        <div style="font-size:0.78rem;color:rgba(255,255,255,0.35);">Play a song to auto-fill</div>
                    </div>`;
                return;
            }

            const nowPlayingSong = queueList[currentQueueIndex];

            // ── NOW PLAYING HERO CARD ──
            if (nowPlayingSong) {
                const heroThumb = getCoverUrl(`${nowPlayingSong.title} ${nowPlayingSong.artist}`, nowPlayingSong.cover || '');
                const hero = document.createElement('div');
                hero.style.cssText = `
                    position:relative; border-radius:18px; overflow:hidden;
                    margin-bottom:28px; cursor:pointer;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
                `;
                hero.innerHTML = `
                    <img src="${heroThumb}" style="width:100%;height:180px;object-fit:cover;display:block;border-radius:18px;">
                    <div style="position:absolute;inset:0;background:linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%, transparent 100%);border-radius:18px;"></div>
                    <div style="position:absolute;bottom:0;left:0;right:0;padding:16px 18px;display:flex;align-items:flex-end;justify-content:space-between;">
                        <div>
                            <div style="font-size:0.62rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent,#ff476d);margin-bottom:4px;">♪ Now Playing</div>
                            <div style="font-size:1rem;font-weight:700;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${nowPlayingSong.title}</div>
                            <div style="font-size:0.8rem;color:rgba(255,255,255,0.65);margin-top:2px;">${nowPlayingSong.artist}</div>
                        </div>
                        <div style="display:flex;align-items:flex-end;gap:3px;height:28px;padding-bottom:2px;">
                            <div style="width:4px;background:var(--accent,#ff476d);border-radius:3px;animation:qEq 0.9s ease-in-out infinite;transform-origin:bottom;"></div>
                            <div style="width:4px;background:var(--accent,#ff476d);border-radius:3px;animation:qEq 1.2s ease-in-out infinite 0.15s;transform-origin:bottom;"></div>
                            <div style="width:4px;background:var(--accent,#ff476d);border-radius:3px;animation:qEq 0.75s ease-in-out infinite 0.08s;transform-origin:bottom;"></div>
                            <div style="width:4px;background:var(--accent,#ff476d);border-radius:3px;animation:qEq 1.05s ease-in-out infinite 0.22s;transform-origin:bottom;"></div>
                        </div>
                    </div>
                `;
                hero.addEventListener('click', () => playPauseBtn.click());
                qList.appendChild(hero);
            }

            // Inject keyframes once
            if (!document.getElementById('qEq-style')) {
                const s = document.createElement('style');
                s.id = 'qEq-style';
                s.textContent = `
                    @keyframes qEq {
                        0%,100%{height:4px} 50%{height:24px}
                    }
                    .q-row {
                        display:flex; align-items:center; gap:12px;
                        padding:10px 12px; border-radius:14px;
                        background:rgba(255,255,255,0.04);
                        border:1px solid rgba(255,255,255,0.06);
                        margin-bottom:8px; cursor:pointer;
                        transition: background 0.2s, transform 0.15s, border-color 0.2s;
                        opacity:0; transform:translateX(18px);
                    }
                    .q-row:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.15); transform:translateX(0) scale(1.01);}
                    .q-row.q-next { border-color:rgba(255,71,109,0.25); background:rgba(255,71,109,0.06); }
                    .q-cover { width:44px;height:44px;border-radius:10px;object-fit:cover;flex-shrink:0; }
                    .q-info { flex:1; min-width:0; }
                    .q-title { font-size:0.88rem;font-weight:600;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
                    .q-artist { font-size:0.75rem;color:rgba(255,255,255,0.5);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
                    .q-remove-btn { opacity:0; background:transparent;border:none;color:rgba(255,255,255,0.4);cursor:pointer;padding:4px;border-radius:6px;transition:opacity 0.2s,color 0.2s;flex-shrink:0; }
                    .q-row:hover .q-remove-btn { opacity:1; }
                    .q-remove-btn:hover { color:rgba(255,80,80,0.9); }
                    .q-badge { font-size:0.6rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:2px 7px;border-radius:20px;flex-shrink:0; }
                    .q-badge-next { background:rgba(255,71,109,0.18);color:var(--accent,#ff476d); }
                    .q-badge-num { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.35); }
                `;
                document.head.appendChild(s);
            }

            // ── UP NEXT LABEL ──
            const upNextSongs = queueList.filter((_, i) => i !== currentQueueIndex);
            if (upNextSongs.length > 0) {
                const label = document.createElement('div');
                label.style.cssText = 'font-size:0.68rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin:0 4px 10px;';
                label.textContent = `Up Next · ${upNextSongs.length} song${upNextSongs.length !== 1 ? 's' : ''}`;
                qList.appendChild(label);
            }

            // ── SONG ROWS (skip now-playing) ──
            let upNextCount = 0;
            queueList.forEach((song, idx) => {
                if (idx === currentQueueIndex) return; // hero card handles this

                upNextCount++;
                const isNext = idx === currentQueueIndex + 1;
                const thumbUrl = getCoverUrl(`${song.title} ${song.artist}`, song.cover || '');

                const row = document.createElement('div');
                row.className = `q-row${isNext ? ' q-next' : ''}`;

                row.innerHTML = `
                    <img src="${thumbUrl}" class="q-cover" onerror="this.style.background='rgba(255,255,255,0.1)'">
                    <div class="q-info">
                        <div class="q-title">${song.title}</div>
                        <div class="q-artist">${song.artist}</div>
                    </div>
                    <span class="q-badge ${isNext ? 'q-badge-next' : 'q-badge-num'}">${isNext ? 'Next' : '#' + (upNextCount)}</span>
                    <button class="q-remove-btn remove-queue-btn" data-idx="${idx}" title="Remove">
                        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                `;

                row.addEventListener('click', (e) => {
                    if (e.target.closest('.remove-queue-btn')) {
                        e.stopPropagation();
                        queueList.splice(idx, 1);
                        if (currentQueueIndex >= idx && currentQueueIndex > 0) currentQueueIndex--;
                        renderQueue();
                        return;
                    }
                    if (idx === currentQueueIndex) {
                        playPauseBtn.click();
                        return;
                    }
                    playQueueIndex(idx);
                });

                // Staggered entrance animation
                setTimeout(() => {
                    row.style.transition = 'opacity 0.35s ease, transform 0.35s cubic-bezier(0.2,0.8,0.2,1), background 0.2s, border-color 0.2s';
                    row.style.opacity = '1';
                    row.style.transform = 'translateX(0)';
                }, 30 + upNextCount * 45);

                qList.appendChild(row);
            });

            if (upNextSongs.length === 0 && nowPlayingSong) {
                const end = document.createElement('div');
                end.style.cssText = 'text-align:center;padding:20px;font-size:0.8rem;color:rgba(255,255,255,0.25);';
                end.textContent = '— End of queue —';
                qList.appendChild(end);
            }
        }

        
        // Clear Queue Button
        document.getElementById('clear-queue-btn').addEventListener('click', () => {
            if(queueList.length <= 1) return;
            const currentSong = queueList[currentQueueIndex];
            queueList.splice(0, queueList.length);
            if(currentSong) {
                queueList.push(currentSong);
                currentQueueIndex = 0;
            }
            renderQueue();
        });

        // ── YOUTUBE MUSIC ACCOUNT SYNC LOGIC ──
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
                showToast("❌ Please paste your raw browser headers first!");
                return;
            }

            syncBtn.disabled = true;
            const originalText = syncBtn.textContent;
            syncBtn.textContent = '⚡ Syncing account...';

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
                    showToast("❌ Sync failed: " + (data.message || "Invalid headers."));
                }
            } catch(e) {
                showToast("❌ Network error while syncing.");
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
                showToast("☁️ Account Disconnected!");
                await checkSyncStatus();
                loadTrendingFeeds(); // Reload standard trending feed
            } catch(e) {
                showToast("❌ Failed to disconnect account.");
            }
        });

        // ── 1-CLICK BOOKMARKLET REDIRECT HANDLER ──
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
                <div style="font-size: 3.5rem; margin-bottom: 24px;">⚡</div>
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
                        <div style="font-size: 3.5rem; margin-bottom: 24px;">🎉</div>
                        <div style="font-size: 1.6rem; font-weight: 700; color: #28cd41; margin-bottom: 12px; letter-spacing:-0.5px;">Sync Successful!</div>
                        <div style="font-size: 0.95rem; color: rgba(255,255,255,0.8); margin-bottom: 24px; max-width:400px; line-height:1.5;">Your personalized YouTube Music feed, playlists, and liked songs have been successfully loaded.</div>
                        <button onclick="window.close();" style="padding: 12px 28px; background: #28cd41; color: white; border: none; border-radius: 12px; font-weight: 700; font-size:0.95rem; cursor: pointer; box-shadow: 0 4px 15px rgba(40,205,65,0.3);">Close This Tab</button>
                    `;
                } else {
                    overlay.innerHTML = `
                        <div style="font-size: 3.5rem; margin-bottom: 24px;">❌</div>
                        <div style="font-size: 1.6rem; font-weight: 700; color: #ff476d; margin-bottom: 12px; letter-spacing:-0.5px;">Sync Failed</div>
                        <div style="font-size: 0.95rem; color: rgba(255,255,255,0.8); margin-bottom: 24px; max-width:400px; line-height:1.5;">${data.message}</div>
                        <button onclick="document.body.removeChild(this.parentNode);" style="padding: 12px 28px; background: rgba(255,255,255,0.1); color: white; border: none; border-radius: 12px; font-weight: 700; font-size:0.95rem; cursor: pointer;">Go to Streamer</button>
                    `;
                }
            })
            .catch(err => {
                overlay.innerHTML = `
                    <div style="font-size: 3.5rem; margin-bottom: 24px;">❌</div>
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
                showToast("☁️ YouTube Music account synced successfully!");
            }
        });

        // ── Song Context Menu Logic ──
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
                                    <button class="pip-btn pip-play-btn" id="pip-play">${document.getElementById('audio-player').paused ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}</button>
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
                    document.getElementById('audio-player').currentTime = pos * document.getElementById('audio-player').duration;
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
    const ap = document.getElementById('audio-player');
    
    // Update Play/Pause Icon
    pipDoc.getElementById('pip-play').innerHTML = ap.paused ? 
        '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : 
        '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
}

function updatePiPProgress() {
    if (!window.pipWindow) return;
    const pipDoc = window.pipWindow.document;
    const ap = document.getElementById('audio-player');
    
    if (ap.duration) {
        pipDoc.getElementById('pip-prog-fill').style.width = (ap.currentTime / ap.duration * 100) + '%';
        pipDoc.getElementById('pip-curr').textContent = formatTime(ap.currentTime);
        pipDoc.getElementById('pip-dur').textContent = formatTime(ap.duration);
    }
}

// Hook into existing events (We need to monkey patch or add listeners where state changes)
const originalAudioPlayer = document.getElementById('audio-player');
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

// --- Web Audio API Optimizer (YouTube Music / Spotify style Sound Enhancement) ---
let audioCtx;
let audioSourceNode;
let isAudioOptimized = false;

function initAudioOptimizer() {
    if (isAudioOptimized) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        audioCtx = new AudioContext();
        
        // Ensure context is resumed (browser autoplay policy)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const audioEl = document.getElementById('audio-player');
        // Check if we already created a source for this media element
        if (audioEl._audioSourceNode) {
             audioSourceNode = audioEl._audioSourceNode;
        } else {
             audioSourceNode = audioCtx.createMediaElementSource(audioEl);
             audioEl._audioSourceNode = audioSourceNode;
        }

        // 1. Bass Boost (LowShelf Filter) - adds warmth and punch
        const bassBoost = audioCtx.createBiquadFilter();
        bassBoost.type = 'lowshelf';
        bassBoost.frequency.value = 85; // Hz
        bassBoost.gain.value = 4.5; // dB boost

        // 2. High Frequency Clarity (HighShelf Filter) - vocal clarity
        const trebleBoost = audioCtx.createBiquadFilter();
        trebleBoost.type = 'highshelf';
        trebleBoost.frequency.value = 8000;
        trebleBoost.gain.value = 2.5;

        // 3. Dynamic Range Compressor (Punchy & normalized)
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 30;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.25;

        // Connect the audio pipeline
        audioSourceNode.connect(bassBoost);
        bassBoost.connect(trebleBoost);
        trebleBoost.connect(compressor);
        compressor.connect(audioCtx.destination);

        isAudioOptimized = true;
        console.log("Audio Optimizer Initialized! 🎧 Sound quality enhanced.");
    } catch(e) {
        console.warn("Audio Optimizer failed to initialize:", e);
    }
}

// Initialize audio context on first user interaction to comply with autoplay policies
document.addEventListener('click', () => { 
    // if(!isAudioOptimized) initAudioOptimizer(); // Temporarily disabled due to CORS restrictions on YouTube audio
}, { once: true });



document.addEventListener('DOMContentLoaded', () => {
    // Performance Mode
    const perfToggle = document.getElementById('performance-mode-toggle');
    if (perfToggle) {
        const perfVal = localStorage.getItem('apple_performance_mode');
        const isPerf = perfVal === null ? true : perfVal === 'true';
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
                <img src="${artist.thumb}" crossorigin="anonymous" alt="${artist.name}">
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
                const songThumb = song.thumbnails && song.thumbnails.length > 0 ? getCoverUrl(song.title, song.thumbnails[song.thumbnails.length-1].url) : 'default_cover.jpg';
                const songJson = JSON.stringify({title: song.title, artist: artistName}).replace(/"/g, '&quot;');
                
                html += `
                    <div class="sr-card album anim-slide-up" style="animation-delay: ${0.05 + (Math.min(idx, 20) * 0.05)}s" onclick="playSong('${song.videoId}', '${songJson}', this)">
                        <img src="${songThumb}" class="sr-card-cover" crossorigin="anonymous" alt="${song.title}">
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

window.installPWA = async function() {
    if (!window.deferredPrompt) {
        alert("To install AxioTune on desktop:\n1. Look at the top right of your browser's address bar.\n2. Click the 'Install' icon (it looks like a screen with a downward arrow or a '+' sign).\n3. Click 'Install'.\n\nIf you don't see it, it might already be installed!");
        return;
    }
    // Show the install prompt
    window.deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await window.deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    window.deferredPrompt = null;
    if(window.toggleDownloadMenu) window.toggleDownloadMenu();
    
    // Hide the install button if it exists
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
};




// Download Menu Logic
window.toggleDownloadMenu = function(e) {
    if(e) e.stopPropagation();
    const menu = document.getElementById('download-dropdown-menu');
    if(menu) {
        menu.classList.toggle('hidden-dropdown');
    }
};

window.showMobileInstallAlert = function() {
    window.toggleDownloadMenu();
    // Change this link to your direct APK download link or GitHub releases page later
    const githubReleasesLink = 'https://github.com/adarshshukla/apple-music-clone/releases';
    window.open(githubReleasesLink, '_blank');
};

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('download-dropdown-menu');
    const btn = document.getElementById('download-app-btn');
    if (menu && !menu.classList.contains('hidden-dropdown')) {
        if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
            menu.classList.add('hidden-dropdown');
        }
    }
});
// URL Parsing for Shared Songs
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
                        query: `${data.title} ${data.uploader}`,
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

function toggleDarkMode() {
    document.body.classList.toggle('pitch-black-mode');
    document.documentElement.classList.toggle('pitch-black-mode');
    const btn = document.getElementById('dark-mode-btn');
    if(document.body.classList.contains('pitch-black-mode')) {
        btn.style.background = 'rgba(255, 71, 109, 0.2)';
        btn.style.color = '#ff476d';
    } else {
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
        btn.style.color = 'rgba(255,255,255,0.6)';
    }
}

