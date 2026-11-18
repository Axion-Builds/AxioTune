/**
 * AxioTune Mobile Home Stacks Engine
 * Powers the 9 card stacking layouts on mobile:
 * 1. Fan deck
 * 2. Bento mix
 * 3. Record spines
 * 4. Arc carousel
 * 5. Coverflow (3D)
 * 6. Polaroid pile
 * 7. Vinyl peek
 * 8. Marquee rows
 * 9. Top chart
 */
(function () {
    'use strict';

    function initMobileStacks() {
        if (window.innerWidth > 768) return; // Mobile only, desktop 100% untouched

        const container = document.getElementById('ax-home-stacks');
        if (!container || container.dataset.stacksReady === 'true') return;
        container.dataset.stacksReady = 'true';

        // 9 Section Templates
        container.innerHTML = `
            <div class="ax-sec"><div class="ax-head"><small>Because you listened to</small><b>Fan deck</b></div><div id="ax-fan"></div></div>
            <div class="ax-sec"><div class="ax-head"><small>Your taste mix</small><b>Bento mix</b></div><div id="ax-bento"></div></div>
            <div class="ax-sec"><div class="ax-head"><small>Your shelf</small><b>Record spines</b></div><div id="ax-spines"></div></div>
            <div class="ax-sec"><div class="ax-head"><small>Pick up where you left</small><b>Arc carousel</b></div><div id="ax-arc"></div></div>
            <div class="ax-sec"><div class="ax-hb"><em>05</em><b>Coverflow</b><small>3D flip through albums</small></div><div id="ax-flow"></div></div>
            <div class="ax-sec"><div class="ax-hc"><div class="ax-cover" style="--c:#9A8CE0; background-image: url('cover_wide_awake.jpg') !important;"></div><div><small>Because you listened to</small><b>Wide Awake</b></div></div><div id="ax-pile"></div></div>
            <div class="ax-sec"><div class="ax-hd"><b>Vinyl peek</b><a href="javascript:void(0)" onclick="document.getElementById('mood-radio-section')?.scrollIntoView({behavior:'smooth'})">See all</a></div><div id="ax-vinyl"></div></div>
            <div class="ax-sec"><div class="ax-head"><small>Discover</small><b>Marquee rows</b></div><div id="ax-mq"></div></div>
            <div class="ax-sec"><div class="ax-hd"><b>Top 8 this week</b><a href="javascript:void(0)">See all</a></div><div id="ax-chart"></div></div>
        `;

        // Curated Songs with High-Res Posters & Cohesive Fallback Tints
        const SONGS = [
            { id: 'track_1', t: 'Dracula', a: 'Tame Impala ft. JENNIE', c: '#E8745B', img: 'cover_dracula.jpg' },
            { id: 'track_2', t: 'Wide Awake', a: 'Katy Perry', c: '#9A8CE0', img: 'cover_wide_awake.jpg' },
            { id: 'track_3', t: 'Harleys In Hawaii', a: 'Katy Perry', c: '#D9A86C', img: 'cover_harleys.jpg' },
            { id: 'track_4', t: '34+35', a: 'Ariana Grande', c: '#4FB3A3', img: 'cover_34_35.jpg' },
            { id: 'track_5', t: 'positions', a: 'Ariana Grande', c: '#E58AA8', img: 'cover_positions.jpg' },
            { id: 'track_6', t: 'Attention', a: 'Charlie Puth', c: '#F3E9DB', img: 'cover_attention.jpg' },
            { id: 'track_7', t: 'Starboy', a: 'The Weeknd ft. Daft Punk', c: '#7FA8E8', img: 'cover_starboy.jpg' },
            { id: 'track_8', t: 'Something About You', a: 'Eyedress, Dent May', c: '#C7B37A', img: 'cover_something_about_you.jpg' }
        ];

        // Play handler: Dispatches to AxioTune player
        const onPlay = function (s) {
            console.log('[AxioTune Stacks] Playing:', s.t, 'by', s.a);
            if (typeof window.playSong === 'function') {
                window.playSong(s.id, {
                    title: s.t,
                    artist: s.a,
                    cover: s.img || 'default_cover.jpg',
                    videoId: s.id
                });
            } else if (typeof window.searchAndPlay === 'function') {
                window.searchAndPlay(s.t + ' ' + s.a);
            }
            window.dispatchEvent(new CustomEvent('ax:play', { detail: s }));
        };

        const cov = function (s, cls) {
            const d = document.createElement('div');
            d.className = 'ax-cover ' + (cls || '');
            d.style.setProperty('--c', s.c || '#444');
            if (s.img) {
                d.style.setProperty('background-image', 'url("' + s.img + '")', 'important');
            }
            return d;
        };

        const clamp = function (v, a, b) {
            return Math.max(a, Math.min(b, v));
        };

        // ── High-Precision Gesture Deck Engine (Fan, Arc, Coverflow) ──
        // Seamlessly differentiates vertical scrolling from horizontal swipe
        function deck(root, songs, layout, options) {
            if (!root) return;
            options = options || {};
            const w = options.w || 168;
            const h = options.h || 250;
            const cls = options.cls || '';

            root.className = 'ax-deck ' + cls;
            root.style.setProperty('--w', w + 'px');
            root.style.setProperty('--h', h + 'px');

            const meta = document.createElement('div');
            meta.className = 'ax-meta';
            meta.innerHTML = '<b></b><span></span>';

            let cur = 0;
            const cards = songs.map(function (s) {
                const c = document.createElement('div');
                c.className = 'ax-card';
                c.appendChild(cov(s));
                root.appendChild(c);
                return c;
            });

            const wrap = root.parentNode;
            wrap.appendChild(meta);

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
                    // Check gesture direction threshold
                    if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) {
                        // User is scrolling the page vertically! Cancel deck drag immediately
                        isDragging = false;
                        gestureLocked = true;
                        cards.forEach(function (c) { c.classList.remove('drag'); });
                        return;
                    } else if (Math.abs(dx) > 7 && Math.abs(dx) >= Math.abs(dy)) {
                        // User is swiping the deck horizontally! Lock horizontal gesture
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
                    // It was a tap!
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

        // 1. Fan Deck (Slightly larger: 168x250)
        const fanEl = document.getElementById('ax-fan');
        if (fanEl) {
            deck(fanEl, SONGS, function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 38) + 'px) translateY(' + (a * a * 3.5) + 'px) rotate(' + (f * 7) + 'deg) scale(' + (1 - Math.min(a, 4) * 0.07) + ')',
                    o: a > 4 ? 0 : 1 - a * 0.08,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 168, h: 250 });
        }

        // 2. Bento Mix (Posters visible + clean labels)
        const bentoEl = document.getElementById('ax-bento');
        if (bentoEl) {
            const shape = ['big', '', '', '', '', 'wide'];
            bentoEl.className = 'ax-bento';
            SONGS.slice(0, 6).forEach(function (s, i) {
                const d = cov(s, shape[i]);
                d.style.setProperty('--i', i);
                d.innerHTML = '<i>' + s.t + '</i>';
                d.onclick = function () { onPlay(s); };
                bentoEl.appendChild(d);
            });
        }

        // 3. Record Spines (Expanded shelf: 38px unexpanded, 185px expanded)
        const spEl = document.getElementById('ax-spines');
        if (spEl) {
            spEl.className = 'ax-spines';
            SONGS.forEach(function (s) {
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

        // 4. Arc Carousel (Slightly larger: 150x260)
        const arcEl = document.getElementById('ax-arc');
        if (arcEl) {
            deck(arcEl, SONGS, function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 96) + 'px) translateY(' + (a * a * 15) + 'px) rotate(' + (f * 9) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.14) + ')',
                    o: a > 2.6 ? 0 : 1 - a * 0.12,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 150, h: 260 });
        }

        // 5. Coverflow (3D) (Slightly larger: 155x235)
        const flowEl = document.getElementById('ax-flow');
        if (flowEl) {
            deck(flowEl, SONGS, function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 70) + 'px) translateZ(' + (-a * 65) + 'px) rotateY(' + clamp(f * -42, -60, 60) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.06) + ')',
                    o: a > 3 ? 0 : 1 - a * 0.1,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 155, h: 235, cls: 'flow' });
        }

        // 6. Polaroid Pile (Slightly larger: 190x295 with snappy tap flick)
        const pileEl = document.getElementById('ax-pile');
        if (pileEl) {
            pileEl.className = 'ax-pile';
            let order = SONGS.slice(0, 6);
            const rot = function (i) { return [0, -6, 5, -3, 7, -8][i % 6]; };
            const drawPile = function () {
                pileEl.innerHTML = '';
                order.forEach(function (s, i) {
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
                                order.push(order.shift());
                                drawPile();
                            }, 380);
                        };
                    }
                    pileEl.appendChild(d);
                });
            };
            drawPile();
        }

        // 7. Vinyl Peek (Slightly larger: 145px card, 136px disc)
        const vinylEl = document.getElementById('ax-vinyl');
        if (vinylEl) {
            vinylEl.className = 'ax-vrow';
            SONGS.forEach(function (s) {
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

        // 8. Marquee Rows (Slightly larger: 104x104)
        const mqEl = document.getElementById('ax-mq');
        if (mqEl) {
            [0, 1].forEach(function (n) {
                const m = document.createElement('div');
                m.className = 'ax-mq' + (n ? ' rev' : '');
                const tr = document.createElement('div');
                tr.className = 'ax-track';
                const list = (n ? SONGS.slice().reverse() : SONGS);
                [].concat(list, list).forEach(function (s) {
                    const c = cov(s);
                    c.onclick = function () { onPlay(s); };
                    tr.appendChild(c);
                });
                m.appendChild(tr);
                mqEl.appendChild(m);
            });
        }

        // 9. Top Chart (Slightly larger: 165px wide, 116px cover)
        const chartEl = document.getElementById('ax-chart');
        if (chartEl) {
            chartEl.className = 'ax-chart';
            SONGS.forEach(function (s, i) {
                const d = document.createElement('div');
                d.className = 'ax-ch';
                d.innerHTML = '<em>' + (i + 1) + '</em>';
                d.appendChild(cov(s));
                d.onclick = function () { onPlay(s); };
                chartEl.appendChild(d);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileStacks);
    } else {
        initMobileStacks();
    }
})();
