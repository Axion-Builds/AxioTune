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
            <div class="ax-sec"><div class="ax-hc"><div class="ax-cover" style="--c:#9A8CE0"></div><div><small>Because you listened to</small><b>Wide Awake</b></div></div><div id="ax-pile"></div></div>
            <div class="ax-sec"><div class="ax-hd"><b>Vinyl peek</b><a href="javascript:void(0)" onclick="document.getElementById('mood-radio-section')?.scrollIntoView({behavior:'smooth'})">See all</a></div><div id="ax-vinyl"></div></div>
            <div class="ax-sec"><div class="ax-head"><small>Discover</small><b>Marquee rows</b></div><div id="ax-mq"></div></div>
            <div class="ax-sec"><div class="ax-hd"><b>Top 8 this week</b><a href="javascript:void(0)">See all</a></div><div id="ax-chart"></div></div>
        `;

        // Curated Songs Data
        const SONGS = [
            { id: 'track_1', t: 'Dracula', a: 'Tame Impala ft. JENNIE', c: '#E8745B', img: 'default_cover.jpg' },
            { id: 'track_2', t: 'Wide Awake', a: 'Katy Perry', c: '#9A8CE0', img: 'default_cover.jpg' },
            { id: 'track_3', t: 'Harleys In Hawaii', a: 'Katy Perry', c: '#D9A86C', img: 'default_cover.jpg' },
            { id: 'track_4', t: '34+35', a: 'Ariana Grande', c: '#4FB3A3', img: 'default_cover.jpg' },
            { id: 'track_5', t: 'positions', a: 'Ariana Grande', c: '#E58AA8', img: 'default_cover.jpg' },
            { id: 'track_6', t: 'Attention', a: 'Charlie Puth', c: '#F3E9DB', img: 'default_cover.jpg' },
            { id: 'track_7', t: 'Something About You', a: 'Eyedress, Dent May', c: '#7FA8E8', img: 'default_cover.jpg' },
            { id: 'track_8', t: 'Tip Toe', a: 'HYBS', c: '#C7B37A', img: 'default_cover.jpg' }
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
                d.style.backgroundImage = 'url("' + s.img + '")';
            }
            return d;
        };

        const clamp = function (v, a, b) {
            return Math.max(a, Math.min(b, v));
        };

        // ── Deck Engine (Fan, Arc, Coverflow) ──
        function deck(root, songs, layout, options) {
            if (!root) return;
            options = options || {};
            const w = options.w || 150;
            const h = options.h || 230;
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

            let sx = 0, drag = false, moved = false;
            root.addEventListener('pointerdown', function (e) {
                sx = e.clientX;
                drag = true;
                moved = false;
                cards.forEach(function (c) { c.classList.add('drag'); });
                root.setPointerCapture(e.pointerId);
            });

            root.addEventListener('pointermove', function (e) {
                if (!drag) return;
                const dx = e.clientX - sx;
                if (Math.abs(dx) > 6) moved = true;
                paint(dx);
            });

            const end = function (e) {
                if (!drag) return;
                drag = false;
                cards.forEach(function (c) { c.classList.remove('drag'); });
                const dx = e.clientX - sx;
                if (dx < -45) go(cur + 1);
                else if (dx > 45) go(cur - 1);
                else {
                    paint();
                    if (!moved) {
                        const el = document.elementFromPoint(e.clientX, e.clientY);
                        const i = cards.findIndex(function (c) { return c.contains(el); });
                        if (i === cur) onPlay(songs[cur]);
                        else if (i > -1) go(i);
                    }
                }
            };

            root.addEventListener('pointerup', end);
            root.addEventListener('pointercancel', end);
            go(0);
        }

        // 1. Fan Deck
        const fanEl = document.getElementById('ax-fan');
        if (fanEl) {
            deck(fanEl, SONGS, function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 34) + 'px) translateY(' + (a * a * 3) + 'px) rotate(' + (f * 7) + 'deg) scale(' + (1 - Math.min(a, 4) * 0.07) + ')',
                    o: a > 4 ? 0 : 1 - a * 0.08,
                    z: 100 - Math.round(a * 10)
                };
            });
        }

        // 2. Bento Mix
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

        // 3. Record Spines
        const spEl = document.getElementById('ax-spines');
        if (spEl) {
            spEl.className = 'ax-spines';
            SONGS.forEach(function (s) {
                const d = document.createElement('div');
                d.className = 'ax-spine';
                d.style.setProperty('--c', s.c || '#444');
                d.innerHTML = '<span>' + s.t + '</span><em>' + s.t + '</em>';
                d.prepend(cov(s));
                d.onclick = function () {
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

        // 4. Arc Carousel
        const arcEl = document.getElementById('ax-arc');
        if (arcEl) {
            deck(arcEl, SONGS, function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 88) + 'px) translateY(' + (a * a * 14) + 'px) rotate(' + (f * 9) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.14) + ')',
                    o: a > 2.6 ? 0 : 1 - a * 0.12,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 132, h: 240 });
        }

        // 5. Coverflow (3D)
        const flowEl = document.getElementById('ax-flow');
        if (flowEl) {
            deck(flowEl, SONGS, function (o, dx) {
                const f = o - dx / 90;
                const a = Math.abs(f);
                return {
                    t: 'translateX(' + (f * 64) + 'px) translateZ(' + (-a * 60) + 'px) rotateY(' + clamp(f * -42, -60, 60) + 'deg) scale(' + (1 - Math.min(a, 3) * 0.06) + ')',
                    o: a > 3 ? 0 : 1 - a * 0.1,
                    z: 100 - Math.round(a * 10)
                };
            }, { w: 140, h: 210, cls: 'flow' });
        }

        // 6. Polaroid Pile
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
                        d.onclick = function () {
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

        // 7. Vinyl Peek
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
                d.onclick = function () {
                    if (d.classList.contains('on')) return onPlay(s);
                    vinylEl.querySelectorAll('.on').forEach(function (x) { x.classList.remove('on'); });
                    d.classList.add('on');
                };
                vinylEl.appendChild(d);
            });
        }

        // 8. Marquee Rows
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

        // 9. Top Chart
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
