// ==UserScript==
// @name         TORN CITY Race Commentary
// @namespace    sanxion.tc.racecommentary
// @version      2.21.0
// @description  Live race commentary overlay for Torn City racing
// @author       Sanxion [2987640]
// @updateURL    https://github.com/Quantarallax/Torn-City-Racing-Commentary/raw/refs/heads/main/Torn%20City%20Racing%20Commentary.user.js
// @downloadURL  https://github.com/Quantarallax/Torn-City-Racing-Commentary/raw/refs/heads/main/Torn%20City%20Racing%20Commentary.user.js
// @match        https://www.torn.com/page.php?sid=racing*
// @match        https://www.torn.com/page.php*sid=racing*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────────
    const SCRIPT_NAME = 'TORN CITY Race Commentary';
    const SCRIPT_VERSION = '2.21.0';
    const AUTHOR = 'Sanxion [2987640]';
    const AUTHOR_ID = '2987640';
    const POLL_MS = 1000;

    const AMBIENT_GAP = 28000;
    const PLAYER_GAP = 14000;
    // COUNTDOWN and WAITING: one message every ~2 minutes
    const COUNTDOWN_GAP = 120000;
    const POSITION_GAP = 9000;
    const PROXIMITY_GAP = 13000;
    const FUNNY_GAP = 32000;
    const WAITING_GAP = 120000;
    const POSITION_COOLDOWN = 4000;
    const PRE_LAUNCH_MAX = 3;

    const STORAGE_KEY = 'tc_racecomm_v31';
    const MAX_FEED = 150;
    const REPEAT_WINDOW = 10;

    // ─── SVG Icons ───────────────────────────────────────────────────────────────
    const ICON = {
        join: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<circle cx="6.5" cy="6.5" r="6" stroke="#6ec4ff" stroke-width="1.2"/>'
            + '<polygon points="5,3.5 9.5,6.5 5,9.5" fill="#6ec4ff"/></svg></span>',
        pits: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<rect x="1" y="1" width="11" height="11" rx="2" stroke="#b0c0d0" stroke-width="1.2"/>'
            + '<rect x="4" y="4" width="2" height="5" fill="#b0c0d0"/>'
            + '<rect x="7" y="4" width="2" height="5" fill="#b0c0d0"/></svg></span>',
        flag: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<line x1="2" y1="1" x2="2" y2="12" stroke="#d090ff" stroke-width="1.5"/>'
            + '<rect x="2" y="1" width="3" height="3" fill="#d090ff"/>'
            + '<rect x="5" y="4" width="3" height="3" fill="#d090ff"/>'
            + '<rect x="8" y="1" width="3" height="3" fill="#d090ff"/>'
            + '<rect x="2" y="7" width="3" height="3" fill="#d090ff"/>'
            + '<rect x="8" y="7" width="3" height="3" fill="#d090ff"/></svg></span>',
        up: '<span class="tc-icon"><svg width="11" height="11" viewBox="0 0 11 11" fill="none">'
            + '<polygon points="5.5,1 10,9 1,9" fill="#4ee87a"/></svg></span>',
        down: '<span class="tc-icon"><svg width="11" height="11" viewBox="0 0 11 11" fill="none">'
            + '<polygon points="5.5,10 10,2 1,2" fill="#ff6666"/></svg></span>',
        proximity: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<circle cx="4" cy="6.5" r="2.5" stroke="#f5c030" stroke-width="1.2"/>'
            + '<circle cx="9" cy="6.5" r="2.5" stroke="#f5c030" stroke-width="1.2"/></svg></span>',
        prelaunch: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<rect x="4" y="1" width="5" height="11" rx="1.5" stroke="#ffaa50" stroke-width="1.2"/>'
            + '<circle cx="6.5" cy="3.5" r="1" fill="#ff6666"/>'
            + '<circle cx="6.5" cy="6.5" r="1" fill="#f5c030"/>'
            + '<circle cx="6.5" cy="9.5" r="1" fill="#4ee87a"/></svg></span>',
        wait: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<circle cx="6.5" cy="6.5" r="6" stroke="#ffaa50" stroke-width="1.2"/>'
            + '<line x1="6.5" y1="3" x2="6.5" y2="7" stroke="#ffaa50" stroke-width="1.5"/>'
            + '<circle cx="6.5" cy="9.5" r="1" fill="#ffaa50"/></svg></span>'
    };

    const TROPHY = {
        1: '<span class="tc-trophy tp-gold">&#127942;</span>',
        2: '<span class="tc-trophy tp-silver">&#129352;</span>',
        3: '<span class="tc-trophy tp-bronze">&#129353;</span>'
    };

    const S = {
        MENU: 'MENU', COUNTDOWN: 'COUNTDOWN', PRE_LAUNCH: 'PRE_LAUNCH',
        WAITING: 'WAITING', RACING: 'RACING', ENDED: 'ENDED', CRASHED: 'CRASHED'
    };

    // ─── Commentary banks ─────────────────────────────────────────────────────────
    const LINES = {
        COUNTDOWN: {
            ambient: [
                'Just a waiting game now.',
                'The paddock is quiet. Everyone waiting for the clock.',
                'All cars in position. Nothing to do but wait.',
                'Tick tock. The countdown is the hardest part.',
                'Crews standing by. Tension already building.',
                'The calm before the storm. {track} is ready and waiting.',
                'Silence across the grid. Every driver deep in focus.',
                '{player} starts fighting {p2}.',
                '{player} honks their horn in frustration.',
                '{player} revs their engine, upping the temperature.',
                'Fumes gather around the cluster of vehicles.'
            ],
            player: [
                '{player} has settled into {pos} and holds their nerve.',
                '{player} locked in and ready. Grid position secured.',
                'All eyes on {player} as the countdown ticks away.',
                '{player} in the {car}, sitting {pos}. Cool and composed.'
            ]
        },
        PRE_LAUNCH: {
            ambient: [
                'Not long now.',
                'Tensions are rising.',
                'Rioting can be seen across the other side of the track.',
                'Engines build to a crescendo. Nearly time.',
                'Every driver coiled and ready. The start is almost upon us.',
                'The grid trembles with anticipation. Seconds away.',
                'All systems ready. The crowd has gone eerily quiet.',
                'The lights are about to come on. This is the moment.'
            ],
            player: [
                '{player} poised in {pos}. The launch will be critical.',
                'Watch {player} — reaction time off the line could be decisive.',
                '{player} breathes steady in the {car}. Focused. Ready.',
                '{player} sits {pos}. Every tenth of a second counts from here.'
            ]
        },
        WAITING: {
            ambient: [
                'Which idiot put a number of racers limit on this?',
                '{player} fiddles with the gear stick, willing someone else to join.',
                'Engines rev in annoyance.',
                'The organisers stare at the empty grid. Come on, people.',
                'Awkward silence. More drivers needed before we can race.',
                'Someone in the stands shouts "Let\'s get going!" Not yet, friend.'
            ]
        },
        RACING: {
            ambient: [
                'The crowd goes wild.',
                'Someone from the crowd throws a grenade at the track.',
                'A fight breaks out near the starting line.',
                'Someone carelessly walks into the path of traffic! Oh dear.',
                'Someone released a spike-strip onto the track.',
                "There's a massive oil spillage and debris at the first turn.",
                'Explosions can be heard across the track area.',
                'Someone opens fire on the crowd near the exit.',
                '{track} proving as unforgiving as ever this afternoon.',
                'Strategy plays a big role in how this one unfolds.',
                'Every lap matters at this stage. No room for error.'
            ],
            player: [
                '{player} sits in {pos}, keeping it clean and consistent.',
                '{player} threads every corner in the {car}. A measured drive.',
                '{player} holds {pos} with real authority in the {car}.',
                '{player} navigates the pack well. Eyes firmly on the prize.',
                '{player} stays smooth and disciplined. Running {pos}.'
            ],
            funny: [
                '{name} appears to be shooting at other cars.',
                '{name} is driving backwards.',
                'Looks like {name} is drinking a bottle of beer, feet on the steering wheel.'
            ],
            moverUp: [
                '{mover} moves from {moverFrom} to {moverTo}! Charging through the field.',
                'Excellent move from {mover} — {moverFrom} to {moverTo}!',
                '{mover} surges forward, {moverFrom} to {moverTo}.',
                'Position gained! {mover} moves from {moverFrom} to {moverTo}.',
                '{mover} makes a brilliant move, from {moverFrom} to {moverTo}.',
                'Up goes {mover}! From {moverFrom} to {moverTo} in a flash.'
            ],
            moverDownEngine: [
                '{faller} drops from {fallerFrom} to {fallerTo} — looks like engine trouble.',
                'Engine issues for {faller}! Sliding from {fallerFrom} to {fallerTo}.',
                '{faller} loses ground fast, {fallerFrom} to {fallerTo}. That engine sounds rough.',
                'Mechanical grief for {faller} — dropping from {fallerFrom} to {fallerTo}.'
            ],
            moverDownTyre: [
                '{faller} moves down from {fallerFrom} to {fallerTo} — tyre trouble suspected.',
                'Tyre problems for {faller}! From {fallerFrom} to {fallerTo} and falling.',
                '{faller} struggles with rubber, sliding from {fallerFrom} to {fallerTo}.',
                'A blowout for {faller}? Dropping from {fallerFrom} to {fallerTo}.'
            ],
            moverDownMiscalc: [
                '{faller} drops from {fallerFrom} to {fallerTo} — a costly miscalculation.',
                'Poor decision from {faller} — {fallerFrom} to {fallerTo} and regretting it.',
                '{faller} misjudges the corner, dropping from {fallerFrom} to {fallerTo}.',
                'A miscalculation from {faller} — sliding back from {fallerFrom} to {fallerTo}.'
            ],
            moverDown: [
                '{faller} moves down from {fallerFrom} to {fallerTo}. Losing ground.',
                '{faller} drops from {fallerFrom} to {fallerTo}. The pack closes in.',
                '{faller} concedes ground, sliding from {fallerFrom} to {fallerTo}.',
                '{faller} under pressure, dropping from {fallerFrom} to {fallerTo}.'
            ],
            proximity: [
                '{p1name} coming very close to {p2name} — side by side through the sector!',
                'Intense battle between {p1name} and {p2name}. Barely a car width between them.',
                '{p1name} right on the bumper of {p2name}. This is going to get interesting.',
                'Wheel to wheel action — {p1name} and {p2name} are inseparable right now.',
                '{p1name} and {p2name} locked in a fierce duel. Neither gives an inch.',
                'The crowd on their feet as {p1name} and {p2name} go door to door.'
            ],
            // These lines reference {p3} — ONLY used when racerCount >= 3
            position3: [
                'Current order: {leader} leads, {p2} in 2nd, {p3} in 3rd.',
                '{leader} out front, {p2} on their tail, {p3} watching closely.',
                'Top three right now — {leader}, {p2}, {p3}. All very close.',
                '{leader} leads from {p2} and {p3}. Every lap a new story.',
                'Midfield carnage behind {leader}. {p2} and {p3} fighting hard.'
            ],
            // These lines only mention 2 players — safe for any racer count
            position2: [
                '{leader} out front with {p2} right behind. This is tense.',
                '{leader} holds the lead but {p2} applies relentless pressure.',
                '{p2} presses hard on {leader}. Every corner a potential overtake.',
                '{leader} still leads, {p2} refusing to drop away.',
                '{last} at the back — but races can change in an instant on {track}.'
            ]
        }
    };

    // ─── State ────────────────────────────────────────────────────────────────────
    let state = {
        status: S.MENU,
        playerName: '—',
        track: '—',
        car: '—',
        position: '—',
        // *** TWO-RACER GUARD FIX ***
        // racerCount is ONLY ever set from Position: X/Y scrape (posData.total).
        // It is NEVER updated from scrapeRacers().length, which uses broad DOM
        // selectors that can match extra elements and overcount.
        // Value of 0 = unknown (treat as 2-racer-safe until confirmed otherwise).
        racerCount: 0,
        racers: [],
        prevRacers: [],
        finishers: [],
        outroShown: false,
        lastLap: '—',
        currentLap: '—',
        completion: '—',
        windowFixed: false,
        halfwayFired: false,
        preLaunchMsgCount: 0
    };

    // commentaryPaused — session only, never persisted
    let commentaryPaused = false;

    // Timers — session only, never persisted
    let tAmbient = 0;
    let tPlayer = 0;
    let tPosition = 0;
    let tProximity = 0;
    let tFunny = 0;
    let tWaiting = 0;
    let tPosCooldown = 0;

    let recentByType = {
        ambient: [], player: [], position: [],
        moverUp: [], moverDown: [],
        moverDownEngine: [], moverDownTyre: [], moverDownMiscalc: [],
        proximity: [], funny: [], crash: [], waiting: []
    };

    let feedLines = [];
    let knownFinishers = new Set();
    let knownRacerNames = new Set();
    let currentStatus = S.MENU;
    let clearedForStatus = null;
    let isMinimised = false;

    // Consecutive polls that have seen "not enough drivers" — requires 2 to confirm WAITING.
    // Resets to 0 the moment any other status is detected, preventing stuck WAITING.
    let waitingSeenCount = 0;

    // After refreshing during a RACING session, suppress join-messages and show a
    // "currently racing" summary instead. Set in loadState() when status is RACING.
    let restoredIntoRacing = false;

    // ─── Persistence ─────────────────────────────────────────────────────────────
    function loadState () {
        try {
            const raw = GM_getValue(STORAGE_KEY, null);
            if (!raw) return;
            const p = JSON.parse(raw);
            state.status = p.status || S.MENU;
            state.playerName = p.playerName || '—';
            state.track = p.track || '—';
            state.car = p.car || '—';
            state.position = p.position || '—';
            state.racerCount = p.racerCount || 0;
            state.racers = p.racers || [];
            state.prevRacers = p.racers || [];
            state.finishers = p.finishers || [];
            state.outroShown = p.outroShown || false;
            state.lastLap = p.lastLap || '—';
            state.currentLap = p.currentLap || '—';
            state.completion = p.completion || '—';
            state.windowFixed = p.windowFixed || false;
            state.halfwayFired = p.halfwayFired || false;
            state.preLaunchMsgCount = p.preLaunchMsgCount || 0;
            feedLines = p.feedLines || [];
            recentByType = p.recentByType || {
                ambient: [], player: [], position: [],
                moverUp: [], moverDown: [],
                moverDownEngine: [], moverDownTyre: [], moverDownMiscalc: [],
                proximity: [], funny: [], crash: [], waiting: []
            };
            (state.finishers).forEach(function (f) { knownFinishers.add(f.name); });
            (state.racers).forEach(function (r) { knownRacerNames.add(r.name); });
            currentStatus = state.status;
            clearedForStatus = state.status;
            // Flag refresh during RACING so we show a summary instead of join messages
            if (state.status === S.RACING) restoredIntoRacing = true;
        } catch (_) {}
    }

    function saveState () {
        try {
            GM_setValue(STORAGE_KEY, JSON.stringify({
                status: state.status,
                playerName: state.playerName,
                track: state.track,
                car: state.car,
                position: state.position,
                racerCount: state.racerCount,
                racers: state.racers,
                finishers: state.finishers,
                outroShown: state.outroShown,
                lastLap: state.lastLap,
                currentLap: state.currentLap,
                completion: state.completion,
                windowFixed: state.windowFixed,
                halfwayFired: state.halfwayFired,
                preLaunchMsgCount: state.preLaunchMsgCount,
                feedLines: feedLines.slice(-MAX_FEED),
                recentByType
            }));
        } catch (_) {}
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────
    function pickLine (pool, typeKey) {
        const recent = recentByType[typeKey] || [];
        const available = pool.filter(function (l) { return recent.indexOf(l) === -1; });
        const source = available.length > 0 ? available : pool;
        const chosen = source[Math.floor(Math.random() * source.length)];
        recentByType[typeKey] = recent.concat([chosen]).slice(-REPEAT_WINDOW);
        return chosen;
    }

    function fill (tpl, extras) {
        const vars = Object.assign({
            player: state.playerName,
            track: state.track !== '—' ? state.track : 'the circuit',
            car: state.car !== '—' ? state.car : 'their car',
            pos: ordinal(parseInt(state.position, 10) || 0),
            leader: state.racers[0] ? state.racers[0].name : '—',
            p2: state.racers[1] ? state.racers[1].name : '—',
            p3: state.racers[2] ? state.racers[2].name : '—',
            last: state.racers.length > 0 ? state.racers[state.racers.length - 1].name : '—',
            total: String(state.racerCount || state.racers.length || '?')
        }, extras || {});
        return tpl.replace(/\{(\w+)\}/g, function (_, k) {
            return vars[k] !== undefined ? vars[k] : k;
        });
    }

    function ordinal (n) {
        if (!n || isNaN(n) || n < 1) return '—';
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function escH (str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatCompletion (val) {
        if (!val || val === '—') return val;
        return val.replace(/\.\d+%/, '%');
    }

    // *** TWO-RACER GUARD — THE FIX ***
    // racerCount comes ONLY from Position: X/Y (the authoritative Torn source).
    // We use ONLY racerCount here — not racers.length, which could be wrong.
    // Default (0 = unknown) → use safe 2-player lines only.
    function isThreePlusRace () {
        return state.racerCount >= 3;
    }

    function resetTimers () {
        const now = Date.now();
        tAmbient = now + 9000;
        tPlayer = now + 12000;
        tPosition = now + 7000;
        tProximity = now + 15000;
        tFunny = now + 36000;
        tWaiting = now + 9000;
        tPosCooldown = 0;
    }

    // ─── Feed ─────────────────────────────────────────────────────────────────────
    const TYPE_CLASS = {
        status: 'fl-status', ambient: 'fl-ambient', player: 'fl-player',
        position: 'fl-position', finish: 'fl-finish', outro: 'fl-outro',
        crash: 'fl-crash', waiting: 'fl-waiting'
    };

    function makeFeedNode (text, type, icon) {
        const div = document.createElement('div');
        div.className = 'tc-fl ' + (TYPE_CLASS[type] || '');
        div.innerHTML = (icon || '') + '<span class="tc-fl-text">' + escH(text) + '</span>';
        return div;
    }

    function getFeedEl () { return document.getElementById('tc-feed-inner'); }

    function scrollToBottom () {
        requestAnimationFrame(function () {
            const el = getFeedEl();
            if (el) el.scrollTop = el.scrollHeight;
        });
    }

    function appendToFeed (text, type, icon) {
        const el = getFeedEl();
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        el.appendChild(makeFeedNode(text, type, icon || ''));
        while (el.children.length > MAX_FEED) el.removeChild(el.firstChild);
        if (nearBottom) scrollToBottom();
    }

    function rebuildFeed () {
        const el = getFeedEl();
        if (!el) return;
        el.innerHTML = '';
        feedLines.forEach(function (l) { el.appendChild(makeFeedNode(l.text, l.type, l.icon || '')); });
        scrollToBottom();
    }

    function pushLine (text, type, icon) {
        const alwaysShow = (type === 'status' || type === 'finish' || type === 'outro' || type === 'crash');
        if (commentaryPaused && !alwaysShow) return;
        feedLines.push({ text: text, type: type, icon: icon || '' });
        if (feedLines.length > MAX_FEED) feedLines.shift();
        appendToFeed(text, type, icon || '');
    }

    function clearFeed () {
        feedLines = [];
        recentByType = {
            ambient: [], player: [], position: [],
            moverUp: [], moverDown: [],
            moverDownEngine: [], moverDownTyre: [], moverDownMiscalc: [],
            proximity: [], funny: [], crash: [], waiting: []
        };
        const el = getFeedEl();
        if (el) el.innerHTML = '';
    }

    // ─── New racer detection ──────────────────────────────────────────────────────
    function checkNewRacers () {
        state.racers.forEach(function (r, idx) {
            if (!knownRacerNames.has(r.name)) {
                knownRacerNames.add(r.name);
                // Only announce if we have a real name (not a dash or empty string)
                const validRacerName = r.name && r.name !== '—' && r.name.length > 1;
                if (knownRacerNames.size > 1 && validRacerName) {
                    const posStr = ordinal(r.posNum || idx + 1);
                    if (currentStatus === S.COUNTDOWN) {
                        pushLine(r.name + ' joins the paddock.', 'status', ICON.join);
                    } else if (currentStatus === S.PRE_LAUNCH) {
                        pushLine(r.name + ' just joined in position ' + posStr + '.', 'status', ICON.join);
                    }
                }
            }
        });
    }

    // ─── Halfway message ──────────────────────────────────────────────────────────
    function checkHalfway () {
        if (state.halfwayFired) return;
        const parts = (state.currentLap || '').split('/');
        if (parts.length !== 2) return;
        const cur = parseInt(parts[0], 10);
        const tot = parseInt(parts[1], 10);
        if (isNaN(cur) || isNaN(tot) || tot < 10) return;
        if (cur >= Math.floor(tot / 2)) {
            state.halfwayFired = true;
            pushLine("And we're halfway through this race, " + (tot - cur) + " laps left to go.", 'ambient');
        }
    }

    // ─── Commentary ───────────────────────────────────────────────────────────────
    function fireCommentary (st) {
        const now = Date.now();

        if (st === S.COUNTDOWN) {
            if (now >= tAmbient) {
                pushLine(fill(pickLine(LINES.COUNTDOWN.ambient, 'ambient')), 'ambient');
                tAmbient = now + COUNTDOWN_GAP + Math.random() * 30000;
            }
            if (now >= tPlayer) {
                pushLine(fill(pickLine(LINES.COUNTDOWN.player, 'player')), 'player');
                tPlayer = now + COUNTDOWN_GAP + Math.random() * 30000;
            }
        }

        if (st === S.PRE_LAUNCH && state.preLaunchMsgCount < PRE_LAUNCH_MAX) {
            if (now >= tAmbient) {
                pushLine(fill(pickLine(LINES.PRE_LAUNCH.ambient, 'ambient')), 'ambient');
                tAmbient = now + AMBIENT_GAP + Math.random() * 15000;
                state.preLaunchMsgCount++;
            } else if (now >= tPlayer && state.preLaunchMsgCount < PRE_LAUNCH_MAX) {
                pushLine(fill(pickLine(LINES.PRE_LAUNCH.player, 'player')), 'player');
                tPlayer = now + PLAYER_GAP + Math.random() * 8000;
                state.preLaunchMsgCount++;
            }
        }

        if (st === S.WAITING) {
            if (now >= tWaiting) {
                pushLine(fill(pickLine(LINES.WAITING.ambient, 'waiting')), 'waiting', ICON.wait);
                tWaiting = now + WAITING_GAP + Math.random() * 30000;
            }
        }

        if (st === S.RACING) {
            if (now >= tAmbient) {
                pushLine(fill(pickLine(LINES.RACING.ambient, 'ambient')), 'ambient');
                tAmbient = now + AMBIENT_GAP + Math.random() * 15000;
            }
            if (now >= tPlayer) {
                pushLine(fill(pickLine(LINES.RACING.player, 'player')), 'player');
                tPlayer = now + PLAYER_GAP + Math.random() * 8000;
            }
            // Position calls — gated by cooldown; pool selection uses authoritative racerCount
            if (now >= tPosition && now >= tPosCooldown && state.racers.length >= 2) {
                if (isThreePlusRace()) {
                    // 3+ racers confirmed from Position: X/Y — safe to use position3 lines
                    const pool = LINES.RACING.position3.concat(LINES.RACING.position2);
                    pushLine(fill(pickLine(pool, 'position')), 'position');
                } else {
                    // 2 racers or unknown — only use 2-player-safe lines
                    pushLine(fill(pickLine(LINES.RACING.position2, 'position')), 'position');
                }
                tPosition = now + POSITION_GAP + Math.random() * 5000;
            }
            detectMovement();
            if (now >= tProximity && state.racers.length >= 2) {
                const idx = Math.floor(Math.random() * (state.racers.length - 1));
                const r1 = state.racers[idx];
                const r2 = state.racers[idx + 1];
                if (r1 && r2) {
                    pushLine(
                        fill(pickLine(LINES.RACING.proximity, 'proximity'), { p1name: r1.name, p2name: r2.name }),
                        'position', ICON.proximity
                    );
                    tProximity = now + PROXIMITY_GAP + Math.random() * 8000;
                }
            }
            if (now >= tFunny && state.racers.length > 0) {
                const r = state.racers[Math.floor(Math.random() * state.racers.length)];
                pushLine(fill(pickLine(LINES.RACING.funny, 'funny'), { name: r.name }), 'ambient');
                tFunny = now + FUNNY_GAP + Math.random() * 20000;
            }
            checkHalfway();
        }
    }

    function detectMovement () {
        if (!state.prevRacers.length || !state.racers.length) return;
        const prevMap = {};
        state.prevRacers.forEach(function (r) { prevMap[r.name] = r.posNum; });
        const gains = [];
        const losses = [];
        state.racers.forEach(function (r) {
            const prev = prevMap[r.name];
            if (!prev || prev === r.posNum) return;
            const isLeader = (r.posNum === 1 || prev === 1);
            if (r.posNum < prev) { gains.push({ r: r, prev: prev, isLeader: isLeader }); }
            else { losses.push({ r: r, prev: prev, isLeader: isLeader }); }
        });
        gains.sort(function (a, b) { return (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0); });
        losses.sort(function (a, b) { return (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0); });
        gains.forEach(function (item) {
            const isPlayer = item.r.name === state.playerName;
            const text = fill(pickLine(LINES.RACING.moverUp, 'moverUp'), {
                mover: item.r.name, moverFrom: ordinal(item.prev), moverTo: ordinal(item.r.posNum)
            });
            pushLine(text, isPlayer ? 'player' : 'position', ICON.up);
            if (item.isLeader) tPosCooldown = Date.now() + POSITION_COOLDOWN;
        });
        losses.forEach(function (item) {
            const isPlayer = item.r.name === state.playerName;
            const rnd = Math.random();
            let pool; let key;
            if (rnd < 0.25) { pool = LINES.RACING.moverDownEngine; key = 'moverDownEngine'; }
            else if (rnd < 0.5) { pool = LINES.RACING.moverDownTyre; key = 'moverDownTyre'; }
            else if (rnd < 0.75) { pool = LINES.RACING.moverDownMiscalc; key = 'moverDownMiscalc'; }
            else { pool = LINES.RACING.moverDown; key = 'moverDown'; }
            const text = fill(pickLine(pool, key), {
                faller: item.r.name, fallerFrom: ordinal(item.prev), fallerTo: ordinal(item.r.posNum)
            });
            pushLine(text, isPlayer ? 'player' : 'position', ICON.down);
            if (item.isLeader) tPosCooldown = Date.now() + POSITION_COOLDOWN;
        });
    }

    // ─── Crash sequence ───────────────────────────────────────────────────────────
    function fireCrashSequence () {
        const msgs = [
            fill('There has been a crash!'),
            fill('{player} has overturned — {car} is in flames.'),
            fill('Racers are veering around, barely missing the wreckage.'),
            fill('{player} looks to have been rescued, though not in good shape.')
        ];
        [0, 2500, 5000, 8500].forEach(function (d, i) {
            setTimeout(function () { pushLine(msgs[i], 'crash'); }, d);
        });
    }

    // ─── Status transition ────────────────────────────────────────────────────────
    const CLEAR_ON_ENTRY = [S.COUNTDOWN, S.PRE_LAUNCH, S.RACING];

    function onStatusChange (oldSt, newSt) {
        resetTimers();
        // Always reset the WAITING confirmation counter on any status transition
        waitingSeenCount = 0;

        // Capture existing racers BEFORE any clear, so we can report paddock size
        const racersBeforeClear = state.racers.slice();

        if (CLEAR_ON_ENTRY.indexOf(newSt) !== -1 && clearedForStatus !== newSt) {
            if (oldSt === S.MENU || oldSt === S.ENDED || newSt === S.COUNTDOWN) {
                clearFeed();
                state.finishers = [];
                state.outroShown = false;
                state.halfwayFired = false;
                state.preLaunchMsgCount = 0;
                knownFinishers.clear();
                knownRacerNames.clear();
                state.racers = [];
                state.prevRacers = [];
                state.racerCount = 0;

                // Repopulate knownRacerNames with the racers that were already on the
                // track when the player joined. This means only genuinely NEW arrivals
                // after this point will trigger individual "joins the paddock" entries.
                racersBeforeClear.forEach(function (r) { knownRacerNames.add(r.name); });
            }
            clearedForStatus = newSt;
        }
        if (newSt === S.PRE_LAUNCH) state.preLaunchMsgCount = 0;

        if (newSt === S.COUNTDOWN) {
            // Do NOT show paddock/join messages if we're restoring from a RACING save.
            // The page may briefly detect COUNTDOWN before settling on RACING; these
            // messages would be wrong (the race has already started).
            if (!restoredIntoRacing) {
                const others = racersBeforeClear.filter(function (r) { return r.name !== state.playerName; });
                if (others.length > 0) {
                    const n = others.length;
                    pushLine(
                        'There ' + (n === 1 ? 'is' : 'are') + ' ' + n + ' player' + (n === 1 ? '' : 's') + ' already in the paddock.',
                        'status'
                    );
                }
                // Only show the join message when we have a real name and position.
                // If either is still '—' the scrape hasn't resolved yet and the
                // message would show "— has joined" or "Position has joined" etc.
                const validName = state.playerName !== '—' && state.playerName !== '';
                const validPos = parseInt(state.position, 10) >= 1;
                if (validName && validPos) {
                    pushLine(fill('{player} has joined the track in {pos}.'), 'status', ICON.join);
                }
            }
        }
        if (newSt === S.PRE_LAUNCH && oldSt !== S.PRE_LAUNCH) {
            pushLine('Engines are revving — not long until launch.', 'status', ICON.prelaunch);
            if (oldSt === S.COUNTDOWN) {
                pushLine('We are now in Pre-Launch.', 'status', ICON.prelaunch);
            }
        }
        if (newSt === S.WAITING) {
            pushLine('Not enough drivers to start this race. Waiting\u2026', 'waiting', ICON.wait);
        }
        if (newSt === S.RACING) {
            // Only fire the green-light message if this is a genuine new race start,
            // not a restore bounce (COUNTDOWN→RACING on page load after refresh)
            if (!restoredIntoRacing) {
                const tn = state.track !== '—' ? state.track : 'this circuit';
                pushLine("It's a green light — we are go on " + tn + "!", 'status', ICON.flag);
            }
        }
        if (newSt === S.CRASHED) fireCrashSequence();
        if (newSt === S.MENU && oldSt !== S.MENU) {
            clearFeed();
            pushLine('Back in the pits. Select a race to get started.', 'status', ICON.pits);
        }
        if (newSt === S.ENDED) {
            state.completion = '100%';
            renderRaceStats();
        }
    }

    // ─── Finishers ────────────────────────────────────────────────────────────────
    function processFinishers (scraped) {
        let list = scraped;
        if (!list.length && state.status === S.ENDED && state.playerName !== '—') {
            list = [{ name: state.playerName, pos: parseInt(state.position, 10) || 1 }];
        }
        list.forEach(function (f) {
            if (!knownFinishers.has(f.name)) {
                knownFinishers.add(f.name);
                state.finishers.push(f);
                pushLine(
                    f.name + ' crosses the finish line in ' + ordinal(f.pos || state.finishers.length) + '!',
                    'finish', ICON.flag
                );
            }
        });
        if (!state.outroShown && state.finishers.length > 0) {
            const total = state.racerCount || state.racers.length || state.finishers.length;
            if (state.finishers.length >= total) {
                state.outroShown = true;
                setTimeout(function () {
                    pushLine('That was a fantastic race! Thank you for tuning in. Brought to you by Sanxion [2987640].', 'outro');
                    saveState();
                }, 3500);
            }
        }
    }

    // ─── Scrapers ─────────────────────────────────────────────────────────────────
    // getPageText — clones the body, removes our HUD and any other injected
    // overlay elements before reading innerText. This is the most reliable way
    // to isolate Torn's own page text from other running Tampermonkey scripts,
    // without complex TreeWalker filtering that can miss edge cases.
    function getPageText () {
        if (!document.body) return '';
        try {
            const clone = document.body.cloneNode(true);
            // Remove our own HUD
            const ownHud = clone.querySelector('#tc-rc-hud');
            if (ownHud) ownHud.parentNode.removeChild(ownHud);
            // Remove any position:fixed or position:absolute overlays injected
            // by other scripts (common pattern for Tampermonkey UI injections).
            // We identify them by checking for elements that sit outside the
            // normal Torn page DOM structure — fixed-position divs with custom ids.
            const overlays = clone.querySelectorAll(
                '[id^="tc-"],[id^="torn-"],[id^="tm-"],[id^="gm-"],' +
                '[class^="tc-"],[class^="torn-"],[class^="tm-"],[class^="gm-"]'
            );
            overlays.forEach(function (el) { el.parentNode.removeChild(el); });
            return clone.innerText || '';
        } catch (_) {
            return document.body.innerText || '';
        }
    }

    function scrapeName () {
        const m = getPageText().match(/Name:\s+([A-Za-z0-9_\-[\]]+)/);
        return m ? m[1].trim() : null;
    }

    function scrapeTrack () {
        const m = getPageText().match(/([A-Za-z][A-Za-z0-9 '\-]*?)\s+-\s+\d+\s+laps?\s+-/);
        return m ? m[1].trim() : null;
    }

    function scrapeCar () {
        const text = getPageText();
        // Method 1: broad regex — permissive, captures any car name format
        const m = text.match(/[Cc]urrent\s+[Cc]ar[:\s]+([^\n\r]{2,50})/);
        if (m) {
            const candidate = m[1].trim().split(/[|\t]/)[0].trim();
            if (candidate && candidate.length > 1 && candidate.length < 50) return candidate;
        }
        // Method 2: TreeWalker to find text nodes containing "current car"
        try {
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function (node) {
                        const t = node.nodeValue || '';
                        return /current\s+car/i.test(t) && t.length < 300
                            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                    }
                }
            );
            let node = walker.nextNode();
            while (node) {
                const raw = (node.nodeValue || '').replace(/current\s+car/i, '').replace(/^[:\s]+/, '').trim();
                if (raw && raw.length > 1 && raw.length < 60) return raw.split('\n')[0].trim();
                const sib = node.nextSibling;
                if (sib && sib.nodeType === 3) {
                    const s = (sib.nodeValue || '').trim();
                    if (s && s.length > 1 && s.length < 60 && !/current/i.test(s)) return s;
                }
                node = walker.nextNode();
            }
        } catch (_) {}
        // Method 3: element class patterns
        const carEls = document.querySelectorAll(
            '[class*="current-car"], [class*="currentCar"], [class*="car-name"], [class*="carName"], [class*="vehicle"]'
        );
        for (let i = 0; i < carEls.length; i++) {
            const t = carEls[i].textContent.trim();
            if (t && t.length > 1 && t.length < 60) return t;
        }
        return null;
    }

    // *** KEY CHANGE: scrapePosition is the ONLY source of racerCount ***
    function scrapePosition () {
        const m = getPageText().match(/Position:\s*(\d+)\/(\d+)/i);
        return m ? { pos: m[1], total: parseInt(m[2], 10) } : null;
    }

    function scrapeLastLap () {
        const m = getPageText().match(/Last\s+Lap:\s*([\d:]+)/i);
        return m ? m[1].trim() : null;
    }

    function scrapeCurrentLap () {
        const m = getPageText().match(/Lap:\s*(\d+\/\d+)/i);
        return m ? m[1].trim() : null;
    }

    function scrapeCompletion () {
        const m = getPageText().match(/Completion:\s*([\d.]+%)/i);
        return m ? m[1].trim() : null;
    }

    function scrapeRacers () {
        // This returns names and positions for leaderboard display and movement detection.
        // Its .length is NOT used for racerCount — use scrapePosition().total for that.
        const racers = [];
        const driverItems = document.querySelectorAll('ul.driver-item, ul[class*="driver-item"]');
        driverItems.forEach(function (ul, idx) {
            const nameEl = ul.querySelector('li.name, li[class*="name"]');
            const posEl = ul.querySelector('li.position, li[class*="position"], li[class*="pos"], li[class*="rank"]');
            const name = nameEl ? nameEl.textContent.trim() : '';
            const posNum = parseInt(posEl ? posEl.textContent.trim() : '', 10) || idx + 1;
            if (name && name.length > 1 && name.length < 40) {
                racers.push({ name: name, pos: String(posNum), posNum: posNum });
            }
        });
        if (!racers.length) {
            const rows = document.querySelectorAll(
                '[class*="racer"], [class*="racePlayer"], [class*="racerRow"], ' +
                '[class*="leaderboard"] tr, [class*="standings"] tr, [class*="raceTable"] tr, [class*="raceList"] li'
            );
            rows.forEach(function (row) {
                const nameEl = row.querySelector('[class*="name"], [class*="player"]');
                const posEl = row.querySelector('[class*="pos"], [class*="rank"], [class*="place"]');
                const name = nameEl ? nameEl.textContent.trim() : '';
                const pos = posEl ? posEl.textContent.trim() : '';
                if (name && name.length > 1 && name.length < 40) {
                    racers.push({ name: name, pos: pos || '?', posNum: parseInt(pos, 10) || 0 });
                }
            });
        }
        if (!racers.length) {
            const rx = /(\d+)\.\s+([A-Za-z0-9_\-]+)/g;
            let rm;
            while ((rm = rx.exec(getPageText())) !== null) {
                if (parseInt(rm[1], 10) <= 100) racers.push({ name: rm[2], pos: rm[1], posNum: parseInt(rm[1], 10) });
            }
        }
        racers.sort(function (a, b) { return a.posNum - b.posNum; });
        return racers;
    }

    function scrapeFinishers () {
        const list = [];
        const rows = document.querySelectorAll(
            '[class*="raceResult"] tr, [class*="result"] tr, [class*="finisherList"] li, [class*="raceEnd"] li'
        );
        rows.forEach(function (row, idx) {
            const nameEl = row.querySelector('[class*="name"], [class*="player"]');
            const posEl = row.querySelector('[class*="pos"], [class*="rank"]');
            if (nameEl && nameEl.textContent.trim()) {
                const pos = posEl ? parseInt(posEl.textContent.trim(), 10) : idx + 1;
                list.push({ name: nameEl.textContent.trim(), pos: pos || idx + 1 });
            }
        });
        return list;
    }

    // ─── Status detection ─────────────────────────────────────────────────────────
    function domContains (pattern) {
        const els = document.querySelectorAll('*');
        for (let i = 0; i < els.length; i++) {
            if (pattern.test(els[i].textContent || '')) return true;
        }
        return false;
    }

    function detectStatus () {
        const text = getPageText();
        if (text.toLowerCase().indexOf('crashed') !== -1 || document.querySelector('[class*="crashed"], [class*="wrecked"]')) return S.CRASHED;
        if (/race\s+finished/i.test(text) || /you\s+finished\s+in\s+\d/i.test(text) || document.querySelector('[class*="raceEnd"], [class*="raceFinished"]')) return S.ENDED;
        if (text.indexOf('Race started') !== -1 || document.querySelector('[class*="raceStarted"], [class*="raceInProgress"]')) return S.RACING;
        if (/not\s+enough\s+drivers/i.test(text)) {
            waitingSeenCount++;
            // Require 2 consecutive polls to confirm WAITING — prevents false positives
            // from cached page text during navigation
            if (waitingSeenCount >= 2) return S.WAITING;
            // Return current status while waiting for confirmation
            return currentStatus === S.WAITING ? S.WAITING : (currentStatus || S.MENU);
        }
        // Text no longer present — reset counter so WAITING can't persist
        waitingSeenCount = 0;
        const hasPRL = /race\s+will\s+start\s+in/i.test(text) || domContains(/race\s+will\s+start\s+in/i);
        if (hasPRL) {
            const comp = scrapeCompletion();
            if (!comp || comp === '0.00%' || comp === '0%') return S.PRE_LAUNCH;
        }
        const hasTrackLaps = /[A-Za-z][A-Za-z0-9 ]+\s+-\s+\d+\s+laps?\s+-/.test(text) || domContains(/\w[\w ]+\s+-\s+\d+\s+laps?\s+-/);
        if (hasTrackLaps) {
            const comp = scrapeCompletion();
            if (!comp || comp === '0.00%' || comp === '0%') return S.COUNTDOWN;
            if (text.indexOf('Completion:') === -1) return S.COUNTDOWN;
            if (/Lap:\s*\d+\/\d+/i.test(text)) return S.RACING;
            return S.COUNTDOWN;
        }
        return S.MENU;
    }

    // ─── Main poll ────────────────────────────────────────────────────────────────
    function poll () {
        const newName = scrapeName();
        const newTrack = scrapeTrack();
        const newCar = scrapeCar();
        const posData = scrapePosition();
        const newRacers = scrapeRacers();
        const newStatus = detectStatus();

        if (newName) state.playerName = newName;
        if (newTrack) state.track = newTrack;
        // Only update car when we're in an active race context.
        // While browsing car selection in MENU the scraper can pick up
        // car list entries and show them incorrectly in the display.
        if (newCar && newStatus !== S.MENU) state.car = newCar;

        if (posData) {
            state.position = posData.pos;
            // *** ONLY source of racerCount — Position: X/Y from the page ***
            // Always trust this value; it's the authoritative Torn count.
            if (posData.total > 0) state.racerCount = posData.total;
        }
        // *** DO NOT update racerCount from newRacers.length ***
        // scrapeRacers() uses broad DOM selectors and can overcount.

        if (newRacers.length) {
            state.prevRacers = state.racers.slice();
            state.racers = newRacers;
            if (restoredIntoRacing) {
                // Refreshed during a race — add all current racers to known set silently
                // then show a summary message once
                newRacers.forEach(function (r) { knownRacerNames.add(r.name); });
                if (newStatus === S.RACING) {
                    const n = newRacers.length || state.racerCount || '?';
                    pushLine(
                        n + ' racer' + (n === 1 ? '' : 's') + ' currently competing. Resuming commentary\u2026',
                        'status'
                    );
                    restoredIntoRacing = false;
                }
            } else {
                checkNewRacers();
            }
        }

        if (newStatus !== S.MENU) {
            const ll = scrapeLastLap();
            const cl = scrapeCurrentLap();
            const co = scrapeCompletion();
            if (ll) state.lastLap = ll;
            if (cl) state.currentLap = cl;
            if (co && state.completion !== '100%') state.completion = formatCompletion(co);
        } else {
            state.lastLap = '—';
            state.currentLap = '—';
            state.completion = '—';
        }

        if (newStatus !== currentStatus) {
            onStatusChange(currentStatus, newStatus);
            currentStatus = newStatus;
            state.status = newStatus;
        }

        if (state.status === S.ENDED) processFinishers(scrapeFinishers());

        fireCommentary(state.status);
        renderInfoBar();
        renderStatus();
        renderLeaderboard();
        renderRaceStats();
        saveState();
    }

    // ─── Render ───────────────────────────────────────────────────────────────────
    function renderInfoBar () {
        const sv = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
        sv('tc-ib-name', state.playerName);
        sv('tc-ib-track', state.track);
        sv('tc-ib-car', state.car);
        const posNum = parseInt(state.position, 10);
        sv('tc-ib-pos', posNum >= 1 ? ordinal(posNum) : '—');
    }

    function renderStatus () {
        const el = document.getElementById('tc-rc-status-val');
        if (!el) return;
        const map = {
            [S.MENU]: { label: 'MENU', cls: 'st-menu' },
            [S.COUNTDOWN]: { label: 'COUNTDOWN', cls: 'st-countdown' },
            [S.PRE_LAUNCH]: { label: 'PRE-LAUNCH', cls: 'st-prelaunch' },
            [S.WAITING]: { label: 'WAITING', cls: 'st-waiting' },
            [S.RACING]: { label: 'RACING', cls: 'st-racing' },
            [S.ENDED]: { label: 'ENDED', cls: 'st-ended' },
            [S.CRASHED]: { label: 'CRASHED', cls: 'st-crashed' }
        };
        const m = map[state.status] || { label: state.status, cls: 'st-menu' };
        el.textContent = m.label;
        el.className = m.cls;
    }

    function renderLeaderboard () {
        const el = document.getElementById('tc-rc-lb-list');
        if (!el) return;
        if (state.status === S.MENU) { el.innerHTML = '<div class="tc-lb-empty">Select a race\u2026</div>'; return; }
        const top3 = state.racers.slice(0, 3);
        if (!top3.length) { el.innerHTML = '<div class="tc-lb-empty">Awaiting data\u2026</div>'; return; }
        el.innerHTML = top3.map(function (r, i) {
            const pn = r.posNum || i + 1;
            const isMe = r.name === state.playerName;
            const posClass = pn === 1 ? 'lb-p1' : pn === 2 ? 'lb-p2' : 'lb-p3';
            const url = 'https://www.torn.com/profiles.php?XID=' + encodeURIComponent(r.name);
            return '<div class="tc-lb-row' + (isMe ? ' lb-me' : '') + '">'
                + '<span class="tc-lb-pos ' + posClass + '">' + ordinal(pn) + '</span>'
                + (TROPHY[pn] || '')
                + '<a class="tc-lb-name tc-link" href="' + url + '" target="_blank" rel="noopener">' + escH(r.name) + '</a>'
                + '</div>';
        }).join('');
    }

    function renderRaceStats () {
        const sv = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
        sv('tc-stat-last', state.lastLap);
        sv('tc-stat-lap', state.currentLap);
        sv('tc-stat-comp', state.completion);
    }

    function updatePauseBtn () {
        const btn = document.getElementById('tc-btn-pause');
        if (!btn) return;
        btn.textContent = commentaryPaused ? '\u25B6 Resume' : '\u23F8 Pause';
        btn.classList.toggle('tc-btn-active', commentaryPaused);
    }

    function updateFixBtn () {
        const btn = document.getElementById('tc-btn-fix');
        if (!btn) return;
        btn.textContent = state.windowFixed ? '\u229E Float' : '\u229F Fix';
        btn.classList.toggle('tc-btn-active', state.windowFixed);
        const hud = document.getElementById('tc-rc-hud');
        if (hud) {
            if (state.windowFixed) { hud.classList.add('tc-fixed'); } else { hud.classList.remove('tc-fixed'); }
        }
    }

    function setMinimised (min) {
        isMinimised = min;
        const hud = document.getElementById('tc-rc-hud');
        const body = document.getElementById('tc-rc-body');
        const footer = document.getElementById('tc-rc-footer');
        const btn = document.getElementById('tc-rc-min');
        if (!hud || !body || !footer || !btn) return;
        if (min) {
            body.style.display = 'none'; footer.style.display = 'none';
            hud.style.height = 'auto'; hud.style.resize = 'none';
            btn.innerHTML = '&#9660;';
        } else {
            body.style.display = ''; footer.style.display = '';
            hud.style.height = ''; hud.style.resize = 'both';
            btn.innerHTML = '&#9650;';
        }
    }

    function makeDraggable (hudEl, handleEl) {
        let ox = 0, oy = 0, sl = 0, st = 0, dragging = false;
        handleEl.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            if (state.windowFixed) return;
            dragging = true; ox = e.clientX; oy = e.clientY;
            const r = hudEl.getBoundingClientRect(); sl = r.left; st = r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            hudEl.style.left = (sl + e.clientX - ox) + 'px';
            hudEl.style.top = (st + e.clientY - oy) + 'px';
            hudEl.style.right = 'auto';
        });
        document.addEventListener('mouseup', function () { dragging = false; });
    }

    // ─── CSS ──────────────────────────────────────────────────────────────────────
    function injectCSS () {
        if (document.getElementById('tc-rc-css')) return;
        const css = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700&display=swap');
#tc-rc-hud{--c-gold:#f5c030;--c-blue:#6ec4ff;--c-green:#4ee87a;--c-purple:#d090ff;--c-orange:#ffaa50;--c-red:#ff6666;--c-white:#f0f4fa;--c-mid:#b0c0d0;--c-muted:#8a9db8;--c-dim:#6a7d94;--c-bg:#07090f;--c-bg2:#060810;--c-border:#202840;--c-border2:#181e30;}
#tc-rc-hud{position:fixed;top:4vh;right:18px;width:340px;height:75vh;min-width:260px;max-width:520px;background:var(--c-bg);border:1px solid var(--c-border);border-top:3px solid var(--c-gold);border-radius:5px;box-shadow:0 20px 70px rgba(0,0,0,.92);font-family:'Barlow Condensed',sans-serif;color:var(--c-mid);z-index:999999;display:flex;flex-direction:column;overflow:hidden;resize:both;user-select:none;}
#tc-rc-hud.tc-fixed{position:relative;top:auto;right:auto;left:auto;width:100%;max-width:100%;height:auto;min-height:60vh;border-radius:0;box-shadow:none;resize:vertical;z-index:10;}
#tc-rc-drag{display:flex;align-items:center;justify-content:space-between;padding:6px 10px 5px;background:linear-gradient(90deg,#0c0f1c 0%,#111628 100%);border-bottom:1px solid var(--c-border);cursor:grab;flex-shrink:0;}
#tc-rc-drag:active{cursor:grabbing;}
#tc-rc-hud.tc-fixed #tc-rc-drag{cursor:default;}
.tc-title-text{font-family:'Orbitron',monospace;font-size:9px;font-weight:700;color:var(--c-gold);letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tc-hdr-btns{display:flex;gap:4px;flex-shrink:0;margin-left:8px;}
.tc-hdr-btns button{background:rgba(255,255,255,.05);border:1px solid #2a3050;color:var(--c-muted);width:20px;height:20px;border-radius:3px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .15s,color .15s,border-color .15s;}
.tc-hdr-btns button:hover{background:rgba(245,192,48,.15);border-color:var(--c-gold);color:var(--c-gold);}
#tc-rc-body{display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;}
#tc-rc-main{display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;}
#tc-rc-infobar{display:flex;align-items:stretch;background:var(--c-bg2);border-bottom:1px solid var(--c-border2);flex-shrink:0;}
.tc-ib-cell{flex:1;display:flex;flex-direction:column;align-items:center;padding:5px 4px 4px;min-width:0;}
.tc-ib-sep{width:1px;background:var(--c-border2);margin:4px 0;flex-shrink:0;}
.tc-ib-lbl{font-family:'Orbitron',monospace;font-size:7px;font-weight:700;color:var(--c-dim);letter-spacing:.14em;margin-bottom:2px;white-space:nowrap;}
.tc-ib-val{font-family:'Share Tech Mono',monospace;font-size:12px;color:var(--c-white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
#tc-rc-status-row{display:flex;align-items:center;gap:10px;padding:7px 12px 6px;background:var(--c-bg2);border-bottom:1px solid var(--c-border2);flex-shrink:0;}
.tc-st-lbl{font-family:'Orbitron',monospace;font-size:8px;font-weight:700;color:var(--c-dim);letter-spacing:.14em;flex-shrink:0;}
#tc-rc-status-val{font-family:'Orbitron',monospace;font-size:20px;font-weight:900;letter-spacing:.05em;}
.st-menu{color:var(--c-gold);}.st-countdown{color:var(--c-blue);}.st-prelaunch{color:var(--c-orange);}.st-waiting{color:var(--c-orange);}.st-racing{color:var(--c-green);}.st-ended{color:var(--c-purple);}.st-crashed{color:var(--c-red);}
#tc-rc-cols{position:relative;flex:1;overflow:hidden;min-height:0;display:block;}
#tc-rc-lb-col{position:absolute;top:0;left:0;bottom:0;width:142px;border-right:1px solid var(--c-border2);background:var(--c-bg2);display:flex;flex-direction:column;overflow:hidden;z-index:2;}
#tc-rc-lb-list{flex:1;overflow-y:auto;overflow-x:hidden;padding:3px 0;min-height:0;scrollbar-width:thin;scrollbar-color:var(--c-border) transparent;}
#tc-rc-stats{flex-shrink:0;border-top:1px solid var(--c-border2);padding:5px 6px 7px;background:var(--c-bg2);}
.tc-stats-row1{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:3px;}
.tc-stats-row1 .tc-stat-group{display:flex;align-items:baseline;gap:3px;}
.tc-stats-row2{display:flex;align-items:center;justify-content:center;gap:4px;}
.tc-stat-lbl{font-family:'Orbitron',monospace;font-size:7px;font-weight:700;color:var(--c-dim);letter-spacing:.1em;white-space:nowrap;}
.tc-stat-val{font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--c-white);text-align:right;white-space:nowrap;}
#tc-stat-comp{font-family:'Share Tech Mono',monospace;font-size:12px;font-weight:700;color:var(--c-white);text-align:center;}
.tc-comp-lbl{font-family:'Orbitron',monospace;font-size:7px;font-weight:700;color:var(--c-dim);letter-spacing:.1em;white-space:nowrap;}
.tc-lb-empty{font-size:11px;color:var(--c-dim);padding:8px;font-style:italic;line-height:1.5;}
.tc-lb-row{display:flex;align-items:center;gap:4px;padding:5px 6px;border-bottom:1px solid #0d1020;font-size:12px;font-weight:600;}
.tc-lb-row.lb-me{background:rgba(245,192,48,.09);border-left:2px solid var(--c-gold);}
.tc-lb-pos{font-family:'Orbitron',monospace;font-size:9px;font-weight:700;color:var(--c-muted);min-width:20px;flex-shrink:0;}
.lb-p1{color:#ffd040;}.lb-p2{color:#d0dce8;}.lb-p3{color:#e8a050;}
.tc-trophy{font-size:14px;flex-shrink:0;line-height:1;}
.tp-gold{filter:drop-shadow(0 0 4px rgba(255,208,64,.8));}.tp-silver{filter:drop-shadow(0 0 4px rgba(208,220,232,.7));}.tp-bronze{filter:drop-shadow(0 0 4px rgba(232,160,80,.7));}
.tc-lb-name{color:var(--c-mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.tc-lb-row.lb-me .tc-lb-name{color:#ffe060;}
a.tc-link{color:inherit;text-decoration:none;transition:color .15s;}
a.tc-link:hover{color:var(--c-blue);text-decoration:underline;}
#tc-rc-feed-col{position:absolute;top:0;left:143px;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;}
.tc-col-hdr{font-family:'Orbitron',monospace;font-size:7px;font-weight:700;color:var(--c-dim);letter-spacing:.14em;padding:5px 8px 4px;border-bottom:1px solid var(--c-border2);flex-shrink:0;white-space:nowrap;}
#tc-feed-inner{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-bottom:10px;scrollbar-width:thin;scrollbar-color:var(--c-border) transparent;}
.tc-fl{display:flex;align-items:flex-start;gap:5px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:400;line-height:1.5;padding:3px 10px;border-left:2px solid transparent;color:var(--c-muted);word-break:break-word;flex-shrink:0;width:100%;box-sizing:border-box;}
.tc-fl-text{flex:1;min-width:0;}
.tc-icon{flex-shrink:0;display:inline-flex;align-items:center;margin-top:2px;}
.fl-status{color:var(--c-white);font-weight:700;font-size:13.5px;border-left-color:var(--c-gold);background:rgba(245,192,48,.07);padding-top:4px;padding-bottom:4px;margin:1px 0;}
.fl-ambient{color:var(--c-dim);font-style:italic;}
.fl-player{color:#ffe060;border-left-color:var(--c-gold);background:rgba(245,192,48,.08);}
.fl-position{color:var(--c-blue);border-left-color:#2870cc;background:rgba(110,196,255,.07);}
.fl-finish{color:var(--c-purple);font-weight:700;font-size:13.5px;border-left-color:#a855f7;background:rgba(208,144,255,.07);margin:1px 0;}
.fl-outro{color:var(--c-gold);font-weight:600;border-left-color:var(--c-gold);background:rgba(245,192,48,.08);padding-top:5px;padding-bottom:5px;}
.fl-crash{color:var(--c-red);font-weight:700;border-left-color:var(--c-red);background:rgba(255,102,102,.08);}
.fl-waiting{color:var(--c-orange);font-style:italic;border-left-color:var(--c-orange);background:rgba(255,170,80,.07);}
#tc-rc-footer{display:flex;align-items:center;gap:5px;padding:4px 10px;background:var(--c-bg2);border-top:1px solid var(--c-border2);flex-shrink:0;flex-wrap:wrap;}
.tc-foot-btn{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;background:rgba(255,255,255,.04);border:1px solid var(--c-border);color:var(--c-dim);padding:2px 9px;border-radius:3px;cursor:pointer;letter-spacing:.05em;text-transform:uppercase;transition:background .15s,color .15s,border-color .15s;white-space:nowrap;}
.tc-foot-btn:hover{background:rgba(245,192,48,.12);border-color:var(--c-gold);color:var(--c-gold);}
.tc-foot-btn.tc-btn-active{background:rgba(245,192,48,.15);border-color:var(--c-gold);color:var(--c-gold);}
#tc-live-dot{margin-left:auto;width:6px;height:6px;border-radius:50%;background:var(--c-green);flex-shrink:0;animation:tc-pulse 2.5s ease-in-out infinite;}
@keyframes tc-pulse{0%,100%{opacity:1;}50%{opacity:.15;}}
#tc-rc-credits{display:none;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:24px 16px;text-align:center;flex:1;}
.tc-cred-flag{font-size:36px;line-height:1;}
.tc-cred-title{font-family:'Orbitron',monospace;font-size:12px;font-weight:900;color:var(--c-gold);letter-spacing:.1em;line-height:1.3;}
.tc-cred-ver{font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--c-dim);letter-spacing:.08em;}
.tc-cred-by{font-size:14px;font-weight:600;color:var(--c-mid);}
.tc-cred-by strong{color:var(--c-gold);}
.tc-cred-plink{color:var(--c-blue);font-size:12px;}
.tc-cred-plink:hover{text-decoration:underline;}
.tc-cred-msg{font-size:12px;color:var(--c-muted);line-height:1.7;margin-top:4px;}
#tc-rc-lb-list::-webkit-scrollbar,#tc-feed-inner::-webkit-scrollbar{width:4px;}
#tc-rc-lb-list::-webkit-scrollbar-track,#tc-feed-inner::-webkit-scrollbar-track{background:transparent;}
#tc-rc-lb-list::-webkit-scrollbar-thumb,#tc-feed-inner::-webkit-scrollbar-thumb{background:var(--c-border);border-radius:2px;}
#tc-feed-inner::-webkit-scrollbar-thumb:hover{background:var(--c-muted);}
`;
        const styleEl = document.createElement('style');
        styleEl.id = 'tc-rc-css';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    // ─── Build HUD ────────────────────────────────────────────────────────────────
    function buildHUD () {
        if (document.getElementById('tc-rc-hud')) return;
        injectCSS();
        const hud = document.createElement('div');
        hud.id = 'tc-rc-hud';
        hud.innerHTML = `
<div id="tc-rc-drag">
  <span class="tc-title-text">&#127937; ${escH(SCRIPT_NAME)}</span>
  <div class="tc-hdr-btns">
    <button id="tc-rc-min" title="Minimise">&#9650;</button>
    <button id="tc-rc-close" title="Close">&#10005;</button>
  </div>
</div>
<div id="tc-rc-body">
  <div id="tc-rc-main">
    <div id="tc-rc-infobar">
      <div class="tc-ib-cell"><div class="tc-ib-lbl">DRIVER</div><div class="tc-ib-val" id="tc-ib-name">&#8212;</div></div>
      <div class="tc-ib-sep"></div>
      <div class="tc-ib-cell"><div class="tc-ib-lbl">TRACK</div><div class="tc-ib-val" id="tc-ib-track">&#8212;</div></div>
      <div class="tc-ib-sep"></div>
      <div class="tc-ib-cell"><div class="tc-ib-lbl">CAR</div><div class="tc-ib-val" id="tc-ib-car">&#8212;</div></div>
      <div class="tc-ib-sep"></div>
      <div class="tc-ib-cell"><div class="tc-ib-lbl">POS</div><div class="tc-ib-val" id="tc-ib-pos">&#8212;</div></div>
    </div>
    <div id="tc-rc-status-row">
      <span class="tc-st-lbl">STATUS</span>
      <span id="tc-rc-status-val" class="st-menu">MENU</span>
    </div>
    <div id="tc-rc-cols">
      <div id="tc-rc-lb-col">
        <div class="tc-col-hdr">TOP 3</div>
        <div id="tc-rc-lb-list"></div>
        <div id="tc-rc-stats">
          <div class="tc-stats-row1">
            <div class="tc-stat-group"><span class="tc-stat-lbl">LAP</span><span class="tc-stat-val" id="tc-stat-lap">&#8212;</span></div>
            <div class="tc-stat-group"><span class="tc-stat-lbl">LAST</span><span class="tc-stat-val" id="tc-stat-last">&#8212;</span></div>
          </div>
          <div class="tc-stats-row2">
            <span class="tc-comp-lbl">COMPLETED</span>
            <span id="tc-stat-comp">&#8212;</span>
          </div>
        </div>
      </div>
      <div id="tc-rc-feed-col">
        <div class="tc-col-hdr">COMMENTARY</div>
        <div id="tc-feed-inner"></div>
      </div>
    </div>
  </div>
  <div id="tc-rc-credits">
    <div class="tc-cred-flag">&#127937;</div>
    <div class="tc-cred-title">${escH(SCRIPT_NAME)}</div>
    <div class="tc-cred-ver">Version ${escH(SCRIPT_VERSION)}</div>
    <div class="tc-cred-by">Created by <strong>${escH(AUTHOR)}</strong></div>
    <a class="tc-cred-plink" href="https://www.torn.com/profiles.php?XID=${AUTHOR_ID}" target="_blank" rel="noopener">View ${escH(AUTHOR)} on Torn</a>
    <div class="tc-cred-msg">Bugs &amp; feedback welcome!<br>Find me in-game on Torn City.</div>
  </div>
</div>
<div id="tc-rc-footer">
  <button id="tc-btn-credits" class="tc-foot-btn">Credits</button>
  <button id="tc-btn-back" class="tc-foot-btn" style="display:none">&#8592; Back</button>
  <button id="tc-btn-pause" class="tc-foot-btn">&#9208; Pause</button>
  <button id="tc-btn-fix" class="tc-foot-btn">&#8862; Fix</button>
  <span id="tc-live-dot"></span>
</div>`;
        document.body.appendChild(hud);
        makeDraggable(hud, document.getElementById('tc-rc-drag'));
        document.getElementById('tc-rc-min').addEventListener('click', function () { setMinimised(!isMinimised); });
        document.getElementById('tc-rc-close').addEventListener('click', function () { hud.remove(); });
        document.getElementById('tc-btn-credits').addEventListener('click', function () {
            document.getElementById('tc-rc-main').style.display = 'none';
            document.getElementById('tc-rc-credits').style.display = 'flex';
            document.getElementById('tc-btn-credits').style.display = 'none';
            document.getElementById('tc-btn-back').style.display = '';
        });
        document.getElementById('tc-btn-back').addEventListener('click', function () {
            document.getElementById('tc-rc-credits').style.display = 'none';
            document.getElementById('tc-rc-main').style.display = '';
            document.getElementById('tc-btn-back').style.display = 'none';
            document.getElementById('tc-btn-credits').style.display = '';
        });
        document.getElementById('tc-btn-pause').addEventListener('click', function () {
            commentaryPaused = !commentaryPaused;
            // Show a status message confirming the toggle. Status messages always
            // bypass the pause filter so the user always sees this feedback.
            if (commentaryPaused) {
                pushLine('Commentary paused.', 'status');
            } else {
                pushLine('Commentary resumed.', 'status');
            }
            updatePauseBtn();
        });
        document.getElementById('tc-btn-fix').addEventListener('click', function () {
            state.windowFixed = !state.windowFixed;
            updateFixBtn();
            saveState();
        });
        updatePauseBtn();
        updateFixBtn();
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(function () {
                const el = getFeedEl();
                if (!el) return;
                const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                if (nearBottom) el.scrollTop = el.scrollHeight;
            });
            ro.observe(hud);
            const fi = getFeedEl();
            if (fi) ro.observe(fi);
        }
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────────
    function init () {
        loadState();
        commentaryPaused = false;
        buildHUD();
        rebuildFeed();
        renderInfoBar();
        renderStatus();
        renderLeaderboard();
        renderRaceStats();
        updatePauseBtn();
        resetTimers();
        poll();
        setInterval(poll, POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
