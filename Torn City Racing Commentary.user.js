// ==UserScript==
// @name         TORN CITY Race Commentary
// @namespace    sanxion.tc.racecommentary
// @version      2.43.0
// @description  Live race commentary overlay for Torn City racing
// @author       Sanxion [2987640]
// @updateURL    https://github.com/Quantarallax/Torn-City-Racing-Commentary/raw/refs/heads/main/Torn%20City%20Racing%20Commentary.user.js
// @downloadURL  https://github.com/Quantarallax/Torn-City-Racing-Commentary/raw/refs/heads/main/Torn%20City%20Racing%20Commentary.user.js
// @license      MIT
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
    const SCRIPT_VERSION = '2.43.0';
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

    const STORAGE_KEY = 'tc_racecomm_v53';
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
        WAITING: 'WAITING', RACING: 'RACING', ENDED: 'ENDED', CRASHED: 'CRASHED',
        UNAVAILABLE: 'UNAVAILABLE', HOSPITAL: 'HOSPITAL', TIMED_OUT: 'TIMED_OUT',
        ALREADY_STARTED: 'ALREADY_STARTED', RACE_FULL: 'RACE_FULL',
        NOT_ENOUGH_FUNDS: 'NOT_ENOUGH_FUNDS'
    };

    // Statuses where commentary is suppressed entirely after the entry message(s).
    // The user will see the announcement once, then nothing more until the page
    // returns to MENU (or some other active status).
    const QUIET_STATUSES = [
        'CRASHED', 'UNAVAILABLE', 'HOSPITAL', 'TIMED_OUT',
        'ALREADY_STARTED', 'RACE_FULL', 'NOT_ENOUGH_FUNDS'
    ];

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
                'Fumes gather around the cluster of vehicles.',
                'Oh, this will be interesting, I\'m sure.',
                'We suspect the no weapons rule will not be followed.',
                'Tick tick tick, *boom* Hopefully.',
                'Excitement rings through the crowd.',
                'Crowds are now gathering at all the best vantage points.'
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
                'The lights are about to come on. This is the moment.',
                'Pre-launch can be the worst part of the race.',
                'Faction members hold banners up, their message clear.'
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
                'Every lap matters at this stage. No room for error.',
                "It's crazy today!",
                'Looking forwards to how this race goes.',
                'The crowd pushes forward, onto the track while the cars blast past.'
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
                'Looks like {name} is drinking a bottle of beer, feet on the steering wheel.',
                '{name} pulls a 360, just for a laugh.',
                '{name} swerves left and right, grinding rubber.',
                'Showoff {name} blasts music out of their external speakers.'
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
                'The crowd on their feet as {p1name} and {p2name} go door to door.',
                '{p1name} scrapes metal, {p2name} swerves with the impact.',
                '{p1name} bumps their fender, {p2name} brake checks.'
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
        // When the user clicks another racer in Torn's race list, their name goes
        // here. The display (NAME/CAR/POS) then tracks that racer until focus is
        // cleared. Empty string / null means no focus override — show real player.
        focusedName: '',
        focusedCar: '',
        focusedPosition: '',
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
        // Persisted window placement: position and resized dimensions (floating mode only).
        windowLeft: '',
        windowTop: '',
        windowWidth: '',
        windowHeight: '',
        // Commentary feed scroll direction:
        // 'down' = newest at bottom, older scroll up off the top (default, matches classic log behaviour)
        // 'up'   = newest at top, older scroll down off the bottom (reverse chronological)
        scrollDirection: 'down',
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

    // For large-grid throttling: counts non-ambient racing messages so we can
    // show only every 10th when there are more than 20 drivers. Session-only.
    const BIG_RACE_THRESHOLD = 20;
    const BIG_RACE_SHOW_EVERY = 20;
    let nonAmbientRaceCounter = 0;

    let recentByType = {
        ambient: [], player: [], position: [],
        moverUp: [], moverDown: [],
        moverDownEngine: [], moverDownTyre: [], moverDownMiscalc: [],
        proximity: [], funny: [], crash: [], waiting: []
    };

    let feedLines = [];
    let knownFinishers = new Set();
    let knownRacerNames = new Set();
    // Racers we have already announced as crashed — prevents repeat messages
    // for the same player. Reset on every new race entry.
    let otherCrashedNames = new Set();
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
            state.focusedName = p.focusedName || '';
            state.focusedCar = p.focusedCar || '';
            state.focusedPosition = p.focusedPosition || '';
            state.racerCount = p.racerCount || 0;
            state.racers = p.racers || [];
            state.prevRacers = p.racers || [];
            state.finishers = p.finishers || [];
            state.outroShown = p.outroShown || false;
            state.lastLap = p.lastLap || '—';
            state.currentLap = p.currentLap || '—';
            state.completion = p.completion || '—';
            state.windowFixed = p.windowFixed || false;
            state.windowLeft = p.windowLeft || '';
            state.windowTop = p.windowTop || '';
            state.windowWidth = p.windowWidth || '';
            state.windowHeight = p.windowHeight || '';
            state.scrollDirection = (p.scrollDirection === 'up' || p.scrollDirection === 'down')
                ? p.scrollDirection : 'down';
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
            // Restore already-announced crash names so we don't replay them on refresh.
            // Any NEW crash marker found by detectOtherCrashes() after load will still fire.
            if (Array.isArray(p.otherCrashedNames)) {
                p.otherCrashedNames.forEach(function (n) { otherCrashedNames.add(n); });
            }
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
                focusedName: state.focusedName,
                focusedCar: state.focusedCar,
                focusedPosition: state.focusedPosition,
                racerCount: state.racerCount,
                racers: state.racers,
                finishers: state.finishers,
                outroShown: state.outroShown,
                lastLap: state.lastLap,
                currentLap: state.currentLap,
                completion: state.completion,
                windowFixed: state.windowFixed,
                windowLeft: state.windowLeft,
                windowTop: state.windowTop,
                windowWidth: state.windowWidth,
                windowHeight: state.windowHeight,
                scrollDirection: state.scrollDirection,
                halfwayFired: state.halfwayFired,
                preLaunchMsgCount: state.preLaunchMsgCount,
                feedLines: feedLines.slice(-MAX_FEED),
                recentByType,
                // Persist announced crash names so we don't re-announce them
                // after a page refresh during the same race.
                otherCrashedNames: Array.from(otherCrashedNames)
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

    function makeFeedNode (text, type, icon, isHtml) {
        const div = document.createElement('div');
        div.className = 'tc-fl ' + (TYPE_CLASS[type] || '');
        // When isHtml is true, the text contains pre-built safe HTML (e.g. an
        // anchor link) that we trust because it was constructed in our own code,
        // not from user input. Otherwise text is escaped as usual.
        const inner = isHtml ? text : escH(text);
        div.innerHTML = (icon || '') + '<span class="tc-fl-text">' + inner + '</span>';
        return div;
    }

    function getFeedEl () { return document.getElementById('tc-feed-inner'); }

    // In 'down' mode newest entries are at the bottom — auto-scroll keeps bottom visible.
    // In 'up' mode newest entries are at the top — auto-scroll keeps top visible.
    function scrollToEdge () {
        requestAnimationFrame(function () {
            const el = getFeedEl();
            if (!el) return;
            if (state.scrollDirection === 'up') {
                el.scrollTop = 0;
            } else {
                el.scrollTop = el.scrollHeight;
            }
        });
    }

    // Backwards-compatible alias used elsewhere in the file
    function scrollToBottom () { scrollToEdge(); }

    function appendToFeed (text, type, icon, isHtml) {
        const el = getFeedEl();
        if (!el) return;
        const node = makeFeedNode(text, type, icon || '', isHtml);
        // Per spec: colour new commentary in white, with a .25s fade to normal.
        // Applies only to genuinely new messages — NOT when the feed is rebuilt
        // from persisted history (rebuildFeed does not call this function).
        node.classList.add('tc-fl-new');
        setTimeout(function () { node.classList.remove('tc-fl-new'); }, 250);
        if (state.scrollDirection === 'up') {
            // Newest at top: insert at the start, trim from the end
            const nearTop = el.scrollTop < 80;
            el.insertBefore(node, el.firstChild);
            while (el.children.length > MAX_FEED) el.removeChild(el.lastChild);
            if (nearTop) scrollToEdge();
        } else {
            // Newest at bottom: append, trim from the start
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            el.appendChild(node);
            while (el.children.length > MAX_FEED) el.removeChild(el.firstChild);
            if (nearBottom) scrollToEdge();
        }
    }

    function rebuildFeed () {
        const el = getFeedEl();
        if (!el) return;
        el.innerHTML = '';
        if (state.scrollDirection === 'up') {
            // Render newest first — iterate in reverse
            for (let i = feedLines.length - 1; i >= 0; i--) {
                const l = feedLines[i];
                el.appendChild(makeFeedNode(l.text, l.type, l.icon || '', l.isHtml));
            }
        } else {
            feedLines.forEach(function (l) { el.appendChild(makeFeedNode(l.text, l.type, l.icon || '', l.isHtml)); });
        }
        scrollToEdge();
    }

    function pushLine (text, type, icon, isHtml) {
        const alwaysShow = (type === 'status' || type === 'finish' || type === 'outro' || type === 'crash');
        if (commentaryPaused && !alwaysShow) return;
        feedLines.push({ text: text, type: type, icon: icon || '', isHtml: !!isHtml });
        if (feedLines.length > MAX_FEED) feedLines.shift();
        appendToFeed(text, type, icon || '', isHtml);
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
                        // Rotate between three pre-launch arrival lines
                        const preLaunchLines = [
                            r.name + ' just joined in position ' + posStr + '.',
                            r.name + ' does a last minute check.',
                            r.name + ' looks fidgety behind the wheel.'
                        ];
                        const choice = preLaunchLines[Math.floor(Math.random() * preLaunchLines.length)];
                        pushLine(choice, 'status', ICON.join);
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
    // Big-grid throttling: in RACING with more than 20 drivers, only show every
    // 10th non-ambient message (position calls, player-specific, proximity,
    // movement calls). Ambient lines and funny lines always show — they're the
    // atmospheric colour commentary and set the pace. Returns true if the
    // non-ambient message should be shown, false to suppress it.
    function bigRaceShouldShow () {
        if (state.status !== S.RACING) return true;
        if ((state.racerCount || 0) <= BIG_RACE_THRESHOLD) return true;
        nonAmbientRaceCounter++;
        return (nonAmbientRaceCounter % BIG_RACE_SHOW_EVERY) === 1;
    }

    function fireCommentary (st) {
        // In quiet statuses (CRASHED, UNAVAILABLE, HOSPITAL, TIMED_OUT) the entry
        // message(s) have already fired in onStatusChange. No further commentary
        // should print until the player returns to a normal status.
        if (QUIET_STATUSES.indexOf(st) !== -1) return;
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
                if (bigRaceShouldShow()) {
                    pushLine(fill(pickLine(LINES.RACING.player, 'player')), 'player');
                }
                tPlayer = now + PLAYER_GAP + Math.random() * 8000;
            }
            // Position calls — gated by cooldown; pool selection uses authoritative racerCount
            if (now >= tPosition && now >= tPosCooldown && state.racers.length >= 2) {
                if (bigRaceShouldShow()) {
                    if (isThreePlusRace()) {
                        // 3+ racers confirmed from Position: X/Y — safe to use position3 lines
                        const pool = LINES.RACING.position3.concat(LINES.RACING.position2);
                        pushLine(fill(pickLine(pool, 'position')), 'position');
                    } else {
                        // 2 racers or unknown — only use 2-player-safe lines
                        pushLine(fill(pickLine(LINES.RACING.position2, 'position')), 'position');
                    }
                }
                tPosition = now + POSITION_GAP + Math.random() * 5000;
            }
            detectMovement();
            if (now >= tProximity && state.racers.length >= 2) {
                const idx = Math.floor(Math.random() * (state.racers.length - 1));
                const r1 = state.racers[idx];
                const r2 = state.racers[idx + 1];
                if (r1 && r2) {
                    if (bigRaceShouldShow()) {
                        pushLine(
                            fill(pickLine(LINES.RACING.proximity, 'proximity'), { p1name: r1.name, p2name: r2.name }),
                            'position', ICON.proximity
                        );
                    }
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
            // Always show the player's own gains and leader changes; throttle others in big races.
            if (isPlayer || item.isLeader || bigRaceShouldShow()) {
                pushLine(text, isPlayer ? 'player' : 'position', ICON.up);
            }
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
            // Always show the player's own losses and leader changes; throttle others in big races.
            if (isPlayer || item.isLeader || bigRaceShouldShow()) {
                pushLine(text, isPlayer ? 'player' : 'position', ICON.down);
            }
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

    // Fire the sequence for when ANOTHER racer crashes (not the player).
    // The race continues, so status stays in RACING — just the feed shows the events.
    function fireOtherCrashSequence (crashedName) {
        const msgs = [
            'There has been a crash!',
            crashedName + ' has come into contact with something!',
            'We are getting reports in, car in flames, wreckage everywhere!',
            crashedName + ' has been removed from the car and rushed to hospital!'
        ];
        [0, 2500, 5000, 8500].forEach(function (d, i) {
            setTimeout(function () { pushLine(msgs[i], 'crash'); }, d);
        });
    }

    // Detect other players who have crashed by scraping Torn's crash UI markers.
    // When a racer crashes, their driver <li> gets a "status crash" indicator
    // somewhere inside (exact tag and class hashing can vary, so we cast wide).
    // The player name lives in a span/a with a name-related class in the same <li>.
    //
    // Must also work on page refresh: any crash markers already in the DOM
    // on load should be picked up and fired (unless already in otherCrashedNames
    // from the persisted state).
    function detectOtherCrashes () {
        // Run during active RACING OR during the post-refresh restore bounce
        // where the detected status may briefly flicker before settling.
        if (state.status !== S.RACING && !restoredIntoRacing) return;

        // Collect candidate crash markers via several selector strategies,
        // covering Torn's possible class variations (plain "status crash",
        // hashed module CSS like statusCrash___xyz, or crash-suffix patterns).
        const selectors = [
            '.status.crash',
            '[class*="status"][class*="crash"]',
            '[class*="statusCrash"]',
            '[class*="crashed"]'
        ];
        const candidates = new Set();
        selectors.forEach(function (sel) {
            try {
                document.querySelectorAll(sel).forEach(function (el) { candidates.add(el); });
            } catch (_) {}
        });

        candidates.forEach(function (crashEl) {
            // Walk up to the enclosing <li> (or the nearest driver row)
            const li = crashEl.closest('li') ||
                       crashEl.closest('[class*="driver"]') ||
                       crashEl.closest('[class*="racer"]');
            if (!li) return;
            // Skip: our own HUD must never be treated as Torn DOM
            if (li.closest('#tc-rc-hud')) return;
            // Skip: stale crash markers inside Torn's Events / Messages / Awards
            // dropdowns are race history, not the current race.
            if (isInsideTornMenu(li)) return;
            // Skip: rows whose text reads like an Events feed entry — the "crash"
            // marker there describes a past race, not a live one.
            if (looksLikeEventsRow(li)) return;

            // Extract the racer name from common patterns
            let name = '';
            const nameSelectors = [
                'span.name',
                'span[class*="name"]',
                'a[class*="name"]',
                '[class*="name"] span',
                'li.name',
                'li[class*="name"]',
                '[class*="name"]',
                'a'
            ];
            for (let i = 0; i < nameSelectors.length && !name; i++) {
                const el = li.querySelector(nameSelectors[i]);
                if (el) {
                    const t = (el.textContent || '').trim();
                    // Skip obvious non-names (status text, numbers, etc.)
                    if (t && t.length >= 2 && t.length <= 40 &&
                        !/^\d+$/.test(t) && !/^(crash|crashed|status)/i.test(t) &&
                        !/^You(\s|$)/.test(t)) {
                        name = t;
                    }
                }
            }
            if (!name) return;
            if (name === state.playerName) return;
            if (knownFinishers.has(name)) return;
            if (otherCrashedNames.has(name)) return;

            otherCrashedNames.add(name);
            fireOtherCrashSequence(name);
        });
    }

    // Filter out crashed racers from any active racer list used for commentary.
    // Spec: "disregard them from the commentary, do not use their name again."
    function excludeCrashed (racers) {
        if (!otherCrashedNames.size) return racers;
        return racers.filter(function (r) { return !otherCrashedNames.has(r.name); });
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
                otherCrashedNames.clear();
                nonAmbientRaceCounter = 0;
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

        // Per spec: when joining a race at any entry status (COUNTDOWN,
        // PRE-LAUNCH, or WAITING), announce existing racers and the player's
        // entry position using the new wording.
        function fireEntryMessages () {
            if (restoredIntoRacing) return;
            const others = racersBeforeClear.filter(function (r) { return r.name !== state.playerName; });
            if (others.length > 0) {
                const n = others.length;
                pushLine(
                    'There ' + (n === 1 ? 'is' : 'are') + ' ' + n + ' racer' + (n === 1 ? '' : 's') + ' already on the track.',
                    'status'
                );
            }
            // Only show the join message when we have a real name and position.
            const validName = state.playerName !== '—' && state.playerName !== '';
            const validPos = parseInt(state.position, 10) >= 1;
            if (validName && validPos) {
                pushLine(fill('{player} rolls onto the track in {pos}.'), 'status', ICON.join);
            }
        }

        if (newSt === S.COUNTDOWN) {
            fireEntryMessages();
        }
        if (newSt === S.PRE_LAUNCH && oldSt !== S.PRE_LAUNCH) {
            // Only announce an entry if we came from MENU/unknown — not from COUNTDOWN,
            // where the entry was already announced.
            if (oldSt === S.MENU || oldSt === S.ENDED || oldSt === S.CRASHED || !oldSt) {
                fireEntryMessages();
            }
            pushLine('Engines are revving — not long until launch.', 'status', ICON.prelaunch);
            if (oldSt === S.COUNTDOWN) {
                pushLine('We are now in Pre-Launch.', 'status', ICON.prelaunch);
            }
        }
        if (newSt === S.WAITING) {
            // Fire entry messages if we're coming into WAITING from the menu
            // (i.e. the player joined a race that doesn't have enough drivers yet)
            if (oldSt === S.MENU || oldSt === S.ENDED || oldSt === S.CRASHED || !oldSt) {
                fireEntryMessages();
            }
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
        if (newSt === S.UNAVAILABLE && oldSt !== S.UNAVAILABLE) {
            clearFeed();
            pushLine('Racetrack is unavailable at the moment.', 'status');
            // Build the second line with a clickable link to the travel page.
            // The text is HTML-trusted because we construct it ourselves with
            // the player's name escaped via escH().
            const safeName = escH(state.playerName !== '—' && state.playerName ? state.playerName : 'The driver');
            const html = safeName + ' is currently <a class="tc-link" href="https://www.torn.com/page.php?sid=travel" target="_blank" rel="noopener">flying or abroad</a>.';
            pushLine(html, 'status', '', true);
        }
        if (newSt === S.HOSPITAL && oldSt !== S.HOSPITAL) {
            clearFeed();
            // Hospital: one message with "hospital" hyperlinked to the hospital page,
            // then no further commentary until the page returns to a normal status.
            const html = 'You are in <a class="tc-link" href="https://www.torn.com/hospitalview.php" target="_blank" rel="noopener">hospital</a>, you better stay and rest.';
            pushLine(html, 'status', '', true);
        }
        if (newSt === S.TIMED_OUT && oldSt !== S.TIMED_OUT) {
            clearFeed();
            pushLine('The racers have all gone home.', 'status');
            pushLine('The track is deserted!', 'status');
            pushLine('Race timed out. Return to pits.', 'status');
        }
        if (newSt === S.ALREADY_STARTED && oldSt !== S.ALREADY_STARTED) {
            clearFeed();
            const safeName = (state.playerName !== '—' && state.playerName)
                ? state.playerName : 'The driver';
            pushLine(safeName + ' drives onto the paddock.', 'status');
            pushLine('There are no racers, it is deserted.', 'status');
            pushLine('Race has already started.', 'status');
        }
        if (newSt === S.RACE_FULL && oldSt !== S.RACE_FULL) {
            clearFeed();
            const safeName = (state.playerName !== '—' && state.playerName)
                ? state.playerName : 'The driver';
            pushLine(safeName + ' attempts to squeeze his car into the race.', 'status');
            pushLine('And they are promptly warned back by armed marshalls.', 'status');
            pushLine('Race is full.', 'status');
        }
        if (newSt === S.NOT_ENOUGH_FUNDS && oldSt !== S.NOT_ENOUGH_FUNDS) {
            clearFeed();
            const safeName = (state.playerName !== '—' && state.playerName)
                ? state.playerName : 'The driver';
            pushLine(safeName + ' drives onto the paddock.', 'status');
            pushLine('But they are immediately turned around.', 'status');
            pushLine('Not enough funds to enter race.', 'status');
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
    // Compiled once: matches the Events-feed signature anywhere in a string.
    // Pattern: a digit followed by a time unit (s/m/h/d/w) as a standalone token,
    // followed by whitespace and any non-whitespace. This catches things like
    // "1m You finished in", "2h crashed", "30s came 3rd". Real racing-page text
    // never naturally contains this pattern.
    const EVENTS_TEXT_PATTERN = /(^|[\s>])\d+(s|m|h|d|w)\s+\S/i;

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
            // Remove Torn's top-bar dropdowns (Events, Messages, Awards, etc.).
            // When the Events menu is open it shows recent race-result text that
            // gets falsely picked up by our scrapers. The dropdowns share several
            // class/id patterns we can target broadly.
            const tornMenus = clone.querySelectorAll(
                // Torn's Events drop-down — the precise class confirmed by the user
                '.recent-history-content,[class*="recent-history-content"],' +
                // Events drop-down menu (other class variants)
                '[id*="events-list"],[id*="eventsList"],[id*="event-list"],[id*="eventList"],' +
                '[class*="events-list"],[class*="eventsList"],[class*="event-list"],[class*="eventList"],' +
                '[class*="eventsMenu"],[class*="events-menu"],' +
                // Sidebar/topbar item that wraps the dropdown
                '[id*="event-items"],[id*="eventItems"],[class*="event-items"],[class*="eventItems"],' +
                // Generic notification-menu containers commonly used by Torn's topbar
                '[class*="notifications-list"],[class*="notificationsList"],' +
                '[class*="messages-list"],[class*="messagesList"],' +
                '[class*="awards-list"],[class*="awardsList"],' +
                // Torn marks open dropdowns with these state classes — strip the entire panel
                '[class*="dropdown"][class*="open"],[class*="dropdown"][class*="active"]'
            );
            tornMenus.forEach(function (el) {
                if (el.parentNode) el.parentNode.removeChild(el);
            });
            let raw = clone.innerText || '';
            // Final scrub: remove any sentence/line that bears the Events-feed
            // signature (a "1m"/"2h"/"5d" recency counter followed by event prose,
            // or a "You ..." sentence pattern). These are Events menu entries that
            // survived the structural strip and would otherwise corrupt status
            // detection — e.g. an Events entry containing "crashed" was triggering
            // false CRASHED status changes.
            raw = raw.split(/\n+/).filter(function (line) {
                const t = line.trim();
                if (!t) return true;
                if (EVENTS_TEXT_PATTERN.test(t)) return false;
                return true;
            }).join('\n');
            return raw;
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

    // Helper: extract the Torn user ID from any element inside a racer row.
    // Searches for an <a href="/profiles.php?XID=12345"> link, data-id, data-user-id,
    // or similar attributes. Returns a numeric string, or empty if none found.
    function extractUserId (container) {
        if (!container) return '';
        // Try anchor hrefs first (most reliable)
        const anchors = container.querySelectorAll('a[href]');
        for (let i = 0; i < anchors.length; i++) {
            const href = anchors[i].getAttribute('href') || '';
            const m = href.match(/XID=(\d+)/i) || href.match(/profiles\.php\?.*?ID=(\d+)/i) ||
                      href.match(/\/profile[s]?\/(\d+)/i);
            if (m) return m[1];
        }
        // Fall back to data attributes on the container or its children
        const withData = container.matches && container.matches('[data-id],[data-user-id],[data-userid]')
            ? container
            : container.querySelector('[data-id],[data-user-id],[data-userid]');
        if (withData) {
            const id = withData.getAttribute('data-id') ||
                       withData.getAttribute('data-user-id') ||
                       withData.getAttribute('data-userid') || '';
            if (/^\d+$/.test(id)) return id;
        }
        return '';
    }

    // Is this driver row currently the "focused" one — i.e. the user clicked
    // on this racer in Torn's list. Torn typically adds an active/expanded/selected
    // class to the row (and/or shows an expanded sub-panel).
    function isRowFocused (row) {
        if (!row) return false;
        const cls = (row.className && typeof row.className === 'string') ? row.className : '';
        if (/\b(active|focused|selected|expanded|current|open)\b/i.test(cls)) return true;
        // Also check if the row has an expanded child panel visible
        const expanded = row.querySelector('[class*="active"], [class*="expanded"], [class*="selected"]');
        return !!expanded;
    }

    // Try to read the car name from a racer row's expanded panel. Torn's layout
    // shows car info inside the row when expanded, often with "car" in the class.
    function extractCarFromRow (row) {
        if (!row) return '';
        const carEl = row.querySelector('[class*="car"][class*="name"], [class*="carName"], [class*="vehicle"]');
        if (carEl) {
            const t = (carEl.textContent || '').trim();
            if (t && t.length > 1 && t.length < 50) return t;
        }
        return '';
    }

    // Returns true if `el` (or any ancestor) belongs to one of Torn's top-bar
    // dropdown panels (Events, Messages, Awards, etc.). When those panels are
    // open they can contain race-result content that pollutes our scraping.
    function isInsideTornMenu (el) {
        if (!el) return false;
        return !!el.closest(
            // The precise Torn Events panel class (confirmed by user)
            '.recent-history-content,[class*="recent-history-content"],' +
            // Other Events drop-down variants
            '[id*="events-list"],[id*="eventsList"],[id*="event-list"],[id*="eventList"],' +
            '[class*="events-list"],[class*="eventsList"],[class*="event-list"],[class*="eventList"],' +
            '[class*="eventsMenu"],[class*="events-menu"],' +
            '[id*="event-items"],[id*="eventItems"],[class*="event-items"],[class*="eventItems"],' +
            '[class*="notifications-list"],[class*="notificationsList"],' +
            '[class*="messages-list"],[class*="messagesList"],' +
            '[class*="awards-list"],[class*="awardsList"]'
        );
    }

    // Heuristic fallback for Events-menu pollution that survives the structural
    // strip. Per spec: Torn's Events feed entries are prefixed with a recency
    // counter (e.g. "1m", "2h", "5d", "30s") — that pattern is the reliable
    // fingerprint for Events feed text. A real racer row never contains
    // "<digit>+<smhdw> <Word>" because driver rows show position + name only.
    // The "You" sentence pattern is also a strong tell, but is filtered too
    // since Events entries describe the user's own past actions ("You came...").
    function looksLikeEventsRow (el) {
        if (!el) return false;
        const txt = (el.textContent || '').trim();
        if (!txt) return false;
        return EVENTS_TEXT_PATTERN.test(txt);
    }

    function scrapeRacers () {
        // This returns names and positions for leaderboard display and movement detection.
        // Its .length is NOT used for racerCount — use scrapePosition().total for that.
        const racers = [];
        const driverItems = document.querySelectorAll('ul.driver-item, ul[class*="driver-item"]');
        driverItems.forEach(function (ul, idx) {
            // Skip rows inside Torn's Events / Messages / Awards dropdowns —
            // those contain stale race result data that would corrupt the scrape.
            if (isInsideTornMenu(ul)) return;
            // Heuristic fallback: skip rows whose text reads like an Events feed
            // sentence ("You came 3rd in...", etc.).
            if (looksLikeEventsRow(ul)) return;
            const nameEl = ul.querySelector('li.name, li[class*="name"]');
            const posEl = ul.querySelector('li.position, li[class*="position"], li[class*="pos"], li[class*="rank"]');
            const name = nameEl ? nameEl.textContent.trim() : '';
            const posNum = parseInt(posEl ? posEl.textContent.trim() : '', 10) || idx + 1;
            if (name && name.length > 1 && name.length < 40 && !/^You(\s|$)/.test(name)) {
                racers.push({
                    name: name,
                    pos: String(posNum),
                    posNum: posNum,
                    userId: extractUserId(ul),
                    focused: isRowFocused(ul),
                    car: extractCarFromRow(ul)
                });
            }
        });
        if (!racers.length) {
            const rows = document.querySelectorAll(
                '[class*="racer"], [class*="racePlayer"], [class*="racerRow"], ' +
                '[class*="leaderboard"] tr, [class*="standings"] tr, [class*="raceTable"] tr, [class*="raceList"] li'
            );
            rows.forEach(function (row) {
                if (isInsideTornMenu(row)) return;
                if (looksLikeEventsRow(row)) return;
                const nameEl = row.querySelector('[class*="name"], [class*="player"]');
                const posEl = row.querySelector('[class*="pos"], [class*="rank"], [class*="place"]');
                const name = nameEl ? nameEl.textContent.trim() : '';
                const pos = posEl ? posEl.textContent.trim() : '';
                if (name && name.length > 1 && name.length < 40 && !/^You(\s|$)/.test(name)) {
                    racers.push({
                        name: name,
                        pos: pos || '?',
                        posNum: parseInt(pos, 10) || 0,
                        userId: extractUserId(row),
                        focused: isRowFocused(row),
                        car: extractCarFromRow(row)
                    });
                }
            });
        }
        if (!racers.length) {
            const rx = /(\d+)\.\s+([A-Za-z0-9_\-]+)/g;
            let rm;
            while ((rm = rx.exec(getPageText())) !== null) {
                if (parseInt(rm[1], 10) <= 100) {
                    racers.push({
                        name: rm[2], pos: rm[1], posNum: parseInt(rm[1], 10),
                        userId: '', focused: false, car: ''
                    });
                }
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
        // Hospital: player can't race at all while in hospital
        if (/you\s+cannot\s+do\s+this\s+while\s+in\s+hospital/i.test(text)) {
            return S.HOSPITAL;
        }
        // Race timed out: a previous race attempt failed to start
        if (/your\s+last\s+race\s+timed\s+out\s+at/i.test(text)) {
            return S.TIMED_OUT;
        }
        // Race already started: tried to join too late
        if (/incorrect\s+race/i.test(text)) {
            return S.ALREADY_STARTED;
        }
        // Race full: tried to join a full race
        if (/maximum\s+amount\s+of\s+drivers\s+achieved/i.test(text)) {
            return S.RACE_FULL;
        }
        // Not enough funds for race entry fee
        if (/you\s+don'?t\s+have\s+enough\s+money/i.test(text)) {
            return S.NOT_ENOUGH_FUNDS;
        }
        // Travel block: when the player is flying or abroad, Torn shows
        // "This page is unavailable while you're traveling." — racing isn't
        // possible during travel so return a dedicated UNAVAILABLE status.
        if (/this\s+page\s+is\s+unavailable\s+while\s+you'?re\s+travel(l)?ing/i.test(text)) {
            return S.UNAVAILABLE;
        }
        // CRASHED detection: rely ONLY on Torn's structural crash UI markers
        // attached to real driver rows. The previous text-based check
        // ("crashed" in page text) was triggered falsely when an Events-menu
        // entry containing the word "crashed" scrolled into view, leaving the
        // script stuck in CRASHED mid-race. We now require an actual crash
        // marker element that is NOT inside Torn's top-bar dropdowns.
        const crashMarkers = document.querySelectorAll(
            'div.status.crash, div[class*="status"][class*="crash"], ' +
            '[class*="statusCrash"], [class*="crashed"], [class*="wrecked"]'
        );
        for (let i = 0; i < crashMarkers.length; i++) {
            const m = crashMarkers[i];
            // Skip our own HUD and Torn's notification dropdowns
            if (m.closest('#tc-rc-hud')) continue;
            if (isInsideTornMenu(m)) continue;
            // Confirm it's attached to (or near) the player's own row by
            // checking the enclosing driver row's text contains the player name.
            const li = m.closest('li') || m.closest('[class*="driver"]') || m.closest('[class*="racer"]');
            if (!li) continue;
            if (looksLikeEventsRow(li)) continue;
            const liText = (li.textContent || '');
            if (state.playerName && state.playerName !== '—' && liText.indexOf(state.playerName) !== -1) {
                return S.CRASHED;
            }
        }
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
            // Check if the user has clicked another racer in Torn's list.
            // If so, update focus state so the NAME/CAR/POS display follows them.
            const focused = newRacers.find(function (r) { return r.focused; });
            if (focused && focused.name && focused.name !== state.playerName) {
                state.focusedName = focused.name;
                // Update car at the same time per spec
                if (focused.car) state.focusedCar = focused.car;
                state.focusedPosition = String(focused.posNum || '');
            } else if (!focused) {
                // No racer row is marked focused — clear the override so the
                // display reverts to the real player.
                state.focusedName = '';
                state.focusedCar = '';
                state.focusedPosition = '';
            }
            const prevRacersSnapshot = state.racers.slice();
            state.prevRacers = prevRacersSnapshot;
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
                // Scrape Torn's explicit crash markers each poll
                detectOtherCrashes();
            }
            // Filter out crashed racers from the active commentary list.
            // They still exist in the DOM briefly but should be ignored entirely
            // in all future commentary per the spec.
            if (otherCrashedNames.size) {
                state.racers = excludeCrashed(state.racers);
                state.prevRacers = excludeCrashed(state.prevRacers);
            }
        }

        // Blank stats in all menu/error/quiet statuses
        const blankStatsStatuses = [S.MENU, S.UNAVAILABLE, S.HOSPITAL, S.TIMED_OUT,
            S.ALREADY_STARTED, S.RACE_FULL, S.NOT_ENOUGH_FUNDS];
        if (blankStatsStatuses.indexOf(newStatus) === -1) {
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

        // Scrape Torn's .status.crash DOM markers unconditionally each poll —
        // catches crashes even if newRacers was briefly empty this tick,
        // and catches any crash already in the DOM after a page refresh.
        if (state.status === S.RACING || restoredIntoRacing) {
            detectOtherCrashes();
            if (otherCrashedNames.size) {
                state.racers = excludeCrashed(state.racers);
            }
        }

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
        // If a racer is focused (user clicked their name in Torn's list),
        // show that racer's name/car/pos instead of the real player's.
        const focusActive = !!(state.focusedName && state.focusedName !== '—');
        const displayName = focusActive ? state.focusedName : state.playerName;
        const displayCar = focusActive && state.focusedCar ? state.focusedCar : state.car;
        const displayPos = focusActive && state.focusedPosition
            ? state.focusedPosition
            : state.position;
        sv('tc-ib-name', displayName);
        sv('tc-ib-track', state.track);
        sv('tc-ib-car', displayCar);
        const posNum = parseInt(displayPos, 10);
        sv('tc-ib-pos', posNum >= 1 ? ordinal(posNum) : '—');
        // Visual cue: a subtle marker next to the driver label when focus is on another racer.
        const driverLabel = document.getElementById('tc-ib-name');
        if (driverLabel) {
            driverLabel.classList.toggle('tc-focus-other', focusActive);
        }
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
            [S.CRASHED]: { label: 'CRASHED', cls: 'st-crashed' },
            [S.UNAVAILABLE]: { label: 'UNAVAILABLE', cls: 'st-unavailable' },
            [S.HOSPITAL]: { label: 'HOSPITAL', cls: 'st-hospital' },
            [S.TIMED_OUT]: { label: 'TIMED OUT', cls: 'st-timedout' },
            [S.ALREADY_STARTED]: { label: 'TOO LATE', cls: 'st-toolate' },
            [S.RACE_FULL]: { label: 'RACE FULL', cls: 'st-racefull' },
            [S.NOT_ENOUGH_FUNDS]: { label: 'INSUFFICIENT FUNDS', cls: 'st-nofunds' }
        };
        const m = map[state.status] || { label: state.status, cls: 'st-menu' };
        el.textContent = m.label;
        el.className = m.cls;
    }

    function renderLeaderboard () {
        const el = document.getElementById('tc-rc-lb-list');
        if (!el) return;
        if (state.status === S.MENU) { el.innerHTML = '<div class="tc-lb-empty">Select a race\u2026</div>'; return; }
        if (state.status === S.UNAVAILABLE) { el.innerHTML = '<div class="tc-lb-empty">Travelling\u2026</div>'; return; }
        if (state.status === S.HOSPITAL) { el.innerHTML = '<div class="tc-lb-empty">In hospital.</div>'; return; }
        if (state.status === S.TIMED_OUT) { el.innerHTML = '<div class="tc-lb-empty">Race timed out.</div>'; return; }
        if (state.status === S.ALREADY_STARTED) { el.innerHTML = '<div class="tc-lb-empty">Race already started.</div>'; return; }
        if (state.status === S.RACE_FULL) { el.innerHTML = '<div class="tc-lb-empty">Race full.</div>'; return; }
        if (state.status === S.NOT_ENOUGH_FUNDS) { el.innerHTML = '<div class="tc-lb-empty">Insufficient funds.</div>'; return; }
        const top6 = state.racers.slice(0, 6);
        if (!top6.length) { el.innerHTML = '<div class="tc-lb-empty">Awaiting data\u2026</div>'; return; }
        el.innerHTML = top6.map(function (r, i) {
            const pn = r.posNum || i + 1;
            const isMe = r.name === state.playerName;
            // Gold/silver/bronze for positions 1-3, muted styling for 4-6.
            let posClass = 'lb-px';
            if (pn === 1) posClass = 'lb-p1';
            else if (pn === 2) posClass = 'lb-p2';
            else if (pn === 3) posClass = 'lb-p3';
            // Per spec: leaderboard player names are NOT hyperlinked.
            return '<div class="tc-lb-row' + (isMe ? ' lb-me' : '') + (pn > 3 ? ' lb-lower' : '') + '">'
                + '<span class="tc-lb-pos ' + posClass + '">' + ordinal(pn) + '</span>'
                + (TROPHY[pn] || '<span class="tc-lb-spacer"></span>')
                + '<span class="tc-lb-name">' + escH(r.name) + '</span>'
                + '</div>';
        }).join('');
    }

    function renderRaceStats () {
        const sv = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
        sv('tc-stat-last', state.lastLap);
        sv('tc-stat-lap', state.currentLap);
        sv('tc-stat-comp', state.completion);
    }

    function updateScrollDirBtn () {
        const btn = document.getElementById('tc-btn-scroll-dir');
        const arrow = document.getElementById('tc-col-hdr-arrow');
        const isUp = state.scrollDirection === 'up';
        if (btn) btn.innerHTML = isUp ? '\u2191 Up' : '\u2193 Down';
        // Also reflect the direction in the COMMENTARY column header so the user
        // always sees an indicator of which way the feed grows.
        if (arrow) arrow.innerHTML = isUp ? '&#8593;' : '&#8595;';
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
            if (state.windowFixed) {
                hud.classList.add('tc-fixed');
                // Strip inline position/size so the .tc-fixed CSS rule fully takes effect
                hud.style.left = '';
                hud.style.top = '';
                hud.style.right = '';
                hud.style.width = '';
                hud.style.height = '';
            } else {
                hud.classList.remove('tc-fixed');
                // Restore persisted floating-mode position and size
                if (state.windowLeft) { hud.style.left = state.windowLeft; hud.style.right = 'auto'; }
                if (state.windowTop) { hud.style.top = state.windowTop; }
                if (state.windowWidth) { hud.style.width = state.windowWidth; }
                if (state.windowHeight) { hud.style.height = state.windowHeight; }
            }
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
        document.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            // Persist the new position so it survives a page refresh
            state.windowLeft = hudEl.style.left || '';
            state.windowTop = hudEl.style.top || '';
            saveState();
        });
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
.tc-ib-val.tc-focus-other{color:var(--c-blue);}
#tc-rc-status-row{display:flex;align-items:center;gap:10px;padding:7px 12px 6px;background:var(--c-bg2);border-bottom:1px solid var(--c-border2);flex-shrink:0;}
.tc-st-lbl{font-family:'Orbitron',monospace;font-size:8px;font-weight:700;color:var(--c-dim);letter-spacing:.14em;flex-shrink:0;}
#tc-rc-status-val{font-family:'Orbitron',monospace;font-size:20px;font-weight:900;letter-spacing:.05em;}
.st-menu{color:var(--c-gold);}.st-countdown{color:var(--c-blue);}.st-prelaunch{color:var(--c-orange);}.st-waiting{color:var(--c-orange);}.st-racing{color:var(--c-green);}.st-ended{color:var(--c-purple);}.st-crashed{color:var(--c-red);}.st-unavailable{color:var(--c-orange);}.st-hospital{color:var(--c-red);}.st-timedout{color:var(--c-orange);}.st-toolate{color:var(--c-orange);}.st-racefull{color:var(--c-orange);}.st-nofunds{color:var(--c-orange);}
.tc-fl a.tc-link{color:var(--c-blue);text-decoration:underline;}
.tc-fl a.tc-link:hover{color:var(--c-gold);}
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
.lb-px{color:var(--c-muted);}
.tc-lb-row.lb-lower{font-size:11px;padding:3px 6px;}
.tc-lb-row.lb-lower .tc-lb-pos{font-size:8px;}
.tc-lb-row.lb-lower .tc-lb-name{color:var(--c-muted);font-weight:500;}
.tc-lb-spacer{display:inline-block;width:14px;flex-shrink:0;}
.tc-trophy{font-size:14px;flex-shrink:0;line-height:1;}
.tp-gold{filter:drop-shadow(0 0 4px rgba(255,208,64,.8));}.tp-silver{filter:drop-shadow(0 0 4px rgba(208,220,232,.7));}.tp-bronze{filter:drop-shadow(0 0 4px rgba(232,160,80,.7));}
.tc-lb-name{color:var(--c-mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.tc-lb-row.lb-me .tc-lb-name{color:#ffe060;}
a.tc-link{color:inherit;text-decoration:none;transition:color .15s;}
a.tc-link:hover{color:var(--c-blue);text-decoration:underline;}
#tc-rc-feed-col{position:absolute;top:0;left:143px;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;}
.tc-col-hdr{font-family:'Orbitron',monospace;font-size:7px;font-weight:700;color:var(--c-dim);letter-spacing:.14em;padding:5px 8px 4px;border-bottom:1px solid var(--c-border2);flex-shrink:0;white-space:nowrap;}
#tc-col-hdr-arrow{color:var(--c-gold);margin-left:4px;font-size:9px;letter-spacing:0;}
#tc-feed-inner{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-bottom:10px;scrollbar-width:thin;scrollbar-color:var(--c-border) transparent;}
.tc-fl{display:flex;align-items:flex-start;gap:5px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:400;line-height:1.5;padding:3px 10px;border-left:2px solid transparent;color:var(--c-muted);word-break:break-word;flex-shrink:0;width:100%;box-sizing:border-box;transition:color .25s linear;}
.tc-fl.tc-fl-new,.tc-fl.tc-fl-new .tc-fl-text{color:#ffffff !important;transition:none;}
.tc-fl-text{flex:1;min-width:0;transition:color .25s linear;}
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
#tc-rc-settings{display:none;flex-direction:column;align-items:center;justify-content:flex-start;gap:7px;padding:20px 18px;flex:1;overflow-y:auto;}
.tc-set-title{font-family:'Orbitron',monospace;font-size:12px;font-weight:900;color:var(--c-gold);letter-spacing:.1em;text-align:center;margin-bottom:6px;width:100%;}
.tc-set-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid var(--c-border2);border-radius:3px;width:100%;box-sizing:border-box;}
.tc-set-divider{width:100%;height:1px;background:var(--c-border2);margin:14px 0 6px;}
.tc-set-lbl{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;color:var(--c-mid);letter-spacing:.04em;}
.tc-set-hint{font-family:'Barlow Condensed',sans-serif;font-size:11px;color:var(--c-dim);line-height:1.6;padding:4px 4px;width:100%;text-align:left;}
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
        <div class="tc-col-hdr">TOP 6</div>
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
        <div class="tc-col-hdr" id="tc-col-hdr-commentary">COMMENTARY <span id="tc-col-hdr-arrow">&#8595;</span></div>
        <div id="tc-feed-inner"></div>
      </div>
    </div>
  </div>
  <div id="tc-rc-settings">
    <div class="tc-cred-flag">&#127937;</div>
    <div class="tc-cred-title">${escH(SCRIPT_NAME)}</div>
    <div class="tc-cred-ver">Version ${escH(SCRIPT_VERSION)}</div>
    <div class="tc-cred-by">Created by <strong>${escH(AUTHOR)}</strong></div>
    <a class="tc-cred-plink" href="https://www.torn.com/profiles.php?XID=${AUTHOR_ID}" target="_blank" rel="noopener">View ${escH(AUTHOR)} on Torn</a>
    <div class="tc-cred-msg">Bugs &amp; feedback welcome!<br>Find me in-game on Torn City.</div>
    <div class="tc-set-divider"></div>
    <div class="tc-set-row">
      <span class="tc-set-lbl">Commentary scroll</span>
      <button id="tc-btn-scroll-dir" class="tc-foot-btn">&#8595; Down</button>
    </div>
    <div class="tc-set-hint">
      Down: newest messages appear at the bottom, older scroll up.<br>
      Up: newest messages appear at the top, older scroll down.
    </div>
  </div>
</div>
<div id="tc-rc-footer">
  <button id="tc-btn-settings" class="tc-foot-btn">Settings</button>
  <button id="tc-btn-back" class="tc-foot-btn" style="display:none">&#8592; Back</button>
  <button id="tc-btn-pause" class="tc-foot-btn">&#9208; Pause</button>
  <button id="tc-btn-fix" class="tc-foot-btn">&#8862; Fix</button>
  <span id="tc-live-dot"></span>
</div>`;
        document.body.appendChild(hud);
        // Restore persisted window position and size (floating mode only)
        if (!state.windowFixed) {
            if (state.windowLeft) { hud.style.left = state.windowLeft; hud.style.right = 'auto'; }
            if (state.windowTop) { hud.style.top = state.windowTop; }
            if (state.windowWidth) { hud.style.width = state.windowWidth; }
            if (state.windowHeight) { hud.style.height = state.windowHeight; }
        }
        makeDraggable(hud, document.getElementById('tc-rc-drag'));
        document.getElementById('tc-rc-min').addEventListener('click', function () { setMinimised(!isMinimised); });
        document.getElementById('tc-btn-settings').addEventListener('click', function () {
            document.getElementById('tc-rc-main').style.display = 'none';
            document.getElementById('tc-rc-settings').style.display = 'flex';
            document.getElementById('tc-btn-settings').style.display = 'none';
            document.getElementById('tc-btn-back').style.display = '';
            updateScrollDirBtn();
        });
        document.getElementById('tc-btn-back').addEventListener('click', function () {
            document.getElementById('tc-rc-settings').style.display = 'none';
            document.getElementById('tc-rc-main').style.display = '';
            document.getElementById('tc-btn-back').style.display = 'none';
            document.getElementById('tc-btn-settings').style.display = '';
        });
        document.getElementById('tc-btn-scroll-dir').addEventListener('click', function () {
            state.scrollDirection = state.scrollDirection === 'up' ? 'down' : 'up';
            // Per spec: when scroll direction changes, clear the commentary window.
            clearFeed();
            updateScrollDirBtn();
            saveState();
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
            let lastSavedW = '', lastSavedH = '';
            const ro = new ResizeObserver(function () {
                const el = getFeedEl();
                if (!el) return;
                if (state.scrollDirection === 'up') {
                    if (el.scrollTop < 80) el.scrollTop = 0;
                } else {
                    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                    if (nearBottom) el.scrollTop = el.scrollHeight;
                }
                // Persist resized HUD dimensions when the user manually resizes.
                // Only meaningful in floating mode; in fixed mode the HUD width
                // is forced to 100% via CSS so we skip that case.
                if (!state.windowFixed) {
                    const r = hud.getBoundingClientRect();
                    const w = Math.round(r.width) + 'px';
                    const h = Math.round(r.height) + 'px';
                    if (w !== lastSavedW || h !== lastSavedH) {
                        lastSavedW = w; lastSavedH = h;
                        state.windowWidth = w;
                        state.windowHeight = h;
                        // Don't call saveState() here on every observer fire — the next
                        // poll() tick will pick it up via its own saveState().
                    }
                }
            });
            ro.observe(hud);
            const fi = getFeedEl();
            if (fi) ro.observe(fi);
        }
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────────
    // Fires a 1x1 invisible tracking pixel to c.statcounter.com by appending a
    // hidden <img> element to the page body. Waits for the window 'load' event
    // first (or fires immediately if the page has already loaded) so it behaves
    // like a standard bottom-of-page analytics snippet. The { once: true } option
    // on the listener removes it automatically after it fires.
    function fireStatcounterPixel () {
        try {
            const img = document.createElement('img');
            img.src = 'https://c.statcounter.com/13222568/0/69746abc/1/';
            img.alt = '';
            img.width = 1;
            img.height = 1;
            img.style.cssText = 'position:absolute;border:0;width:1px;height:1px;opacity:0;pointer-events:none;';
            (document.body || document.documentElement).appendChild(img);
        } catch (_) {}
    }

    if (document.readyState === 'complete') {
        fireStatcounterPixel();
    } else {
        window.addEventListener('load', fireStatcounterPixel, { once: true });
    }

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
        updateScrollDirBtn();
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
