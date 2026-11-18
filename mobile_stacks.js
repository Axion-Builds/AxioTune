/**
 * AxioTune Dynamic Mobile Home Stacks Algorithm Engine
 * Dynamically populates all 9 card stacking layouts based on:
 * 1. "Because you listened to [Seed 1]" (Fan deck) -> Algorithmic recommendations for user's last played song
 * 2. "Your taste mix" (Bento mix) -> Blended cross-genre portfolio of liked songs & favorite artists
 * 3. "Your shelf" (Record spines) -> User's saved & liked vinyl shelf
 * 4. "Pick up where you left" (Arc carousel) -> Chronological listening history (recents)
 * 5. "Coverflow / Quick Picks" (3D Coverflow) -> Smart Quick Picks & discovery albums
 * 6. "Because you listened to [Seed 2]" (Polaroid pile) -> Recommendations for secondary seed song
 * 7. "Vinyl peek • [Mood]" (Vinyl peek) -> Dynamic time-of-day mood radio tracks
 * 8. "Discover" (Marquee rows) -> Global trending & fresh indie releases
 * 9. "Top 8 this week" (Top chart) -> Official ranked weekly chart toppers (#1 to #8)
 */
(function () {
    'use strict';

    // High quality fallback seeds if user history is brand new
    const CURATED_LIBRARY = [
        { id: 'dracula', t: 'Dracula', a: 'Tame Impala ft. JENNIE', c: '#E8745B', img: 'cover_dracula.jpg', videoId: '7Tst_QhP4lI' },
        { id: 'wide_awake', t: 'Wide Awake', a: 'Katy Perry', c: '#9A8CE0', img: 'cover_wide_awake.jpg', videoId: 'k0BWlvnBmIE' },
        { id: 'harleys', t: 'Harleys In Hawaii', a: 'Katy Perry', c: '#D9A86C', img: 'cover_harleys.jpg', videoId: 'sQEgke1107Y' },
        { id: '34_35', t: '34+35', a: 'Ariana Grande', c: '#4FB3A3', img: 'cover_34_35.jpg', videoId: 'B6_iQ9MaNBo' },
        { id: 'positions', t: 'positions', a: 'Ariana Grande', c: '#E58AA8', img: 'cover_positions.jpg', videoId: 'tcYodQoapMg' },
        { id: 'attention', t: 'Attention', a: 'Charlie Puth', c: '#F3E9DB', img: 'cover_attention.jpg', videoId: 'nfs8NYg7yQM' },
        { id: 'starboy', t: 'Starboy', a: 'The Weeknd ft. Daft Punk', c: '#7FA8E8', img: 'cover_starboy.jpg', videoId: '34Na4j8AVgA' },
        { id: 'something_about_you', t: 'Something About You', a: 'Eyedress, Dent May', c: '#C7B37A', img: 'cover_something_about_you.jpg', videoId: 'P1Z9s8yJ7g0' }
    ];

    function getHistory() {
        try {
            if (typeof window.getHistoryList === 'function') {
                const list = window.getHistoryList();
                if (list && list.length > 0) return list;
            }
            const raw = localStorage.getItem('music_history_full');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return [];
    }

    function getLiked() {
        try {
            if (typeof window.getLikedSongs === 'function') {
                const list = window.getLikedSongs();
                if (list && list.length > 0) return list;
            }
            const raw = localStorage.getItem('liked_songs');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return [];
    }

    function formatTrack(item, fallbackColor) {
        if (!item) return null;
        const title = item.title || item.t || 'Unknown Title';
        const artist = item.artist || item.a || item.uploader || 'Unknown Artist';
        const cover = item.cover || item.thumbnail || item.img || 'default_cover.jpg';
        const vid = item.videoId || item.id || '';
        return {
            id: vid || title,
            videoId: vid,
            t: title,
            a: artist,
            c: fallbackColor || '#333',
            img: cover
        };
    }

    const onPlay = function (s) {
        if (!s) return;
        console.log('[AxioTune Dynamic Stacks] Playing:', s.t, 'by', s.a);
        if (typeof window.playSong === 'function') {
            window.playSong(s.videoId || s.id, {
                title: s.t,
                artist: s.a,
                cover: s.img || 'default_cover.jpg',
                videoId: s.videoId || s.id
            });
        } else if (typeof window.searchAndPlay === 'function') {
            window.searchAndPlay(s.t + ' ' + s.a);
        }
        window.dispatchEvent(new CustomEvent('ax:play', { detail: s }));
    };

    const cov = function (s, cls) {
        const d = document.createElement('div');
        d.className = 'ax-cover ' + (cls || '');
        d.style.setProperty('--c', s.c || '#222');
        if (s.img) {
            d.style.setProperty('background-image', 'url("' + s.img + '")', 'important');
        }
        return d;
    };

    const clamp = function (v, a, b) {
        return Math.max(a, Math.min(b, v));
    };

    // ── High-Precision Gesture Deck Engine (Fan, Arc, Coverflow) ──
    function deck(root, songs, layout, options) {
        if (!root || !songs || songs.length === 0) return;
        options = options || {};
        const w = options.w || 168;
        const h = options.h || 250;
        const cls = options.cls || '';

        root.innerHTML = '';
        root.className = 'ax-deck ' + cls;
        root.style.setProperty('--w', w + 'px');
        root.style.setProperty('--h', h + 'px');

        const wrap = root.parentNode;
        let meta = wrap.querySelector('.ax-meta');
        if (!meta) {
            meta = document.createElement('div');
            meta.className = 'ax-meta';
            meta.innerHTML = '<b></b><span></span>';
            wrap.appendChild(meta);
        }

        let cur = 0;
        const cards = songs.map(function (s) {
            const c = document.createElement('div');
            c.className = 'ax-card';
            c.appendChild(cov(s));
            root.appendChild(c);
            return c;
        });

        function paint(dx) {
            dx = dx || 0;
            cards.forEach(function (c, i) {
                const o = i - cur;
                const L = layout(o, dx);
                c.style.transform = L.t;
                c.style.opacity = L.o;
                c.style.zIndex = L.z;
                c.classList.toggle('on', o === 0);
            });
        }

        function label() {
            meta.classList.add('sw');
            setTimeout(function () {
                if (songs[cur]) {
                    meta.querySelector('b').textContent = songs[cur].t;
                    meta.querySelector('span').textContent = songs[cur].a;
                }
                meta.classList.remove('sw');
            }, 120);
        }

        function go(i) {
            cur = Math.max(0, Math.min(songs.length - 1, i));
            paint();
            label();
        }

        let startX = 0, startY = 0;
        let isDragging = false;
        let gestureLocked = false;
        let isHorizontalSwipe = false;
        let currentDx = 0;

        function onPointerDown(e) {
            startX = e.clientX;
            startY = e.clientY;
            currentDx = 0;
            isDragging = true;
            gestureLocked = false;
            isHorizontalSwipe = false;
        }

        function onPointerMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!gestureLocked) {
                if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) {
                    isDragging = false;
                    gestureLocked = true;
                    cards.forEach(function (c) { c.classList.remove('drag'); });
                    return;
                } else if (Math.abs(dx) > 7 && Math.abs(dx) >= Math.abs(dy)) {
                    gestureLocked = true;
                    isHorizontalSwipe = true;
                    try {
                        if (root.setPointerCapture) root.setPointerCapture(e.pointerId);
                    } catch (err) {}
                    cards.forEach(function (c) { c.classList.add('drag'); });
                }
            }

            if (isHorizontalSwipe) {
                currentDx = dx;
                paint(dx);
            }
        }

        function onPointerUp(e) {
            if (!isDragging && !isHorizontalSwipe) return;

            cards.forEach(function (c) { c.classList.remove('drag'); });
            try {
                if (root.hasPointerCapture && root.hasPointerCapture(e.pointerId)) {
                    root.releasePointerCapture(e.pointerId);
                }
            } catch (err) {}

            if (isHorizontalSwipe) {
                if (currentDx < -35) {
                    go(cur + 1);
                } else if (currentDx > 35) {
                    go(cur - 1);
                } else {
                    paint(0);
                }
            } else {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                const i = cards.findIndex(function (c) { return c.contains(el); });
                if (i === cur) {
                    onPlay(songs[cur]);
                } else if (i > -1) {
                    go(i);
                }
            }

            isDragging = false;
            isHorizontalSwipe = false;
            gestureLocked = false;
            currentDx = 0;
        }

        root.addEventListener('pointerdown', onPointerDown, { passive: true });
        root.addEventListener('pointermove', onPointerMove, { passive: true });
        root.addEventListener('pointerup', onPointerUp);
        root.addEventListener('pointercancel', onPointerUp);

        go(0);
    }

    // ── Helper to fetch recommendations for a seed song ──
    async function fetchRecommendations(videoId, query) {
        if (!videoId && !query) return [];
        try {
            if (videoId) {
                const res = await fetch('/api/recommendations?video_id=' + encodeURIComponent(videoId));
                const data = await res.json();
                const list = data.tracks || data.results || (data.section && data.section.contents);
                if (Array.isArray(list) && list.length > 0) {
                    return list.map((item, idx) => formatTrack(item, CURATED_LIBRARY[idx % CURATED_LIBRARY.length].c)).filter(Boolean);
                }
            }
            if (query) {
                const res = await fetch('/api/search?q=' + encodeURIComponent(query));
                const data = await res.json();
                const list = data.tracks || data.results;
                if (Array.isArray(list) && list.length > 0) {
                    return list.map((item, idx) => formatTrack(item, CURATED_LIBRARY[idx % CURATED_LIBRARY.length].c)).filter(Boolean);
                }
            }
        } catch (e) {
            console.warn('[AxioTune Stacks] Recommendation fetch error:', e);
        }
        return [];
    }

    // ── Main Stacks Engine Orchestrator ──
    async function runStacksAlgorithm() {
        if (window.innerWidth > 768) return;

        const container = document.getElementById('ax-home-stacks');
        if (!container) return;

        const history = getHistory();
        const liked = getLiked();

        // 1. Identify Primary Seed ("Because you listened to [Seed 1]")
        const seed1 = history.length > 0 ? formatTrack(history[0], '#E8745B') : CURATED_LIBRARY[0];

        // 2. Identify Secondary Seed ("Because you listened to [Seed 2]")
        let seed2 = null;
        for (let i = 1; i < history.length; i++) {
            if (history[i].artist !== seed1.a && history[i].title !== seed1.t) {
                seed2 = formatTrack(history[i], '#9A8CE0');
                break;
            }
        }
        if (!seed2) seed2 = history.length > 1 ? formatTrack(history[1], '#9A8CE0') : CURATED_LIBRARY[1];

        // 3. Current Mood by Time of Day
        const hour = new Date().getHours();
        let currentMood = 'Chill';
        if (hour >= 5 && hour < 12) currentMood = 'Energy';
        else if (hour >= 12 && hour < 17) currentMood = 'Focus';
        else if (hour >= 17 && hour < 22) currentMood = 'Chill';
        else currentMood = 'Romantic';

        // Render Base HTML skeleton with dynamic headers in Natural Music Flow order
        container.innerHTML = `
            <!-- 1. RESUME PLAYBACK -->
            <div class="ax-sec" id="sec-arc">
                <div class="ax-head"><small>Pick up where you left</small><b>Recent Sessions</b></div>
                <div id="ax-arc"></div>
            </div>

            <!-- 2. QUICK PICKS (3D COVERFLOW HERO) -->
            <div class="ax-sec" id="sec-flow">
                <div class="ax-hb"><em>3D</em><b>Quick Picks Flow</b><small>Flip through discovery albums</small></div>
                <div id="ax-flow"></div>
            </div>

            <!-- 3. PRIMARY RECOMMENDATIONS (SEED 1) -->
            <div class="ax-sec" id="sec-fan">
                <div class="ax-head"><small>Because you listened to</small><b>${seed1.t}</b></div>
                <div id="ax-fan"></div>
            </div>

            <!-- 4. YOUR TASTE MIX -->
            <div class="ax-sec" id="sec-bento">
                <div class="ax-head"><small>Your taste mix</small><b>Personalized Mix</b></div>
                <div id="ax-bento"></div>
            </div>

            <!-- 5. TOP 8 THIS WEEK (CHARTS) -->
            <div class="ax-sec" id="sec-chart">
                <div class="ax-hd"><b>Top 8 This Week</b><a href="javascript:void(0)">Global Hits</a></div>
                <div id="ax-chart"></div>
            </div>

            <!-- 6. MOOD RADIO (VINYL PEEK) -->
            <div class="ax-sec" id="sec-vinyl">
                <div class="ax-hd"><b>Mood Radio • ${currentMood}</b><a href="javascript:void(0)" onclick="document.getElementById('mood-radio-section')?.scrollIntoView({behavior:'smooth'})">See all</a></div>
                <div id="ax-vinyl"></div>
            </div>

            <!-- 7. YOUR SHELF (SAVED VINYLS & LIKED) -->
            <div class="ax-sec" id="sec-spines">
                <div class="ax-head"><small>Your shelf</small><b>Saved Vinyls &amp; Liked</b></div>
                <div id="ax-spines"></div>
            </div>

            <!-- 8. SECONDARY SEED RECOMMENDATIONS (POLAROID) -->
            <div class="ax-sec" id="sec-pile">
                <div class="ax-hc">
                    <div class="ax-cover" style="background-image: url('${seed2.img}') !important; --c:${seed2.c};"></div>
                    <div><small>More for you &bull; Based on</small><b>${seed2.t}</b></div>
                </div>
                <div id="ax-pile"></div>
            </div>

            <!-- 9. DISCOVER (MARQUEE DRIFT) -->
            <div class="ax-sec" id="sec-mq">
                <div class="ax-head"><small>Discover</small><b>Trending &amp; New Drops</b></div>
                <div id="ax-mq"></div>
            </div>
        `;

        // ══════════════════════════════════════════════════════════════
        // SECTION 1: FAN DECK ("Because you listened to [Seed 1]")
        // ══════════════════════════════════════════════════════════════
        const fanEl = document.getElementById('ax-fan');
        if (fanEl) {
            let fanSongs = [seed1];
            // Render fast with initial related pool
            const initialPool = CURATED_LIBRARY.filter(s => s.t !== seed1.t);
            deck(fanEl, [seed1].concat(initialPool).slice(0, 8), function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 38) + 'px) translateY(' + (a * a * 3.5) + 'px) rotate(' + (f * 7) + 'deg) scale(' + (1 - Math.min(a, 4) * 0.07) + ')',
                    o: a > 4 ? 0 : 1 - a * 0.08,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 168, h: 250 });

            // Dynamically enrich via recommendations API
            fetchRecommendations(seed1.videoId, seed1.t + ' ' + seed1.a).then(recs => {
                if (recs && recs.length >= 4) {
                    deck(fanEl, [seed1].concat(recs).slice(0, 8), function (o, dx) {
                        const f = o - dx / 90;
                        const a = Math.abs(f);
                        return {
                            t: 'translateX(' + (f * 38) + 'px) translateY(' + (a * a * 3.5) + 'px) rotate(' + (f * 7) + 'deg) scale(' + (1 - Math.min(a, 4) * 0.07) + ')',
                            o: a > 4 ? 0 : 1 - a * 0.08,
                            z: 100 - Math.round(a * 10)
                        };
                    }, { w: 168, h: 250 });
                }
            });
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 2: BENTO MIX ("Your taste mix")
        // ══════════════════════════════════════════════════════════════
        const bentoEl = document.getElementById('ax-bento');
        if (bentoEl) {
            // Blend liked tracks + diverse history items
            const tastePool = [];
            liked.forEach(l => { tastePool.push(formatTrack(l, '#E8745B')); });
            history.forEach(h => {
                if (!tastePool.some(t => t.t === h.title)) {
                    tastePool.push(formatTrack(h, '#9A8CE0'));
                }
            });
            CURATED_LIBRARY.forEach(c => {
                if (tastePool.length < 6 && !tastePool.some(t => t.t === c.t)) {
                    tastePool.push(c);
                }
            });

            const bentoSongs = tastePool.slice(0, 6);
            const shape = ['big', '', '', '', '', 'wide'];
            bentoEl.className = 'ax-bento';
            bentoEl.innerHTML = '';
            bentoSongs.forEach(function (s, i) {
                const d = cov(s, shape[i]);
                d.style.setProperty('--i', i);
                d.innerHTML = '<i>' + s.t + '</i>';
                d.onclick = function () { onPlay(s); };
                bentoEl.appendChild(d);
            });
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 3: RECORD SPINES ("Your shelf")
        // ══════════════════════════════════════════════════════════════
        const spEl = document.getElementById('ax-spines');
        if (spEl) {
            // User's personal collection of saved vinyls
            const shelfPool = [];
            liked.forEach(l => { shelfPool.push(formatTrack(l, '#D9A86C')); });
            history.forEach(h => {
                if (shelfPool.length < 8 && !shelfPool.some(s => s.t === h.title)) {
                    shelfPool.push(formatTrack(h, '#4FB3A3'));
                }
            });
            CURATED_LIBRARY.forEach(c => {
                if (shelfPool.length < 8 && !shelfPool.some(s => s.t === c.t)) {
                    shelfPool.push(c);
                }
            });

            spEl.className = 'ax-spines';
            spEl.innerHTML = '';
            shelfPool.slice(0, 8).forEach(function (s) {
                const d = document.createElement('div');
                d.className = 'ax-spine';
                d.style.setProperty('--c', s.c || '#444');
                d.innerHTML = '<span>' + s.t + '</span><em>' + s.t + '</em>';
                d.prepend(cov(s));
                d.onclick = function (e) {
                    e.stopPropagation();
                    if (d.classList.contains('on')) return onPlay(s);
                    spEl.querySelectorAll('.on').forEach(function (x) { x.classList.remove('on'); });
                    d.classList.add('on');
                    setTimeout(function () {
                        d.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    }, 60);
                };
                spEl.appendChild(d);
            });
            if (spEl.children[2]) spEl.children[2].classList.add('on');
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 4: ARC CAROUSEL ("Pick up where you left")
        // ══════════════════════════════════════════════════════════════
        const arcEl = document.getElementById('ax-arc');
        if (arcEl) {
            // Exact chronological playback history
            let recentsPool = history.map((h, i) => formatTrack(h, CURATED_LIBRARY[i % CURATED_LIBRARY.length].c)).filter(Boolean);
            if (recentsPool.length < 4) {
                recentsPool = recentsPool.concat(CURATED_LIBRARY).slice(0, 8);
            }
            deck(arcEl, recentsPool.slice(0, 8), function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 96) + 'px) translateY(' + (a * a * 15) + 'px) rotate(' + (f * 9) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.14) + ')',
                    o: a > 2.6 ? 0 : 1 - a * 0.12,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 150, h: 260 });
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 5: 3D COVERFLOW ("Quick Picks Flow")
        // ══════════════════════════════════════════════════════════════
        const flowEl = document.getElementById('ax-flow');
        if (flowEl) {
            deck(flowEl, CURATED_LIBRARY.slice().reverse(), function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 70) + 'px) translateZ(' + (-a * 65) + 'px) rotateY(' + clamp(f * -42, -60, 60) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.06) + ')',
                    o: a > 3 ? 0 : 1 - a * 0.1,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 155, h: 235, cls: 'flow' });

            // Fetch live smart quick picks if available
            fetch('/api/quick_picks').then(res => res.json()).then(data => {
                if (data && data.status === 'success' && data.section && data.section.contents) {
                    const qpList = data.section.contents.map((item, idx) => formatTrack(item, CURATED_LIBRARY[idx % CURATED_LIBRARY.length].c)).filter(Boolean);
                    if (qpList.length >= 5) {
                        deck(flowEl, qpList.slice(0, 8), function (o, dx) {
                            const f = o - dx / 90;
                            const a = Math.abs(f);
                            return {
                                t: 'translateX(' + (f * 70) + 'px) translateZ(' + (-a * 65) + 'px) rotateY(' + clamp(f * -42, -60, 60) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.06) + ')',
                                o: a > 3 ? 0 : 1 - a * 0.1,
                                z: 100 - Math.round(a * 10)
                            };
                        }, { w: 155, h: 235, cls: 'flow' });
                    }
                }
            }).catch(() => {});
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 6: POLAROID PILE ("Because you listened to [Seed 2]")
        // ══════════════════════════════════════════════════════════════
        const pileEl = document.getElementById('ax-pile');
        if (pileEl) {
            pileEl.className = 'ax-pile';
            let pilePool = [seed2].concat(CURATED_LIBRARY.filter(c => c.t !== seed2.t)).slice(0, 6);
            const rot = function (i) { return [0, -6, 5, -3, 7, -8][i % 6]; };
            
            function drawPile() {
                pileEl.innerHTML = '';
                pilePool.forEach(function (s, i) {
                    const d = document.createElement('div');
                    d.className = 'ax-pol';
                    d.appendChild(cov(s));
                    const sp = document.createElement('span');
                    sp.textContent = s.t;
                    d.appendChild(sp);
                    d.style.zIndex = 50 - i;
                    d.style.transform = 'rotate(' + rot(i) + 'deg) translateY(' + (i * 4) + 'px)';
                    if (i === 0) {
                        d.onclick = function (e) {
                            e.stopPropagation();
                            d.classList.add('fly');
                            setTimeout(function () {
                                pilePool.push(pilePool.shift());
                                drawPile();
                            }, 380);
                        };
                    } else {
                        d.onclick = function () { onPlay(s); };
                    }
                    pileEl.appendChild(d);
                });
            }
            drawPile();

            // Fetch live recommendations for Seed 2
            fetchRecommendations(seed2.videoId, seed2.t + ' ' + seed2.a).then(recs => {
                if (recs && recs.length >= 4) {
                    pilePool = [seed2].concat(recs).slice(0, 6);
                    drawPile();
                }
            });
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 7: VINYL PEEK ("Vinyl peek • [Mood] Radio")
        // ══════════════════════════════════════════════════════════════
        const vinylEl = document.getElementById('ax-vinyl');
        if (vinylEl) {
            vinylEl.className = 'ax-vrow';
            vinylEl.innerHTML = '';
            const vinylPool = CURATED_LIBRARY.slice(0, 8);
            vinylPool.forEach(function (s) {
                const d = document.createElement('div');
                d.className = 'ax-vs';
                d.style.setProperty('--c', s.c || '#444');
                d.innerHTML = '<div class="disc"></div>';
                d.appendChild(cov(s));
                d.insertAdjacentHTML('beforeend', '<p>' + s.t + '</p>');
                d.onclick = function (e) {
                    e.stopPropagation();
                    if (d.classList.contains('on')) return onPlay(s);
                    vinylEl.querySelectorAll('.on').forEach(function (x) { x.classList.remove('on'); });
                    d.classList.add('on');
                };
                vinylEl.appendChild(d);
            });

            // Fetch live mood radio
            fetch('/api/radio?mood=' + encodeURIComponent(currentMood)).then(res => res.json()).then(data => {
                if (data && data.status === 'success' && data.tracks && data.tracks.length >= 4) {
                    const moodTracks = data.tracks.map((t, idx) => formatTrack(t, CURATED_LIBRARY[idx % CURATED_LIBRARY.length].c)).filter(Boolean);
                    vinylEl.innerHTML = '';
                    moodTracks.slice(0, 8).forEach(function (s) {
                        const d = document.createElement('div');
                        d.className = 'ax-vs';
                        d.style.setProperty('--c', s.c || '#444');
                        d.innerHTML = '<div class="disc"></div>';
                        d.appendChild(cov(s));
                        d.insertAdjacentHTML('beforeend', '<p>' + s.t + '</p>');
                        d.onclick = function (e) {
                            e.stopPropagation();
                            if (d.classList.contains('on')) return onPlay(s);
                            vinylEl.querySelectorAll('.on').forEach(function (x) { x.classList.remove('on'); });
                            d.classList.add('on');
                        };
                        vinylEl.appendChild(d);
                    });
                }
            }).catch(() => {});
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 8: MARQUEE ROWS ("Discover Trending")
        // ══════════════════════════════════════════════════════════════
        const mqEl = document.getElementById('ax-mq');
        if (mqEl) {
            function renderMarquee(list) {
                mqEl.innerHTML = '';
                [0, 1].forEach(function (n) {
                    const m = document.createElement('div');
                    m.className = 'ax-mq' + (n ? ' rev' : '');
                    const tr = document.createElement('div');
                    tr.className = 'ax-track';
                    const activeList = n ? list.slice().reverse() : list;
                    [].concat(activeList, activeList).forEach(function (s) {
                        const c = cov(s);
                        c.onclick = function () { onPlay(s); };
                        tr.appendChild(c);
                    });
                    m.appendChild(tr);
                    mqEl.appendChild(m);
                });
            }
            renderMarquee(CURATED_LIBRARY);

            // Fetch live trending discoveries
            fetch('/api/trending').then(res => res.json()).then(data => {
                if (data && data.status === 'success' && data.trending && data.trending.length >= 6) {
                    const trendList = data.trending.map((t, idx) => formatTrack(t, CURATED_LIBRARY[idx % CURATED_LIBRARY.length].c)).filter(Boolean);
                    renderMarquee(trendList.slice(0, 10));
                }
            }).catch(() => {});
        }

        // ══════════════════════════════════════════════════════════════
        // SECTION 9: TOP 8 THIS WEEK ("Top Chart Ranked #1 - #8")
        // ══════════════════════════════════════════════════════════════
        const chartEl = document.getElementById('ax-chart');
        if (chartEl) {
            function renderChart(list) {
                chartEl.className = 'ax-chart';
                chartEl.innerHTML = '';
                list.slice(0, 8).forEach(function (s, i) {
                    const d = document.createElement('div');
                    d.className = 'ax-ch';
                    d.innerHTML = '<em>' + (i + 1) + '</em>';
                    d.appendChild(cov(s));
                    d.onclick = function () { onPlay(s); };
                    chartEl.appendChild(d);
                });
            }
            renderChart(CURATED_LIBRARY);

            // Fetch live Top Global Hits
            fetch('/api/trending').then(res => res.json()).then(data => {
                if (data && data.status === 'success' && data.top_songs && data.top_songs.length >= 8) {
                    const topList = data.top_songs.map((t, idx) => formatTrack(t, CURATED_LIBRARY[idx % CURATED_LIBRARY.length].c)).filter(Boolean);
                    renderChart(topList);
                }
            }).catch(() => {});
        }
    }

    // Initialize when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runStacksAlgorithm);
    } else {
        runStacksAlgorithm();
    }

    // Reactive Refresh when user plays a track or changes music history
    window.addEventListener('storage', function (e) {
        if (e.key === 'music_history_full' || e.key === 'liked_songs') {
            runStacksAlgorithm();
        }
    });
})();
