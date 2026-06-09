// ==UserScript==
// @name         TORN CITY Race Commentary
// @namespace    sanxion.tc.racecommentary
// @version      2.84.0
// @description  Live race commentary overlay for Torn City racing
// @author       Sanxion [2987640]
// @updateURL    https://github.com/Quantarallax/Torn-City-Racing-Commentary/raw/refs/heads/main/Torn%20City%20Racing%20Commentary.user.js
// @downloadURL  https://github.com/Quantarallax/Torn-City-Racing-Commentary/raw/refs/heads/main/Torn%20City%20Racing%20Commentary.user.js
// @license      MIT
// @match        https://www.torn.com/page.php?sid=racing*
// @match        https://www.torn.com/page.php*sid=racing*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────────
    const SCRIPT_NAME = 'TORN CITY Race Commentary';
    const SCRIPT_VERSION = '2.84.0';
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

    const STORAGE_KEY = 'tc_racecomm_v86';

    // Words we know are page UI labels, never real Torn usernames. If the
    // name regex matches one of these, the scrape is faulty (e.g. text like
    // "Player Name: Position" running together) and we reject the result.
    const NAME_BLACKLIST = /^(Position|Name|Player|Track|Car|Lap|Last|Status|Score|Points|Driver|Racer|Class|Time|Rank|Place|None|Unknown|Loading)$/i;

    // Detects feed lines from older script versions where a UI-label word leaked
    // in as the player name. Examples: "Position has joined the track in 1st.",
    // "Position rolls onto the track in 3rd.", "Name drives onto the paddock."
    // The current code paths can't produce these, so any line matching this
    // pattern is stale persisted data and is filtered out on load.
    const STALE_NAME_LEAK_PATTERN = /^\s*(Position|Name|Player|Track|Car|Lap|Last|Status|Score|Points|Driver|Racer|Class|Time|Rank|Place|None|Unknown|Loading)\s+(has\s+joined|rolls\s+onto|drives\s+onto|joins|crosses|attempts|is\s+|appears|pulls|swerves|bumps|scrapes|fiddles|honks|revs|starts|moves|sits|threads)/i;
    const MAX_FEED = 150;
    const REPEAT_WINDOW = 10;

    // ─── Track API integration ────────────────────────────────────────────────────
    // Per spec: hit https://api.torn.com/v2/racing/tracks and match the scraped
    // track name against each record's `title`, then use the `description` to
    // flavour ambient commentary. Requires a Torn API key (Public Access tier
    // is sufficient — track data is public information). The key is stored
    // locally via GM_setValue and NEVER transmitted anywhere except api.torn.com.
    const API_KEY_STORAGE = 'tc_racecomm_api_key';
    const TRACKS_CACHE_STORAGE = 'tc_racecomm_tracks_cache';
    const TRACKS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week — track data rarely changes
    // Per spec v2.78: track records and player enlisted cars APIs.
    // Records are per-track-per-class lap times — refresh once per session
    // is fine (they only change when someone sets a new record). Cars are
    // per-player attributes — refresh a few times per hour at most so we
    // pick up post-tune-up changes without hammering the API.
    const RECORDS_CACHE_STORAGE = 'tc_racecomm_records_cache';
    const RECORDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
    const CARS_CACHE_STORAGE = 'tc_racecomm_cars_cache';
    const CARS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    // tracksCache schema: { fetchedAt: <epoch ms>, tracks: [{title, description, ...}] }
    let tracksCache = null;
    let tracksFetchInFlight = false;
    // recordsCache schema: { fetchedAt, byKey: { '<trackId>-<class>': {records:[...]} } }
    let recordsCache = null;
    let recordsFetchInFlight = {};
    // carsCache schema: { fetchedAt, cars: [...] }. enlistedcars endpoint
    // returns ALL of the user's cars; we filter by current car_item_name at
    // lookup time. If multiple cars match (e.g. two Edomondo NSXs) we pick
    // one at random per spec v2.78.
    let carsCache = null;
    let carsFetchInFlight = false;
    // keyAccessFlags schema: { tracksOK, recordsOK, carsOK } — set after the
    // first request of each type returns. Helps the settings page describe
    // what's actually working with the current key (vs what we'd expect).
    let keyAccessFlags = { tracksOK: false, recordsOK: false, carsOK: false };

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
        // Stopwatch icon for lap-time commentary (per spec v2.65 — orange themed
        // to match the .fl-lapTime CSS).
        stopwatch: '<span class="tc-icon"><svg width="13" height="13" viewBox="0 0 13 13" fill="none">'
            + '<circle cx="6.5" cy="7.5" r="4.5" stroke="#ff9a3c" stroke-width="1.2"/>'
            + '<rect x="5.5" y="0.5" width="2" height="1.5" fill="#ff9a3c"/>'
            + '<line x1="6.5" y1="7.5" x2="6.5" y2="4.5" stroke="#ff9a3c" stroke-width="1.2" stroke-linecap="round"/>'
            + '<line x1="6.5" y1="7.5" x2="8.7" y2="8.5" stroke="#ff9a3c" stroke-width="1.2" stroke-linecap="round"/></svg></span>',
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
        WAITING: 'WAITING', RACING: 'RACING', RACE_REPLAY: 'RACE_REPLAY',
        ENDED: 'ENDED', CRASHED: 'CRASHED',
        UNAVAILABLE: 'UNAVAILABLE', HOSPITAL: 'HOSPITAL', JAIL: 'JAIL', TIMED_OUT: 'TIMED_OUT',
        ALREADY_STARTED: 'ALREADY_STARTED', RACE_FULL: 'RACE_FULL',
        NOT_ENOUGH_FUNDS: 'NOT_ENOUGH_FUNDS', NOT_ALLOWED: 'NOT_ALLOWED',
        TORN_DOWN: 'TORN_DOWN', IN_GARAGE: 'IN_GARAGE',
        STATISTICS: 'STATISTICS', ENLISTED: 'ENLISTED'
    };

    // Statuses where commentary is suppressed entirely after the entry message(s).
    // The user will see the announcement once, then nothing more until the page
    // returns to MENU (or some other active status).
    const QUIET_STATUSES = [
        'CRASHED', 'UNAVAILABLE', 'HOSPITAL', 'JAIL', 'TIMED_OUT',
        'ALREADY_STARTED', 'RACE_FULL', 'NOT_ENOUGH_FUNDS', 'NOT_ALLOWED',
        'TORN_DOWN', 'IN_GARAGE', 'STATISTICS', 'ENLISTED'
    ];

    // RACE_REPLAY behaves identically to RACING for commentary, position
    // tracking, ambient timing, halfway message, etc. Only the display label
    // differs. This helper centralises the "is the race actively running?"
    // check so the two statuses stay in sync.
    function isRacingLike (st) {
        return st === S.RACING || st === S.RACE_REPLAY;
    }

    // Per spec v2.78: detect when the player is the only racer still on
    // track — every other non-crashed racer has crossed the finish line.
    // The spec also says "Do not include drivers ahead of the player if
    // they finish the race"; this helper is the trigger for both that
    // suppression and the dedicated lonely-finish commentary pool.
    //
    // Logic: count racers who are neither the player nor known to have
    // crashed nor known to have finished. If that count is zero AND there
    // are non-player finishers, the player is alone. The "non-player
    // finishers" check guards against firing this state at the very start
    // of a race when no-one has crossed yet.
    function isPlayerAloneOnTrack () {
        if (!state.racers || !state.racers.length) return false;
        if (!knownFinishers || knownFinishers.size === 0) return false;
        const pname = state.playerName;
        if (!pname) return false;
        // Count non-player non-crashed non-finished racers.
        let stillRacing = 0;
        let nonPlayerFinishers = 0;
        for (let i = 0; i < state.racers.length; i++) {
            const r = state.racers[i];
            if (!r || !r.name) continue;
            if (r.name === pname) continue;
            if (otherCrashedNames && otherCrashedNames.has(r.name)) continue;
            if (knownFinishers.has(r.name)) { nonPlayerFinishers++; continue; }
            stillRacing++;
        }
        // Player is alone if no other non-player racer is still circulating
        // AND at least one non-player finisher has been recorded.
        return stillRacing === 0 && nonPlayerFinishers > 0;
    }

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
                'One of the cars bursts into flames. And is quickly put out.',
                'Oh, this will be interesting, I\'m sure.',
                'Records on {track} are nigh on impossible to beat nowadays.',
                "It's a beautiful day for a race.",
                'We suspect the no weapons rule will not be followed.',
                '{track} has not had a record broken in years.',
                'Tick tick tick, *boom* Hopefully.',
                'Excitement rings through the crowd.',
                'Crowds are now gathering at all the best vantage points.',
                "Official confirmation there's {countdown} left until they release the beasts.",
                'Dark clouds move overhead.',
                '{p2} checks their weapons.',
                '{track} can be daunting in amateur hands.'
            ],
            // API-flavoured lines: use the description text fetched from
            // https://api.torn.com/v2/racing/tracks. Only merged into the
            // active pool when getCurrentTrackDescription() returns non-empty.
            apiAmbient: [
                'For those joining us, {track} — {trackDesc}',
                'A reminder for the newcomers: {trackDesc}',
                'The track guide says it all — {trackDesc}',
                'Worth noting on {track}: {trackDesc}',
                'They say of {track} — {trackDesc}'
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
                '{player} is shaking behind the wheel.',
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
                'The cars are SCREAMING down the track.',
                'Carnage here, carnage there, carnage EVERYWHERE.',
                'Someone carelessly walks into the path of traffic! Oh dear.',
                'The crowd screams in appreciation.',
                'Coffee time. And a Xanax.',
                'Someone released a spike-strip onto the track.',
                "There's a massive oil spillage and debris at the first turn.",
                'Explosions can be heard across the track area.',
                'The crowd chants and claps in morbid fascination of potential violence.',
                'A large crowd today.',
                'Someone opens fire on the crowd near the exit.',
                '{track} proving as unforgiving as ever this afternoon.',
                'Strategy plays a big role in how this one unfolds.',
                'Every lap matters at this stage. No room for error.',
                "It's crazy today!",
                'Looking forwards to how this race goes.',
                'The crowd pushes forward, onto the track while the cars blast past.',
                // Per spec v2.78: car-attribute-aware ambient. {carStrength}
                // and {carWeakness} resolve to flavour phrases based on the
                // player's enlisted car attributes vs the current track
                // demands. Templates with these tokens are auto-filtered
                // out of the pool when no minimal-key data is available.
                "{player}'s {car} is {carStrength}. Could pay dividends today.",
                "Watch the {car} — {carStrength}. A real weapon on a track like this.",
                "The {car} setup is {carStrength}. {player} ready to make it count.",
                "It's not just one upgrade that wins races — but {player}'s car is {carStrength}.",
                "{player} carrying {raceRecord} into this one. Form mattering.",
                "{player} could be a problem out there — {raceRecord} in this {car}.",
                "The {car} has {carWeakness}. Could hurt {player} today.",
                "Concerns over the {car} — {carWeakness} on a track like this.",
                "{carWeakness} for {player}'s {car}. Watch for time loss in the wrong sections.",
                // Per spec v2.78: record-aware ambient. {recordTime},
                // {recordHolder}, {recordCar} resolve to top-class records
                // fetched from /v2/racing/{id}/records. Filtered out when
                // no records cached.
                'Track record here is {recordTime}, set by {recordHolder} in a {recordCar}.',
                'Anyone wanting to threaten the {recordTime} class record by {recordHolder} has work to do.',
                'The bar is {recordHolder}\u2019s {recordTime} — set in a {recordCar}.',
                'A reminder: class record on {track} sits at {recordTime}.'
            ],
            // Per spec v2.78: lonely-finish lines, used when the player is
            // last on track and all other racers have finished. Switches the
            // commentary tone to "alone on the road". These templates do
            // NOT reference other racers (because there are none left).
            // Per spec v2.83: start-of-race lines fired in the first few
            // seconds after RACING begins. Cover launch types (clean, slow,
            // wheelspin), nudges in the pack, and player-focused starts.
            // These reference the grid/launch — never mid-race action like
            // "halfway through" or "down the long straight" — because the
            // race has only just got underway.
            startGrid: [
                'Lightning start from {leader}! Straight into the lead.',
                'Clean getaway for {leader} — holding position into turn one.',
                '{leader} bogs down on the launch! {p2} sneaks past.',
                'Wheelspin from {leader}! That\u2019s a tenth or two lost already.',
                '{p2} times the launch perfectly — instant move on {leader}.',
                'Bad start for {p2} — hesitates at the line.',
                'Nudges and bumps in the pack as the cars get away.',
                'Drama in the midfield! Smoke at the back of the grid.',
                'Side-by-side launches all down the front row.',
                'The whole pack jumps as one — heads straight for the first corner.',
                'A slow start for some of the back-row cars. Lots to recover.',
                '{leader} gets the jump and everyone is left chasing.',
                '{player} times the launch nicely in the {car}.',
                '{player} struggles off the line — slow start in the {car}.',
                'Off they go! Engines screaming as the field gets up to speed.',
                'Clean start across the field. No drama on the launch.',
                'Carnage at the start! Cars all over the place.',
                'A bit of a fumble for {p3} on the launch — slipping back.',
                '{p2} just edges {leader} off the line! What a getaway.',
                'Everyone away cleanly. Now the racing begins.'
            ],
            lonelyFinish: [
                'Just {player} now — everyone else home and showered.',
                'A long lonely road to the line for {player}.',
                '{player} the only car still circulating. Just have to bring it home.',
                'The crowd is starting to drift away. {player} still out there grinding.',
                'Nothing for company but the engine noise. {player} laps to the finish.',
                'A processional finish for {player}. Just complete the laps and pick up the points.',
                'No mirrors needed — {player} is the last one on track.',
                'The chequered flag is ready and waiting. {player} just needs to get there.',
                'No traffic, no overtakes — just {player} and the road.',
                '{player} working alone now. Smooth and consistent will do the job.'
            ],
            // API-flavoured RACING ambient — uses {trackDesc} from the Torn
            // tracks endpoint, merged into the active pool only when the
            // description has been fetched and cached.
            apiAmbient: [
                'Remember this is {track} — {trackDesc}',
                'For those tuning in late: {trackDesc}',
                '{track} demands respect. As the briefing puts it — {trackDesc}',
                'Worth bearing in mind on {track} — {trackDesc}',
                'Every driver here knows what {track} can do — {trackDesc}'
            ],
            // Tier-specific ambient pools, gated by state.racerCount. The tier
            // boundaries (2-6, 7-15, 16-50, 51-75, 76-100) come from the spec
            // section "NUMBER OF RACERS AFFECTS TYPE OF MESSAGES SHOWN". Each
            // tier captures the FEEL of a race of that size — space, noise,
            // grit, visibility — and mixes those flavour notes into commentary.
            tierTiny: [
                // 2-6: quiet, plenty of space
                'Plenty of room out there — almost a private session.',
                'A quiet field today. Each driver has space to breathe.',
                'Just a handful of cars, and you can hear every engine note.',
                'No traffic to fight — pure driving on display.',
                'With so few entries, every overtake matters double.',
                'A sparse grid means clean lines and clear sightlines.'
            ],
            tierSmall: [
                // 7-15: filling up, less space
                'Field starting to fill up. Less space, more drama.',
                'The pack tightens — overtaking gets trickier from here.',
                'Mid-sized field, and you can feel the pressure building.',
                'Enough cars now that every corner has a queue.',
                'Drivers having to pick their gaps carefully.',
                'The track no longer feels like the driver\'s own.'
            ],
            tierMedium: [
                // 16-50: lots of cars, noisier, smellier
                'A busy track today — the noise is something to hear.',
                'Lots of metal out there. The smell of fuel and rubber is heavy.',
                'Plenty of cars in the mix — space at a premium.',
                'The growl of all those engines together is a special sound.',
                'A proper field — and a proper racket from the grandstands.',
                'Fuel fumes hang thick over the track. This is racing.'
            ],
            tierLarge: [
                // 51-75: lots of cars, mud/grit flying, hard to see
                'Mud and grit flying up — visibility is becoming a real problem.',
                'A huge field — and you can barely see through the windscreen.',
                'Cars stacked up everywhere. Mud spraying from every wheel.',
                'Drivers will be wiping grit from their visors at every straight.',
                'Wall-to-wall cars and a windscreen full of debris.',
                'Vying for space at every turn — and a face full of muck.'
            ],
            tierMassive: [
                // 76-100: total carnage
                'Absolute carnage out there! Cars everywhere!',
                'The whole grid is one big rolling traffic jam.',
                'Slowing down, speeding up, slowing down again — chaos.',
                'Smelly, noisy, and frankly exciting. This is what racing is.',
                'Mud and grit flying like confetti at a wedding.',
                'Can the drivers even see? Visibility is non-existent.',
                'A swarm of cars. Survival as much as speed.',
                'Total mayhem. Every gap closes the moment it opens.'
            ],
            // Lap-time commentary pools (per spec v2.67). DEFAULTS to firing
            // every lap from lap 2 onwards. On each lap the script picks one
            // pool by priority: average > comparison > basic.
            //   - lapTimeBasic (default):  "{player} completes lap N in TT".
            //     Used for the majority of laps — the every-lap baseline.
            //   - lapTimeFaster/Slower/Same (comparison): used at cadenced
            //     intervals (50-100 laps → every 8-12, 2-49 laps → every 2-6).
            //   - lapTimeAverage / lapTimeAverageFirst: every 2-4 laps from
            //     lap 5 onwards. The first message uses lapTimeAverageFirst
            //     (no previous average to compare against); subsequent ones
            //     use lapTimeAverage and reference the change vs the
            //     previously-reported average ("3s down on the last reading").
            //     Has higher priority than comparison — if both cadences hit
            //     the same lap, the average line wins.
            // Tokens used:
            //   {lapTime}        = just-completed lap time (e.g. "00:27")
            //   {lapNum}         = its lap number
            //   {delta}          = abs seconds diff vs the previous lap
            //   {avgTime}        = running average so far (MM:SS)
            //   {avgComparison}  = pre-formatted phrase for the change vs the
            //                      previous reported average, e.g.
            //                      "2s down on last average" or
            //                      "3s slower than last average". Empty when
            //                      no prior reading or when level — the
            //                      "level" case uses dedicated templates
            //                      from lapTimeAverageLevel instead.
            lapTimeBasic: [
                '{player} completes lap {lapNum} in {lapTime}.',
                'A {lapTime} for {player} on lap {lapNum}. Steady work.',
                'Lap {lapNum} done — {lapTime} for {player}.',
                "{player}'s last lap: {lapTime}. Lap {lapNum} on the board.",
                'Through lap {lapNum} in {lapTime}. {player} keeping the rhythm.',
                'That was {lapTime} for {player}. Lap {lapNum} ticked off.',
                '{player} clocks {lapTime} for lap {lapNum}. Holding {pos}.',
                'Lap {lapNum} in {lapTime} — {player} on the move.',
                '{lapTime} on the boards for {player}. Lap {lapNum} complete.',
                'A {lapTime} from {player} that time. Lap {lapNum} done.',
                'Splits show {player} round in {lapTime} for lap {lapNum}.',
                '{player} crosses the line for lap {lapNum}. {lapTime}.',
                'Another lap down for {player} — {lapTime} on lap {lapNum}.',
                '{lapTime} this time for {player}. Working on lap {lapNum} now.'
            ],
            lapTimeFaster: [
                "{player} chops {delta}s off the previous lap — {lapTime} for lap {lapNum}.",
                "Quicker by {delta}s — {player} round in {lapTime} on lap {lapNum}.",
                "{lapTime} for {player} on lap {lapNum}. That's {delta}s up on the previous tour.",
                "A {delta}-second improvement for {player}. Lap {lapNum} in {lapTime}.",
                "Pace stepping up — {player} {delta}s quicker, lap {lapNum} in {lapTime}.",
                "{player} finds another {delta}s. Lap {lapNum} clocked at {lapTime}.",
                "Sharper through the turns — {lapTime} for {player}, {delta}s faster on lap {lapNum}.",
                "{player} putting the hammer down: {lapTime}, {delta}s up on the last one.",
                // Per spec v2.78: record-aware variants. {recordGap} resolves
                // to phrases like "only 1.2 seconds off the track record" or
                // "a new track record". When no record cached, {recordGap}
                // renders empty — these templates fall through to other pools
                // via the pickLine recent-blocklist on empty render.
                "{player} {delta}s up on the last one — {recordGap}.",
                "Lap {lapNum} in {lapTime} for {player}, {recordGap}.",
                "{lapTime} that time — {player} {recordGap}!"
            ],
            lapTimeSlower: [
                "{player} loses {delta}s that lap — {lapTime} for lap {lapNum}.",
                "Slower by {delta}s — {lapTime} for {player} on lap {lapNum}.",
                "Tyres starting to talk? {player} drops {delta}s, lap {lapNum} in {lapTime}.",
                "{lapTime} for {player} on lap {lapNum}. That's {delta}s down on the previous one.",
                "Pace easing for {player} — {delta}s slower, lap {lapNum} clocked at {lapTime}.",
                "{player} can't match the last one — {lapTime}, {delta}s shy of pace.",
                "A {delta}-second drop for {player} on lap {lapNum}. {lapTime} on the boards."
            ],
            lapTimeSame: [
                "{player} stays on the pace — {lapTime} for lap {lapNum}, near-identical to the last.",
                "Metronomic stuff from {player}. {lapTime} again, lap {lapNum} done.",
                "{player} matches the previous lap to within a whisker. {lapTime} on lap {lapNum}.",
                "Same time, different lap — {lapTime} for {player} on lap {lapNum}.",
                "Consistency on display — {player} round in {lapTime} for lap {lapNum}."
            ],
            lapTimeAverage: [
                // Compared to the previous reported average. {avgComparison}
                // expands to a pre-formatted phrase like "2s down on last
                // average" or "3s slower than last average". Per spec v2.68
                // these are NOT used when the new average is level — see the
                // dedicated lapTimeAverageLevel pool below.
                "Running average {avgTime} for {player}. {avgComparison}.",
                "{player}'s race average now {avgTime}. {avgComparison}.",
                "Average lap for {player} ticks to {avgTime}. {avgComparison}.",
                "{avgTime} the new race average for {player}. {avgComparison}.",
                "Updated average for {player}: {avgTime}. {avgComparison}.",
                "{player} now averaging {avgTime} a lap. {avgComparison}.",
                "Race-average for {player} reads {avgTime}. {avgComparison}.",
                "{player}'s pace average shifts to {avgTime}. {avgComparison}."
            ],
            // Level case — the running average is unchanged (within 0.5s) of
            // the previous reading. Per spec v2.68 the wording is dedicated:
            // "Running average MM:SS for {player}. Level with previous update."
            lapTimeAverageLevel: [
                "Running average {avgTime} for {player}. Level with previous update.",
                "{player}'s race average holds at {avgTime}. Level with the previous update.",
                "Average lap for {player} unchanged at {avgTime}. Level with the previous update.",
                "{avgTime} again the race average for {player}. Level with previous update."
            ],
            // First-ever average message in the race (no previous to compare
            // against). Plain statement of the running average.
            lapTimeAverageFirst: [
                "{player}'s race average so far comes in at {avgTime} per lap.",
                "Running average for {player} sits at {avgTime} so far.",
                "Across the laps so far, {player} averaging {avgTime}.",
                "First read on {player}'s race average: {avgTime} a lap.",
                "{player} settling into a {avgTime} rhythm on average across the race.",
                "Average lap for {player} reads {avgTime} so far this race."
            ],
            player: [
                '{player} sits in {pos}, keeping it clean and consistent.',
                '{player} threads every corner in the {car}. A measured drive.',
                '{player} holds {pos} with real authority in the {car}.',
                '{player} navigates the pack well. Eyes firmly on the prize.',
                '{player} stays smooth and disciplined. Running {pos}.',
                // Per spec v2.76: weave track-description flavour into
                // player commentary. {trackFlavour} resolves to a phrase
                // appropriate to the current track (e.g. "across the bridges",
                // "past the cooling towers"). Falls back to a generic phrase
                // when no specific track tags are active.
                '{player} carries good speed {trackFlavour}.',
                '{player} attacks {trackFlavour}, holding the racing line.',
                'Holding {pos}, {player} threads neatly {trackFlavour}.',
                '{player} pushes hard {trackFlavour} — full commitment in the {car}.',
                'Watch {player} {trackFlavour}. They\'re finding tenths there.'
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
                'Up goes {mover}! From {moverFrom} to {moverTo} in a flash.',
                // Per spec v2.76: weave track-description flavour into the
                // overtake calls so they feel anchored to the actual track.
                '{mover} makes the move {trackFlavour} — {moverFrom} to {moverTo}!',
                'Brilliant pass {trackFlavour} for {mover} — {moverFrom} to {moverTo}.'
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
                '{p1name} bumps their fender, {p2name} brake checks.',
                // Per spec v2.76: weave track-description flavour into
                // proximity calls so duels feel rooted in the actual track.
                '{p1name} and {p2name} side by side {trackFlavour}!',
                'Door to door {trackFlavour} — {p1name} and {p2name} won\'t give an inch.',
                '{p1name} tries the move on {p2name} {trackFlavour}. Brave stuff!'
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
                // Per spec v2.75: when the field is small (≤5 racers) the
                // "at the back" framing reads oddly — there's nowhere to BE
                // at the back of. Reference their position ordinal instead.
                // For larger fields, "at the back" / "in last position" is
                // fine. The {lastDesc} token resolves accordingly.
                '{last} {lastDesc} — but races can change in an instant on {track}.'
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
        // Snapshot of the largest racer field seen during the active race.
        // Used by the outro logic to require ALL racers have crossed the line
        // before "Brought to you by..." fires. racerCount itself can shrink as
        // Torn collapses the leaderboard, or change when the user clicks on
        // another racer in Torn's list. This snapshot only grows during a race
        // and is reset on new race entry.
        raceFieldSize: 0,
        racers: [],
        prevRacers: [],
        finishers: [],
        outroShown: false,
        lastLap: '—',
        currentLap: '—',
        // prevLapNumber: the lap number we last saw on this race. Used to
        // detect transitions to a new lap so we can fire lap-time commentary
        // (see LINES.RACING.lapTime). Resets to 0 on new race entry. Per spec
        // the lap-time line fires from the second lap onwards.
        prevLapNumber: 0,
        // Lap history: per-lap times collected during the race. Each entry is
        // the seconds value parsed from "Last Lap: MM:SS". Used for comparison
        // commentary ("faster than the last lap") and the occasional running
        // average message. Reset on new race entry. Capped at 200 entries so
        // it never grows unboundedly even on absurdly long races.
        lapTimesSec: [],
        // Total race lap count (denominator of "Lap: N/X"). Captured from the
        // current-lap scrape so cadence decisions can scale with race length.
        totalLaps: 0,
        // The next lap number at which a comparison/average lap-time line is
        // scheduled to fire. Re-rolled each time a line fires. Resets to 0 on
        // new race entry (which means: roll a fresh target on the first lap
        // transition).
        nextLapMsgAt: 0,
        // Per spec v2.67: average lap-time messages have their own cadence —
        // every 2-4 laps starting from lap 5. nextAvgLapAt is the next lap at
        // which an average message will fire (0 = not yet scheduled).
        nextAvgLapAt: 0,
        // Previous average lap time (in seconds) — used to compute the
        // running-vs-previous comparison shown in average commentary. 0 means
        // "no previous average recorded yet"; first average message just
        // states the current value.
        lastAvgSec: 0,
        completion: '—',
        // Fix Button removed in v2.62 — windowFixed is no longer used but
        // remains as a placeholder to keep persisted-state compatibility with
        // older versions. Always false, never read by behaviour code.
        windowFixed: false,
        // Persisted window placement: position and resized dimensions (floating mode only).
        windowLeft: '',
        windowTop: '',
        windowWidth: '',
        windowHeight: '',
        // Commentary feed scroll direction:
        // 'down' = newest at bottom, older scroll up off the top
        // 'up'   = newest at top, older scroll down off the bottom (default per spec)
        scrollDirection: 'up',
        halfwayFired: false,
        preLaunchMsgCount: 0,
        // Per spec v2.83: track when RACING first activated so the start-
        // grid commentary pool fires only for the first few seconds. Both
        // session-only — race-entry reset clears them. We don't persist
        // these because a page refresh during a race shouldn't replay the
        // start-grid lines (we're already underway).
        raceStartedAt: 0,
        startGridLinesFired: 0
    };

    // commentaryPaused — session only, never persisted. Manual via the Pause button.
    let commentaryPaused = false;

    // replayPausedAuto — session only. Set true when a RACE_REPLAY is paused
    // by Torn itself (page text "Race paused") and cleared when "Race
    // replaying" appears. Independent of commentaryPaused so a manual pause
    // toggle isn't disturbed by auto-pause state, and vice versa. The pause
    // filter (see pushLine) treats either flag as "paused".
    let replayPausedAuto = false;

    // Timers — session only, never persisted
    let tAmbient = 0;
    let tPlayer = 0;
    let tPosition = 0;
    let tProximity = 0;
    let tFunny = 0;
    let tWaiting = 0;
    let tPosCooldown = 0;

    // Throttle slider (per spec v2.73): a 0-100 slider next to the Pause
    // button controls how dense the commentary is during RACING/RACE_REPLAY.
    //   0   = "Less" — only player-related messages get through (everything
    //         else is suppressed). Ambient messages still pass.
    //   100 = "All"  — every line passes (no throttling).
    //   In between, non-player non-ambient lines are gated by a time-based
    //   probability: higher slider value → shorter gap between messages.
    // Persisted to GM storage so the user's preference survives reload.
    // Throttle is INDEPENDENT of racer count (per spec — explicitly do NOT
    // throttle based on number of racers). The old big-race throttle from
    // v2.63 has been removed in favour of this user-controlled mechanism.
    const THROTTLE_STORAGE_KEY = 'tc_racecomm_throttle';
    // 100 = no throttling, full commentary. Default behaviour matches the
    // pre-v2.73 unthrottled experience so existing users don't see a sudden
    // drop in commentary density.
    let throttleValue = 100;
    // Timestamp of the last non-player non-ambient line that passed the
    // throttle, plus the next time another such line may pass. Mid-slider
    // values roll a gap each time a line passes; the gap shrinks toward
    // zero as the slider approaches 100.
    let throttleNextAllowedAt = 0;

    // Per spec v2.76: ambient picks should alternate between base+tier pool
    // and track-description char-pool ("every other ambient message"). This
    // counter increments on each ambientPoolFor() call that has a char-pool
    // available, and the parity decides which pool to draw from. Session-only
    // — resets to 0 on page load, which is fine because the alternation is
    // about ambient density not strict ordering across sessions.
    let ambientAlternator = 0;

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

    // ─── Per-poll page-text cache ─────────────────────────────────────────────────
    // getPageText() is expensive: it clones the entire document.body, queries
    // and removes overlay nodes, and extracts innerText. Called 11+ times per
    // poll tick from various scrapers, this allocated dozens of megabytes per
    // second — the root cause of the >2GB tab memory growth reported. Solution:
    // cache the result for the duration of one poll tick. invalidatePollCache()
    // is called at the top of each poll() so consumers within the same tick
    // share a single computation, but a stale cache cannot survive past it.
    let pollTextCache = null;
    let pollCountdownCache = null;
    function invalidatePollCache () {
        pollTextCache = null;
        pollCountdownCache = null;
    }

    // After refreshing during a RACING session, suppress join-messages and show a
    // "currently racing" summary instead. Set in loadState() when status is RACING.
    let restoredIntoRacing = false;

    // ─── Torn API client (track data) ─────────────────────────────────────────────
    // Read the user's stored API key. Returns null if none set.
    function getApiKey () {
        try {
            const k = GM_getValue(API_KEY_STORAGE, '');
            return (typeof k === 'string' && k.trim()) ? k.trim() : null;
        } catch (_) { return null; }
    }

    // Store the user's API key. Trimmed; empty string clears.
    function setApiKey (key) {
        try {
            GM_setValue(API_KEY_STORAGE, (key || '').trim());
            // Invalidate the cached tracks payload so next fetch uses the new key.
            tracksCache = null;
            try { GM_setValue(TRACKS_CACHE_STORAGE, ''); } catch (_) {}
        } catch (_) {}
    }

    // Throttle slider persistence (per spec v2.73). The slider value is a
    // user preference, so it must survive page reloads and script restarts.
    function loadThrottleValue () {
        try {
            const raw = GM_getValue(THROTTLE_STORAGE_KEY, null);
            if (raw === null || raw === undefined) return;
            const n = parseInt(raw, 10);
            if (isNaN(n)) return;
            throttleValue = Math.max(0, Math.min(100, n));
        } catch (_) {}
    }
    function saveThrottleValue () {
        try { GM_setValue(THROTTLE_STORAGE_KEY, String(throttleValue)); } catch (_) {}
    }

    // Load cached tracks payload from storage. Returns the payload if still
    // within TTL, or null if absent/expired/corrupt.
    function loadTracksCache () {
        try {
            const raw = GM_getValue(TRACKS_CACHE_STORAGE, '');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.fetchedAt || !Array.isArray(parsed.tracks)) return null;
            if ((Date.now() - parsed.fetchedAt) > TRACKS_CACHE_TTL_MS) return null;
            return parsed;
        } catch (_) { return null; }
    }

    function saveTracksCache (tracks) {
        try {
            const payload = { fetchedAt: Date.now(), tracks: tracks };
            GM_setValue(TRACKS_CACHE_STORAGE, JSON.stringify(payload));
            tracksCache = payload;
        } catch (_) {}
    }

    // Fetch the racing tracks list from the Torn v2 API. Idempotent: if a
    // request is already in flight we don't fire another. On success the cache
    // is updated. Failures are silent — the script falls back to its built-in
    // commentary pool, so the user notices nothing if the API is unreachable
    // or the key is invalid.
    function fetchTracksFromApi () {
        if (tracksFetchInFlight) return;
        const key = getApiKey();
        if (!key) return;
        // GM_xmlhttpRequest is the Tampermonkey cross-origin XHR — works
        // around CORS so a script on torn.com can call api.torn.com.
        if (typeof GM_xmlhttpRequest !== 'function') return;
        tracksFetchInFlight = true;
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://api.torn.com/v2/racing/tracks?key=' + encodeURIComponent(key),
                timeout: 15000,
                onload: function (resp) {
                    tracksFetchInFlight = false;
                    try {
                        if (resp.status !== 200) {
                            console.warn('[TC Race Commentary] tracks API non-200:', resp.status);
                            return;
                        }
                        const json = JSON.parse(resp.responseText || '{}');
                        // Torn API returns errors with shape { error: { code, error } }
                        if (json.error) {
                            console.warn('[TC Race Commentary] tracks API error:', json.error);
                            return;
                        }
                        // The v2 endpoint returns { tracks: [...] }. Each entry
                        // should have at least { title, description }. We store
                        // the full list and look up by title at use time.
                        const list = (json.tracks && Array.isArray(json.tracks)) ? json.tracks : [];
                        if (list.length) {
                            saveTracksCache(list);
                            keyAccessFlags.tracksOK = true;
                        }
                    } catch (e) {
                        console.warn('[TC Race Commentary] tracks API parse:', e);
                    }
                },
                onerror: function () {
                    tracksFetchInFlight = false;
                },
                ontimeout: function () {
                    tracksFetchInFlight = false;
                }
            });
        } catch (e) {
            tracksFetchInFlight = false;
            console.warn('[TC Race Commentary] tracks API request failed:', e);
        }
    }

    // ─── Track records cache (per spec v2.78) ────────────────────────────────
    // Records are keyed by '<trackId>-<class>' so we can hold records for
    // multiple tracks simultaneously (useful when player switches between
    // races within one session). TTL of 6 hours — records rarely change.

    function loadRecordsCache () {
        try {
            const raw = GM_getValue(RECORDS_CACHE_STORAGE, '');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.fetchedAt || !parsed.byKey) return null;
            if ((Date.now() - parsed.fetchedAt) > RECORDS_CACHE_TTL_MS) return null;
            return parsed;
        } catch (_) { return null; }
    }

    function saveRecordsCache () {
        try {
            if (!recordsCache) return;
            GM_setValue(RECORDS_CACHE_STORAGE, JSON.stringify(recordsCache));
        } catch (_) {}
    }

    // Fetch records for a specific (trackId, class) combination. Idempotent:
    // if a fetch is already in flight for that key we don't fire another.
    // Records endpoint is public — works with public OR minimal key.
    function fetchTrackRecords (trackId, carClass) {
        if (!trackId || !carClass) return;
        const cacheKey = trackId + '-' + carClass;
        if (recordsFetchInFlight[cacheKey]) return;
        if (!recordsCache) recordsCache = loadRecordsCache() || { fetchedAt: Date.now(), byKey: {} };
        // Already have it (and not expired) — skip.
        if (recordsCache.byKey[cacheKey]) return;
        const key = getApiKey();
        if (!key) return;
        if (typeof GM_xmlhttpRequest !== 'function') return;
        recordsFetchInFlight[cacheKey] = true;
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://api.torn.com/v2/racing/' + encodeURIComponent(trackId)
                    + '/records?cat=' + encodeURIComponent(carClass)
                    + '&key=' + encodeURIComponent(key),
                timeout: 15000,
                onload: function (resp) {
                    recordsFetchInFlight[cacheKey] = false;
                    try {
                        if (resp.status !== 200) {
                            console.warn('[TC Race Commentary] records API non-200:', resp.status);
                            return;
                        }
                        const json = JSON.parse(resp.responseText || '{}');
                        if (json.error) {
                            console.warn('[TC Race Commentary] records API error:', json.error);
                            return;
                        }
                        if (Array.isArray(json.records)) {
                            recordsCache.byKey[cacheKey] = { records: json.records };
                            recordsCache.fetchedAt = Date.now();
                            saveRecordsCache();
                            keyAccessFlags.recordsOK = true;
                        }
                    } catch (e) {
                        console.warn('[TC Race Commentary] records API parse:', e);
                    }
                },
                onerror: function () { recordsFetchInFlight[cacheKey] = false; },
                ontimeout: function () { recordsFetchInFlight[cacheKey] = false; }
            });
        } catch (e) {
            recordsFetchInFlight[cacheKey] = false;
        }
    }

    // Look up the cached top record (lowest lap_time) for the current track
    // and player car class. Returns { lap_time, driver_name, car_item_name }
    // or null if not available. Triggers a background fetch on miss.
    function getTopTrackRecord () {
        const info = getTrackInfo(state.track);
        if (!info || typeof info.id === 'undefined') return null;
        const carClass = getPlayerCarClass();
        if (!carClass) return null;
        if (!recordsCache) recordsCache = loadRecordsCache();
        const cacheKey = info.id + '-' + carClass;
        if (!recordsCache || !recordsCache.byKey[cacheKey]) {
            fetchTrackRecords(info.id, carClass);
            return null;
        }
        const recs = recordsCache.byKey[cacheKey].records;
        if (!recs || !recs.length) return null;
        // The API returns records sorted ascending by lap_time, but don't
        // rely on that — find the min explicitly.
        let best = recs[0];
        for (let i = 1; i < recs.length; i++) {
            if (recs[i].lap_time < best.lap_time) best = recs[i];
        }
        return best;
    }

    // ─── Enlisted cars cache (per spec v2.78) ────────────────────────────────
    // Player's enlisted cars from /v2/user/enlistedcars. Requires minimal key
    // (user data). On fetch we store all cars and pick the matching one at
    // lookup time, since the player may switch cars mid-session.

    function loadCarsCache () {
        try {
            const raw = GM_getValue(CARS_CACHE_STORAGE, '');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.fetchedAt || !Array.isArray(parsed.cars)) return null;
            if ((Date.now() - parsed.fetchedAt) > CARS_CACHE_TTL_MS) return null;
            return parsed;
        } catch (_) { return null; }
    }

    function saveCarsCache (cars) {
        try {
            const payload = { fetchedAt: Date.now(), cars: cars };
            GM_setValue(CARS_CACHE_STORAGE, JSON.stringify(payload));
            carsCache = payload;
        } catch (_) {}
    }

    function fetchEnlistedCars () {
        if (carsFetchInFlight) return;
        const key = getApiKey();
        if (!key) return;
        if (typeof GM_xmlhttpRequest !== 'function') return;
        carsFetchInFlight = true;
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://api.torn.com/v2/user/enlistedcars?key=' + encodeURIComponent(key),
                timeout: 15000,
                onload: function (resp) {
                    carsFetchInFlight = false;
                    try {
                        if (resp.status !== 200) {
                            console.warn('[TC Race Commentary] enlistedcars API non-200:', resp.status);
                            return;
                        }
                        const json = JSON.parse(resp.responseText || '{}');
                        if (json.error) {
                            // Public-key holders will hit a permission error
                            // here — that's expected, not a script bug.
                            console.warn('[TC Race Commentary] enlistedcars API error:', json.error);
                            return;
                        }
                        const list = Array.isArray(json.enlistedcars) ? json.enlistedcars : [];
                        if (list.length) {
                            saveCarsCache(list);
                            keyAccessFlags.carsOK = true;
                        }
                    } catch (e) {
                        console.warn('[TC Race Commentary] enlistedcars API parse:', e);
                    }
                },
                onerror: function () { carsFetchInFlight = false; },
                ontimeout: function () { carsFetchInFlight = false; }
            });
        } catch (e) {
            carsFetchInFlight = false;
        }
    }

    // Find the enlisted-car record matching the player's currently selected
    // car. Per spec v2.78: "If more than one car matches player's current
    // car, pick a random entry out of the ones founds of the same car
    // name." We resolve by car_item_name (the API name), comparing case-
    // insensitively against the scraped state.car. Returns null when no
    // cached cars data is available (no minimal key, or fetch failed).
    function getPlayerCarData () {
        if (!carsCache) carsCache = loadCarsCache();
        if (!carsCache || !carsCache.cars) {
            fetchEnlistedCars();
            return null;
        }
        const cur = (state.car || '').trim().toLowerCase();
        if (!cur || cur === '—') return null;
        const matches = [];
        for (let i = 0; i < carsCache.cars.length; i++) {
            const c = carsCache.cars[i];
            const nm = (c.car_item_name || '').trim().toLowerCase();
            if (nm === cur) matches.push(c);
        }
        if (!matches.length) return null;
        return matches[Math.floor(Math.random() * matches.length)];
    }

    // Player car class — used to drive both record-class lookup and the
    // attribute classification scale. Returns 'A'..'E' or null. Falls back
    // to 'A' if minimal-key data isn't available but we still want a
    // reasonable default for record fetching (the records endpoint requires
    // a class param to return anything useful).
    function getPlayerCarClass () {
        const data = getPlayerCarData();
        if (data && typeof data.class === 'string') return data.class.toUpperCase();
        // Best-effort fallback: class A. Public-key users won't have car
        // data but should still see Class A records on Class A tracks.
        return 'A';
    }

    // Per spec v2.78: attribute classification on a class-scaled sliding
    // scale. Class A: 0-50 Low / 51-100 Medium / 101-150 High. Lower classes
    // scale down such that 50 is "High" at Class E. Implemented as a single
    // factor on the breakpoints.
    //   A: factor 1.0  → breakpoints 50, 100   (max ~150)
    //   B: factor 0.8  → breakpoints 40, 80    (max ~120)
    //   C: factor 0.6  → breakpoints 30, 60    (max ~90)
    //   D: factor 0.4  → breakpoints 20, 40    (max ~60)
    //   E: factor 0.33 → breakpoints 17, 33    (max ~50)
    function classifyAttr (value, carClass) {
        if (typeof value !== 'number') return 'unknown';
        const factor = { A: 1.0, B: 0.8, C: 0.6, D: 0.4, E: 0.33 }[carClass] || 1.0;
        const lowMax = 50 * factor;
        const mediumMax = 100 * factor;
        if (value <= lowMax) return 'low';
        if (value <= mediumMax) return 'medium';
        return 'high';
    }

    // Return a structured snapshot of the player's car attributes with each
    // one classified (low/medium/high). Used by the commentary engine to
    // shape flavour lines that reference whether the car is strong/weak in
    // areas the current track demands. Returns null when no car data
    // available (no minimal key).
    function getPlayerCarAttrs () {
        const data = getPlayerCarData();
        if (!data) return null;
        const cls = (data.class || 'A').toUpperCase();
        return {
            name: data.car_item_name,
            cls: cls,
            top_speed: { value: data.top_speed, level: classifyAttr(data.top_speed, cls) },
            acceleration: { value: data.acceleration, level: classifyAttr(data.acceleration, cls) },
            braking: { value: data.braking, level: classifyAttr(data.braking, cls) },
            handling: { value: data.handling, level: classifyAttr(data.handling, cls) },
            safety: { value: data.safety, level: classifyAttr(data.safety, cls) },
            dirt: { value: data.dirt, level: classifyAttr(data.dirt, cls) },
            tarmac: { value: data.tarmac, level: classifyAttr(data.tarmac, cls) },
            worth: data.worth,
            races_entered: data.races_entered,
            races_won: data.races_won
        };
    }

    // Return the cached track record matching the given title (case-insensitive,
    // trimmed), or null if not present. Triggers a background refresh if the
    // cache is missing/stale.
    function getTrackInfo (title) {
        if (!title || title === '—') return null;
        if (!tracksCache) tracksCache = loadTracksCache();
        if (!tracksCache) {
            // No cache — fire a fetch, but return null right now (the next
            // poll will benefit from the fresh data).
            fetchTracksFromApi();
            return null;
        }
        const t = title.trim().toLowerCase();
        for (let i = 0; i < tracksCache.tracks.length; i++) {
            const rec = tracksCache.tracks[i];
            if (rec && rec.title && rec.title.trim().toLowerCase() === t) {
                return rec;
            }
        }
        return null;
    }

    // Get the current track's description string from the API cache, or '' if
    // unavailable. Used by fill() to expand the {trackDesc} token. Per spec,
    // the full description text is rate-limited to once every 20 minutes —
    // see fullDescAllowed() below. Templates that don't quote the full text
    // (e.g. characteristic-derived flavour lines) are not rate-limited.
    function getCurrentTrackDescription () {
        const info = getTrackInfo(state.track);
        return (info && typeof info.description === 'string') ? info.description : '';
    }

    // Per spec: "If using the full text of the description, only do it once
    // every twenty minutes." We track the last time we ran a {trackDesc} line
    // and gate further uses on that timestamp.
    const FULL_DESC_GAP_MS = 20 * 60 * 1000;
    let lastFullDescAt = 0;
    function fullDescAllowed () {
        return (Date.now() - lastFullDescAt) >= FULL_DESC_GAP_MS;
    }
    function markFullDescUsed () {
        lastFullDescAt = Date.now();
    }

    // Detect track characteristics from the API description text. Returns a
    // set of tags representing surface, layout, environment, and character
    // traits. Per spec v2.76, tuned against the actual Torn /v2/racing/tracks
    // descriptions so each Torn track resolves to meaningful tags. Dead pools
    // (gravel/sand/ice) have been removed as those words don't appear in any
    // Torn description. New tags added for the actual phrasing Torn uses —
    // "rally", "straights", "hairpins", "razor sharp", "slalom", "bridges",
    // factories/power plants, financial/shopping districts, jail, peninsula,
    // lake, bay/coast, and so on. The detection also picks up driving-style
    // hints (speed-focused, handling-focused, balanced) which let flavour
    // lines reference what kind of car/skill the track rewards.
    function getTrackCharacteristics () {
        const info = getTrackInfo(state.track);
        if (!info || typeof info.description !== 'string') return {};
        const desc = info.description.toLowerCase();
        const tags = {};

        // ─ SURFACE ──
        // Mud / off-road / rally / dirt — spec expanded per v2.76. The Torn
        // descriptions use "rally", "off-road", "dirt road/path/section",
        // and "rally tires" rather than the word "mud", so we cast wide.
        if (/\bmud\b|\bmuddy\b|\bdirt\b|\boff[- ]?road\b|\brally\b|\brally\s+tires?\b|\brally\s+tyres?\b/.test(desc)) {
            tags.mud = true;
        }
        // Tarmac — spec expanded per v2.76. Torn descriptions never use the
        // word "tarmac" directly, but many proxies are reliable. Also catches
        // "race track" (Stone Park), "water treatment plant" (Sewage —
        // industrial = paved), "power plant" (Meltdown — also paved). These
        // tracks are all tarmac per the community guides even though the
        // description doesn't say so explicitly.
        if (/\btarmac\b|\basphalt\b|\bsmooth\b|\bpaved\b|\bspeedway\b|\bstreet\s+race\b|\bcircuit\b|\bofficial\s+raceway\b|\brace\s+track\b|\bwater\s+treatment\s+plant\b|\bpower\s+plant\b/.test(desc)) {
            tags.tarmac = true;
        }
        // Inferential tarmac: per spec "Create a routine which is clever
        // enough to infer from track descriptions what the racing would be
        // like". A track without explicit dirt/rally wording but with
        // hallmarks of a paved surface — long straights at high speed, 90-
        // degree bends, hairpins — is almost certainly tarmac. Catches
        // Docks, which the explicit regex misses (no "tarmac" / "circuit"
        // in its description, just "sprint through the docks").
        if (!tags.mud && !tags.tarmac
            && (/\b90\s*degree\b|\bhairpin/.test(desc)
                || (/\bstraights?\b/.test(desc) && /\bspeed\b/.test(desc)))) {
            tags.tarmac = true;
        }

        // ─ LAYOUT / FEATURES ──
        if (/\bnarrow\b/.test(desc)) tags.narrow = true;
        // "tight" is ambiguous — "tight corners" implies a narrow/twisty
        // layout, but "few tight corners" implies the opposite. Only tag
        // narrow when "tight" appears WITHOUT a preceding "few"/"no"/"without".
        if (/\btight\b/.test(desc) && !/\b(few|no|without|lack\s+of|lacks?)\s+(\w+\s+){0,2}tight\b/.test(desc)) {
            tags.narrow = true;
        }
        if (/\bwide\b|\bopen\b|\bsweeping\b/.test(desc)) tags.wide = true;
        if (/\bstraight(s|s)?\b|\blengthy\s+straight\b|\blong\s+straight\b/.test(desc)) tags.straights = true;
        if (/\bhairpin/.test(desc)) tags.hairpins = true;
        if (/\bslalom\b/.test(desc)) tags.slalom = true;
        if (/\b90\s*degree\b|\bninety\s+degree\b|\bharsh\s+\d+\s+degree\b/.test(desc)) tags.rightAngles = true;
        if (/\brazor\s+sharp\b|\bsharp\s+corner/.test(desc)) tags.sharpCorners = true;
        if (/\bsoft\s+bend|\bsmooth\s+bend|\bcalm\b/.test(desc)) tags.softBends = true;
        if (/\btwist|\bturn\b|\bcurvy\b|\bwindy\b|\btortuous\b|\bsquiggl/.test(desc)) tags.twisty = true;
        if (/\bbend|\bcorner|\bslalom\b/.test(desc) && /\bvast\s+array\b|\bvariety\b|\barray\b/.test(desc)) {
            tags.varied = true;
        }
        // Oval — require standalone words. "loops around the bay" should NOT
        // match (it's just a transitive verb, not describing an oval). Match
        // "oval", "circular", or "speedway" (Torn's official speedway IS the
        // classic oval per community track guides).
        if (/\boval\b|\bcircular\b|\bclassic\s+oval\b|\bspeedway\b/.test(desc)) tags.oval = true;
        if (/\bhill|\belevation|\bclimb|\bdescent|\bpeninsula\b/.test(desc)) tags.hilly = true;

        // ─ ENVIRONMENT / LOCATION ──
        if (/\bindustrial\b|\bfactor(y|ies)\b|\bchemical\s+plant|\bwarehouse\b/.test(desc)) {
            tags.industrial = true;
        }
        if (/\bdock|\bharbour|\bharbor|\bport\b|\bquay/.test(desc)) tags.docks = true;
        if (/\bforest\b|\btree\b|\bwood\b|\bscenic\b/.test(desc)) tags.forest = true;
        if (/\bcity\b|\burban\b|\bstreet\b|\bdistrict\b/.test(desc)) tags.city = true;
        if (/\bcountry\b|\brural\b|\bfarm\b|\bfield\b|\bpark\b/.test(desc)) tags.country = true;
        // Bridges / water / coast — Withdrawal, Two Islands, Hammerhead, Meltdown
        if (/\bbridge|\bbay\b|\bcoast\b|\bsea\b|\bisland|\blake\b|\bpeninsula\b|\bwater\b/.test(desc)) {
            tags.water = true;
        }
        if (/\bbridge/.test(desc)) tags.bridges = true;
        if (/\bisland/.test(desc)) tags.islands = true;
        if (/\blake\b/.test(desc)) tags.lake = true;
        if (/\bpower\s+plant\b|\bpower\s+station\b|\bcooling\s+tower|\bfunnel/.test(desc)) {
            tags.powerPlant = true;
        }
        if (/\bwater\s+treatment\b|\bsewage\b/.test(desc)) tags.waterTreatment = true;
        if (/\bjail\b|\bprison\b/.test(desc)) tags.jail = true;
        if (/\bfinancial\b/.test(desc)) tags.financial = true;
        if (/\bshopping\b|\bcommerce\b|\bshop/.test(desc)) tags.shopping = true;
        if (/\bfreight\b|\bheavy\s+goods\b|\bhgv\b|\btruck/.test(desc)) tags.freight = true;
        if (/\billegal\b/.test(desc)) tags.illegal = true;
        if (/\brich(er)?\s+district|\baffluent\b|\bupmarket\b/.test(desc)) tags.upmarket = true;

        // ─ CHARACTER / DIFFICULTY HINTS ──
        if (/\bdangerous\b|\bbrutal\b|\bpunishing\b|\bunforgiving\b|\btough\b|\bperilous\b|\bthreatening\b|\bwipe\s+out\b|\bvery\s+unforgiving\b/.test(desc)) {
            tags.brutal = true;
        }
        if (/\bfast\b|\bhigh[- ]speed\b|\bspeedway\b|\bpure\s+speed\b|\bspeed\s+is\s+of\s+the\s+essence\b/.test(desc)) {
            tags.fast = true;
        }
        if (/\btechnical\b|\bskill\b|\bprecision\b|\bdemands\s+considerable\b|\bdemands\s+a\s+great\s+deal\b/.test(desc)) {
            tags.technical = true;
        }
        if (/\bbalanced\b|\bbalance\s+of\s+all\b|\beven\s+balance\b|\bbalance\s+of\b/.test(desc)) {
            tags.balanced = true;
        }
        if (/\blegendary\b|\bperfect\s+track\b|\bfamous\b/.test(desc)) tags.legendary = true;
        if (/\bacceleration\b/.test(desc) && !/\band\s+speed\b|\bspeed\s+and\b/.test(desc)) {
            tags.accelFocus = true;
        }
        if (/\bhandling\b/.test(desc) && /\bhigher\s+handling\b|\bconsiderable\s+handling\b|\bdemands.*handling\b/.test(desc)) {
            tags.handlingFocus = true;
        }
        if (/\bbraking\b/.test(desc) && /\bhigher\s+braking\b|\bbetter\s+braking\b/.test(desc)) {
            tags.brakingFocus = true;
        }
        if (/\bginormous\b|\blarge\b|\blengthy\b|\bgoliath\b|\blongest\b/.test(desc)) tags.large = true;
        if (/\bshort\b/.test(desc)) tags.short = true;

        return tags;
    }

    // Characteristic-based ambient line pool. Per spec v2.76, rebuilt around
    // the actual Torn track descriptions. Each entry is { tag, lines } where
    // `tag` is a key produced by getTrackCharacteristics() and `lines` are
    // matching flavour messages. ambientPoolFor merges in lines for all
    // active tags. These are NOT gated by the 20-min throttle since they
    // don't quote the full description text — they're flavour lines derived
    // from inferred characteristics.
    //
    // DEAD POOLS REMOVED in v2.76 (per spec: "remove dead pools of types of
    // track which aren't needed"): gravel, sand, ice, wet, jumps. None of
    // these tags ever fire against the Torn track set.
    //
    // NEW TAGS ADDED in v2.76 to reflect Torn-specific track features:
    //   straights, hairpins, rightAngles, sharpCorners, softBends, varied,
    //   water, bridges, islands, lake, powerPlant, waterTreatment, jail,
    //   financial, shopping, freight, illegal, upmarket, balanced,
    //   legendary, accelFocus, handlingFocus, brakingFocus, large, short.
    const TRACK_CHARACTERISTIC_LINES = [
        // ─── SURFACE ──
        { tag: 'mud', lines: [
            'Mud sprays in every direction. Drivers fighting for grip.',
            'The mud is doing the talking — cars sliding everywhere.',
            'Tyres caked in mud. Steering inputs need to be smoother than ever.',
            'A car comes past, its bodywork barely visible under the mud.',
            'Mechanics will be cursing tonight. Every panel coated in filth.',
            'Mud flicks up off the rear wheels in great brown arcs.',
            'Visibility through the screen is almost zero — wipers earning their keep.',
            'One bad line and the mud will eat your race.',
            'The racing line is a thin strip of slightly less mud than the rest.',
            'Lap times suffering badly out there. The mud is a great leveller.',
            'Anyone without four-wheel-drive is finding this hard going.',
            'Rally-spec setup is the only thing keeping these cars pointing forward.',
            'Off-road sections eating into the laps. Tyres choosing the line, not the drivers.',
            'A rally car would be in heaven here. Everything else is in trouble.',
            'Sliding under acceleration, sliding under braking — that is rally driving.'
        ]},
        { tag: 'tarmac', lines: [
            'Smooth tarmac means the fast cars are in their element.',
            'On this surface, grip is consistent and lap times tumble.',
            'Tarmac like a billiard table — no excuses for slow times.',
            'Cars are hooked up beautifully on this surface.',
            'You can hear the tyres squealing — that grip you only get on good tarmac.',
            'Setup matters everywhere, but on tarmac the differences really show.',
            'Drivers can lean on the tyres here. The grip is there to be used.',
            'A surface that rewards precision — and punishes the timid.',
            'On a circuit like this, every lap should be within a tenth.',
            'Quality tarmac under the wheels. The grip is consistent everywhere.',
            'A proper racing surface — drivers can attack every corner with confidence.',
            'No excuses on a tarmac circuit. Lap times tell the truth.'
        ]},

        // ─── LAYOUT / FEATURES ──
        { tag: 'narrow', lines: [
            'Tight, narrow track — no margin for error here.',
            'Two abreast is a luxury on this circuit.',
            'The walls feel like they\'re closing in.',
            'Overtaking opportunities are rarer than diamonds out there.',
            'A circuit that demands respect — there is nowhere to hide.'
        ]},
        { tag: 'wide', lines: [
            'Wide enough to take a real run at it. Drivers using every inch.',
            'Lots of space to set up overtakes here.',
            'Open layout suits the brave.',
            'Three abreast through some corners — there is room if you commit.',
            'The width of this track lets drivers be creative with their lines.'
        ]},
        { tag: 'straights', lines: [
            'Those long straights are eating up the laps.',
            'Top speed matters here — and the slipstream is in play.',
            'Down the long straight and the engines are absolutely howling.',
            'Plenty of running room down the straights. Slipstream battles brewing.',
            'A track that rewards a strong straight-line car.',
            'The straights here are a chance to draw breath — and pick a passing place.'
        ]},
        { tag: 'hairpins', lines: [
            'The hairpins are where this race will be won or lost.',
            'Through the hairpin, brakes glowing red, drivers wrestling the cars round.',
            'Hairpin entry — the latest brakers gain a place every lap.',
            'Anyone who gets the hairpin wrong is going to find a wall.'
        ]},
        { tag: 'rightAngles', lines: [
            'Those 90-degree bends are unforgiving — brake too late and you are off.',
            'The right-angle turns are sapping all the speed from the long straights.',
            'Sharp corner exits — traction matters more than top speed.'
        ]},
        { tag: 'sharpCorners', lines: [
            'Razor-sharp corners catching out anyone who oversteps the mark.',
            'A circuit full of sharp corners — every braking zone a potential incident.',
            'The sharpness of these corners is brutal on tyres.'
        ]},
        { tag: 'softBends', lines: [
            'Smooth, flowing bends here — drivers can carry serious speed.',
            'The soft bends reward those who keep momentum.',
            'Easy on the steering, hard on the throttle — these gentle bends suit the brave.'
        ]},
        { tag: 'twisty', lines: [
            'Corner after corner — no time to breathe.',
            'A test of patience as much as speed. The lines are everything.',
            'The drivers earning every metre through these twists.',
            'Steering wheels rarely sit straight on a layout like this.',
            'The flow matters more than outright pace through this lot.',
            'Get one corner wrong and the next three are compromised.'
        ]},
        { tag: 'varied', lines: [
            'No two corners the same here — every braking zone needs a different approach.',
            'The variety of bends keeps the drivers honest. No autopilot on this track.',
            'A real menu of corner types out there. The complete driver gets rewarded.'
        ]},
        { tag: 'oval', lines: [
            'Round and round we go — oval racing is its own discipline.',
            'Constant left-handers mean uneven tyre wear.',
            'On an oval, the slipstream is king.'
        ]},
        { tag: 'hilly', lines: [
            'Elevation changes make this one a real challenge.',
            'A blind crest — the brave commit, the rest lift.',
            'Going downhill, the brakes are taking a hammering.',
            'Climbing through the gears on the uphill drag — drivers leaning forward.',
            'Drivers cresting the rise and reaching for the brakes almost in the same moment.'
        ]},

        // ─── ENVIRONMENT / LOCATION ──
        { tag: 'industrial', lines: [
            'Industrial backdrop adds to the atmosphere — and the smell.',
            'Factory walls echo the engine noise back twice as loud.',
            'Steel and concrete on every side. No room for sightseeing.',
            'The clatter of industry mixes with the bark of the exhausts.',
            'Warehouse roofs, chimneys, machinery — a track with a working backdrop.',
            'Chemical plants either side — fumes and engine noise blending together.'
        ]},
        { tag: 'docks', lines: [
            'The dock cranes loom overhead. A unique stage for racing.',
            'Salt air, diesel fumes, and the roar of engines.',
            'You can almost taste the sea between corners.',
            'Shipping containers stacked like grandstands either side.',
            'The smell of fuel and brine — there is nowhere quite like racing at the docks.'
        ]},
        { tag: 'forest', lines: [
            'Trees lining the track turn it into a tunnel of green.',
            'Branches overhead, leaves on the line — a different kind of hazard.',
            'The forest absorbs some of the noise. Almost peaceful, almost.',
            'A wildlife sighting between corners — they have got used to the noise.',
            'Sun and shadow flicker through the canopy at racing speed.'
        ]},
        { tag: 'city', lines: [
            'Concrete walls and street furniture — nowhere to put a wheel wrong.',
            'Urban racing at its most uncompromising.',
            'Manhole covers and kerbs to think about as well as the corners.',
            'Painted lines on the road become hazards in the wet.',
            'The buildings funnel the noise straight back at the crowd.'
        ]},
        { tag: 'country', lines: [
            'Rolling countryside as a backdrop. Beautiful — and quick.',
            'Hedgerows and farm gates flicker past at racing speed.',
            'Out in the country, the only sound is engine noise and the occasional sheep.',
            'Through the park, the trees blurring past at racing speed.'
        ]},
        { tag: 'water', lines: [
            'Glimpses of water between the corners — a striking backdrop.',
            'The bay glittering in the distance as the cars thunder past.',
            'Spectators along the waterfront getting the best view in town.'
        ]},
        { tag: 'bridges', lines: [
            'Across the bridges, the cars compress together — overtaking gets risky here.',
            'Those old bridges are a real bottleneck. Watch for contact.',
            'The bridges look ready to give up at any moment — racing across them takes nerve.',
            'Crossing the bridge, the cars\' suspension thumping over the joins.'
        ]},
        { tag: 'islands', lines: [
            'Looping round the islands — the layout twists in ways nobody expects.',
            'The island section is where the brave drivers find time on the rest.',
            'Slingshotting around the coastline of the islands at full noise.'
        ]},
        { tag: 'lake', lines: [
            'The lake mirrors the sky as the cars flick past at speed.',
            'Round the lake the spray from the leading cars hangs in the air.',
            'The little island in the middle of the lake — connected by those creaking bridges.'
        ]},
        { tag: 'powerPlant', lines: [
            'Round the cooling towers, the cars briefly out of sight from the crowd.',
            'Engines roaring under the shadow of the power plant funnels.',
            'A peninsula track with the power station looming over every corner.',
            'Spectators near the funnels covering their ears — the noise is unbearable.'
        ]},
        { tag: 'waterTreatment', lines: [
            'Round the water treatment plant — not the most glamorous backdrop.',
            'The smell out here is something else. Drivers happy to keep windows up.',
            'Every corner here brings a different surprise.'
        ]},
        { tag: 'jail', lines: [
            'Past the entrance of the jail — the inmates probably have the best view in town.',
            'Sirens from the jail mixing with the engine noise. Atmospheric stuff.',
            'Racing past the prison walls — the irony of an illegal race not lost on anyone.'
        ]},
        { tag: 'financial', lines: [
            'Through the financial district, glass towers reflecting the cars back at us.',
            'Bankers in their office windows watching the carnage below.',
            'The financial district makes for a glamorous, if unlikely, racing backdrop.'
        ]},
        { tag: 'shopping', lines: [
            'Round the shopping district — shoppers running for cover.',
            'The shop fronts blurring past at racing speeds.',
            'A street circuit through the high street. The shoppers are not amused.'
        ]},
        { tag: 'freight', lines: [
            'A real risk of meeting a freight truck round the next bend.',
            'Heavy goods vehicles still using these roads — adds a hazard you won\'t find on a real circuit.',
            'Anyone who finds a lorry on the racing line is having a bad day.'
        ]},
        { tag: 'illegal', lines: [
            'This is unlicensed racing at its finest — no rules, no mercy.',
            'Marshalls? On a track like this? The drivers police themselves.',
            'An illegal street race — the police know but turn a blind eye.'
        ]},
        { tag: 'upmarket', lines: [
            'The richer districts make a fine backdrop for engine noise and rubber smoke.',
            'Residents of these expensive houses are not getting any sleep tonight.',
            'High-end streetlights and manicured verges — and 100mph race cars.'
        ]},

        // ─── CHARACTER / DIFFICULTY HINTS ──
        { tag: 'brutal', lines: [
            'A track that punishes mistakes. Every driver knows it.',
            'Unforgiving circuit — one error and the race is over.',
            'Brutal layout, brutal consequences.',
            'No second chances on a circuit like this.',
            'The wall is never far away. The drivers know it.',
            'One wrong move out there will end your race in spectacular fashion.'
        ]},
        { tag: 'fast', lines: [
            'High-speed running here — engines screaming at their limit.',
            'Top gear most of the lap. This is flat-out stuff.',
            'Cars blasting past so fast the crowd feels the wind.',
            'The straights are eating up the laps. Speeds nudging the limit.',
            'On a fast circuit, aerodynamics matter as much as engine power.',
            'Pure speed is what wins here. No hiding place for the under-powered.'
        ]},
        { tag: 'technical', lines: [
            'A technical circuit — the drivers who do their homework get rewarded.',
            'Lap times here come from precision, not bravery.',
            'Every corner has a specific entry, apex, and exit. No improvising.',
            'The setup work pays off on a track this demanding.'
        ]},
        { tag: 'balanced', lines: [
            'A track that needs everything — speed, handling, braking, acceleration.',
            'No single weakness can be hidden on a balanced circuit.',
            'The all-rounder cars come into their own out there.',
            'Drivers without a complete skillset will be exposed today.'
        ]},
        { tag: 'legendary', lines: [
            'A legendary stretch of tarmac — every racer wants their name on its record board.',
            'Designed by racing professionals — and it shows in every corner.',
            'The "perfect track" some have called it. Hard to disagree.',
            'Few places carry the racing history that this one does.'
        ]},
        { tag: 'accelFocus', lines: [
            'Short bursts of acceleration matter more than top speed on a layout like this.',
            'Cars that can pick up the throttle hard out of slow corners thrive here.',
            'Acceleration drivers are licking their lips at the look of this track.'
        ]},
        { tag: 'handlingFocus', lines: [
            'This is a handling track — the wheel does more work than the throttle.',
            'Quick steering and confident car placement win out here.',
            'Pure horsepower is no help on a track that demands handling.'
        ]},
        { tag: 'brakingFocus', lines: [
            'Braking points are everything on a track like this.',
            'Strong brakes will save a driver a fortune in tenths today.',
            'Anyone with weak brakes is going to find themselves outclassed.'
        ]},
        { tag: 'large', lines: [
            'A monster of a circuit. The drivers earn every metre.',
            'On a track this size, pacing matters as much as outright pace.',
            'Long laps, long races, plenty of time for plot twists.'
        ]},
        { tag: 'short', lines: [
            'A short track means traffic is constant — lapped cars from lap two onwards.',
            'On a layout this short, even the smallest error costs places.',
            'The brevity of the lap makes setup adjustments hard to dial in.'
        ]}
    ];

    // Return the characteristic-based ambient lines that match the current
    // track's tags. Empty array if no tags detected or no track info available.
    function characteristicAmbientPool () {
        const tags = getTrackCharacteristics();
        if (!tags || Object.keys(tags).length === 0) return [];
        const pool = [];
        TRACK_CHARACTERISTIC_LINES.forEach(function (entry) {
            if (tags[entry.tag]) pool.push.apply(pool, entry.lines);
        });
        return pool;
    }

    // ─── Persistence ─────────────────────────────────────────────────────────────
    function loadState () {
        try {
            const raw = GM_getValue(STORAGE_KEY, null);
            if (!raw) return;
            const p = JSON.parse(raw);
            state.status = p.status || S.MENU;
            state.playerName = p.playerName || '—';
            // Defensive: if a previous version persisted a UI-label as the player
            // name (e.g. "Position" from a faulty scrape), drop it so we re-scrape.
            if (NAME_BLACKLIST.test(state.playerName)) state.playerName = '—';
            state.track = p.track || '—';
            state.car = p.car || '—';
            state.position = p.position || '—';
            state.focusedName = p.focusedName || '';
            state.focusedCar = p.focusedCar || '';
            state.focusedPosition = p.focusedPosition || '';
            state.racerCount = p.racerCount || 0;
            state.raceFieldSize = p.raceFieldSize || 0;
            state.racers = p.racers || [];
            state.prevRacers = p.racers || [];
            state.finishers = p.finishers || [];
            state.outroShown = p.outroShown || false;
            state.lastLap = p.lastLap || '—';
            state.currentLap = p.currentLap || '—';
            state.prevLapNumber = p.prevLapNumber || 0;
            state.lapTimesSec = Array.isArray(p.lapTimesSec) ? p.lapTimesSec.slice(-200) : [];
            state.totalLaps = p.totalLaps || 0;
            state.nextLapMsgAt = p.nextLapMsgAt || 0;
            state.nextAvgLapAt = p.nextAvgLapAt || 0;
            state.lastAvgSec = p.lastAvgSec || 0;
            state.completion = p.completion || '—';
            state.windowFixed = p.windowFixed || false;
            state.windowLeft = p.windowLeft || '';
            state.windowTop = p.windowTop || '';
            state.windowWidth = p.windowWidth || '';
            state.windowHeight = p.windowHeight || '';
            state.scrollDirection = (p.scrollDirection === 'up' || p.scrollDirection === 'down')
                ? p.scrollDirection : 'up';
            state.halfwayFired = p.halfwayFired || false;
            state.preLaunchMsgCount = p.preLaunchMsgCount || 0;
            feedLines = p.feedLines || [];
            // Scrub any persisted feed lines from previous versions that contain
            // the "Position has joined..." class of bug — i.e. lines that begin
            // with a known UI-label word followed by a verb. These are stale
            // entries from older script versions where a faulty name scrape let
            // a UI label leak into the message; they re-appear on every refresh
            // and look like a live bug. The current code paths can't generate
            // them, so it's safe to drop them on sight.
            feedLines = feedLines.filter(function (line) {
                if (!line || !line.text) return true;
                return !STALE_NAME_LEAK_PATTERN.test(line.text);
            });
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
            if (isRacingLike(state.status)) restoredIntoRacing = true;
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
                raceFieldSize: state.raceFieldSize,
                racers: state.racers,
                finishers: state.finishers,
                outroShown: state.outroShown,
                lastLap: state.lastLap,
                currentLap: state.currentLap,
                prevLapNumber: state.prevLapNumber,
                lapTimesSec: state.lapTimesSec,
                totalLaps: state.totalLaps,
                nextLapMsgAt: state.nextLapMsgAt,
                nextAvgLapAt: state.nextAvgLapAt,
                lastAvgSec: state.lastAvgSec,
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
    // Per spec v2.78: some tokens render empty when their backing data
    // isn't available (no API key, fetch not yet completed, or no matching
    // data). Templates that reference these tokens would produce broken
    // output like "Lap 4 in 00:27 for Sanxion, ." when the token renders
    // as the empty string. This helper drops such templates from the pool
    // BEFORE pickLine selects, so the script degrades gracefully when API
    // data is unavailable.
    //
    // Optional tokens with their availability check:
    //   {recordGap}   — needs cached records AND a lap time recorded
    //   {recordTime}, {recordHolder}, {recordCar} — need cached records
    //   {carStrength}, {carWeakness} — need cached enlistedcars
    //   {raceRecord}  — needs cached enlistedcars
    //   {trackDesc}   — needs cached track descriptions
    function filterAvailableTemplates (pool) {
        if (!Array.isArray(pool) || !pool.length) return pool;
        const haveRecord = !!getTopTrackRecord();
        const haveCar = !!getPlayerCarAttrs();
        const haveDesc = !!getCurrentTrackDescription();
        // For records-driven gap tokens we also need at least one lap recorded.
        const haveLaps = state.lapTimesSec && state.lapTimesSec.length > 0;
        // Per spec v2.83: once finishers thin out the field, racer-slot
        // tokens ({leader}, {p2}, {p3}, {last}) can resolve to em-dash
        // because state.racers no longer has enough entries. Filter such
        // templates out instead of letting them render "{leader} leads from
        // — and —. Every lap a new story." which reads broken.
        const racerCount = state.racers ? state.racers.length : 0;
        return pool.filter(function (tpl) {
            if (typeof tpl !== 'string') return false;
            if (/\{recordGap\}/.test(tpl) && !(haveRecord && haveLaps)) return false;
            if (/\{recordTime\}|\{recordHolder\}|\{recordCar\}/.test(tpl) && !haveRecord) return false;
            if (/\{carStrength\}|\{carWeakness\}|\{raceRecord\}/.test(tpl) && !haveCar) return false;
            if (/\{trackDesc\}/.test(tpl) && !haveDesc) return false;
            // Racer-slot guards. {leader} needs at least 1 racer, {p2}
            // needs 2, {p3} needs 3. {last} needs at least 1 (and is
            // meaningfully different from {leader} only when 2+ racers
            // are present). All these tokens resolve via state.racers,
            // which is filtered by excludeCrashed() — so racerCount here
            // is the live count of still-racing drivers, exactly what we
            // want for the no-em-dash check.
            if (/\{p3\}/.test(tpl) && racerCount < 3) return false;
            if (/\{p2\}/.test(tpl) && racerCount < 2) return false;
            if (/\{leader\}/.test(tpl) && racerCount < 1) return false;
            // {last} is only meaningful as a distinct concept when there
            // are at least 2 racers — otherwise {last} === {leader} and
            // the line reads like a tautology.
            if (/\{last\}/.test(tpl) && racerCount < 2) return false;
            return true;
        });
    }

    function pickLine (pool, typeKey) {
        const filtered = filterAvailableTemplates(pool);
        // If filtering removed everything, fall back to the original pool —
        // better to render with a missing token than to skip the message
        // entirely. This shouldn't happen in practice because we only filter
        // pools that mix gated and non-gated lines.
        const effectivePool = filtered.length ? filtered : pool;
        const recent = recentByType[typeKey] || [];
        const available = effectivePool.filter(function (l) { return recent.indexOf(l) === -1; });
        const source = available.length > 0 ? available : effectivePool;
        const chosen = source[Math.floor(Math.random() * source.length)];
        recentByType[typeKey] = recent.concat([chosen]).slice(-REPEAT_WINDOW);
        return chosen;
    }

    // Map racer count → tier pool name on LINES.RACING. Tier boundaries from
    // the spec's "NUMBER OF RACERS AFFECTS TYPE OF MESSAGES SHOWN" section.
    function getRacerCountTierKey () {
        const n = state.racerCount || state.raceFieldSize || 0;
        if (n <= 1) return null;
        if (n <= 6) return 'tierTiny';
        if (n <= 15) return 'tierSmall';
        if (n <= 50) return 'tierMedium';
        if (n <= 75) return 'tierLarge';
        return 'tierMassive';
    }

    // ambientPoolFor returns the ambient line pool for a status, with optional
    // pools merged in based on context:
    //   - apiAmbient: only when a track description has been fetched from
    //     api.torn.com (otherwise the templates render as empty/broken).
    //   - tier pool (RACING only): tier-specific flavour lines keyed by
    //     racer-count band (2-6 / 7-15 / 16-50 / 51-75 / 76-100).
    // Without an API key or before the cache populates, this returns just the
    // built-in ambient plus the relevant tier — so the commentary degrades
    // gracefully and the user notices no difference if the API is unavailable.
    // ─── Lap-time helpers ─────────────────────────────────────────────────────────
    // Parse a "MM:SS" or "M:SS" or "SS" lap-time string into seconds. Returns
    // 0 on parse failure rather than throwing — caller treats 0 as "unknown".
    function parseLapTimeToSeconds (s) {
        if (!s || typeof s !== 'string') return 0;
        const trimmed = s.trim();
        if (!trimmed) return 0;
        // "MM:SS" or "M:SS" — most common Torn format
        const m1 = trimmed.match(/^(\d+):(\d{1,2})$/);
        if (m1) return parseInt(m1[1], 10) * 60 + parseInt(m1[2], 10);
        // Plain seconds e.g. "27" or "27.4"
        const m2 = trimmed.match(/^(\d+(?:\.\d+)?)$/);
        if (m2) return parseFloat(m2[1]);
        return 0;
    }

    // Format a seconds value back as "MM:SS" for display in commentary.
    function formatSecondsAsLapTime (sec) {
        if (!sec || sec <= 0) return '—';
        const mins = Math.floor(sec / 60);
        const secs = Math.round(sec % 60);
        const padded = secs < 10 ? '0' + secs : '' + secs;
        return mins + ':' + padded;
    }

    // Roll the next-message cadence based on total race length. Per spec:
    //   50-100 laps → every 8-12 laps
    //   2-49 laps   → every 2-6 laps
    // Returns the number of laps to wait before the next lap-time line.
    function rollLapMessageGap (totalLaps) {
        const t = totalLaps || 0;
        let minGap, maxGap;
        if (t >= 50) {
            minGap = 8; maxGap = 12;
        } else {
            minGap = 2; maxGap = 6;
        }
        // Clamp to total laps so absurdly small races still see at least one msg.
        if (t > 0 && maxGap > t) maxGap = Math.max(minGap, t);
        return minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
    }

    // Per spec v2.67: average lap-time commentary fires every 2-4 laps,
    // starting from lap 5. Returns the gap (2-4 inclusive) to add to the
    // current lap number for the next eligible average message.
    function rollAverageLapGap () {
        return 2 + Math.floor(Math.random() * 3); // 2, 3, or 4
    }

    function ambientPoolFor (statusLines) {
        if (!statusLines || !Array.isArray(statusLines.ambient)) return [];
        let out = statusLines.ambient;
        // Merge tier pool when present on the LINES section (only RACING has tiers).
        const tierKey = getRacerCountTierKey();
        if (tierKey && Array.isArray(statusLines[tierKey]) && statusLines[tierKey].length) {
            out = out.concat(statusLines[tierKey]);
        }
        // Per spec v2.76: track-description ambient lines should be used
        // "every other ambient message". We achieve this by toggling a
        // module-level counter on each call. On even ticks (when char-pool
        // available), return ONLY the char-pool — the picker will then draw
        // exclusively from track-description-flavoured lines for that turn.
        // On odd ticks, return the base+tier mix without the char-pool. The
        // result is a near-perfect 50/50 alternation in practice.
        // If no char-pool is available (no description fetched / no tags
        // detected), just return base+tier as before.
        const charPool = characteristicAmbientPool();
        if (charPool.length) {
            ambientAlternator++;
            if (ambientAlternator % 2 === 0) {
                // Return char-pool ONLY for this draw — alternation step.
                // The 20-min apiAmbient (full-description verbatim) is still
                // gated below, but we don't merge it here on alternation
                // turns since the char-pool is the source for this tick.
                return charPool;
            }
        }
        // Merge API-flavoured pool only when (a) description available AND
        // (b) the 20-minute gate is open. The apiAmbient lines DO quote the
        // full description text, so they're spec-mandated to fire at most
        // once every 20 minutes.
        const desc = getCurrentTrackDescription();
        if (desc && fullDescAllowed() && Array.isArray(statusLines.apiAmbient) && statusLines.apiAmbient.length) {
            out = out.concat(statusLines.apiAmbient);
        }
        return out;
    }

    function fill (tpl, extras) {
        // Defensive: if state.playerName is somehow the placeholder dash, empty,
        // or a UI-label word, fall back to a generic word rather than letting
        // bad data render in commentary. This is belt-and-braces — the scraper
        // and entry-message guards already filter at source — but covers any
        // late-arriving template call before name detection has settled.
        const safePlayer = (state.playerName && state.playerName !== '—'
            && !NAME_BLACKLIST.test(state.playerName))
            ? state.playerName : 'The driver';
        const vars = Object.assign({
            player: safePlayer,
            track: state.track !== '—' ? state.track : 'the circuit',
            car: state.car !== '—' ? state.car : 'their car',
            pos: ordinal(parseInt(state.position, 10) || 0),
            leader: state.racers[0] ? state.racers[0].name : '—',
            p2: state.racers[1] ? state.racers[1].name : '—',
            p3: state.racers[2] ? state.racers[2].name : '—',
            last: state.racers.length > 0 ? state.racers[state.racers.length - 1].name : '—',
            // {lastDesc} — describes the last-place racer's position phrasing.
            // Per spec v2.75:
            //   field ≤5: use their ordinal position ("in 5th") — "at the
            //             back" reads as filler when there are only a handful
            //             of cars to be at the back of.
            //   field >5: a random pick between "at the back" and "in last
            //             position" — both read naturally in larger fields.
            lastDesc: (function () {
                const n = state.racers.length;
                if (n === 0) return '';
                if (n <= 5) {
                    return 'in ' + ordinal(n);
                }
                return Math.random() < 0.5 ? 'at the back' : 'in last position';
            })(),
            total: String(state.racerCount || state.racers.length || '?'),
            countdown: scrapeCountdown() || 'a few moments',
            // {trackDesc} comes from the Torn v2 API /racing/tracks endpoint
            // matched by title. Empty string if no API key set or not yet
            // cached — template lines that use this should be authored to
            // remain readable even with an empty value, or be gated to only
            // appear when the description is available.
            trackDesc: getCurrentTrackDescription(),
            // Last lap time (e.g. "00:27") and the lap number it represents.
            // {lapTime} resolves to the most recent lastLap, {lapNum} to the
            // lap number that lapTime corresponds to (i.e. the lap that was
            // just completed). Used by LINES.RACING.lapTime templates.
            lapTime: (state.lastLap && state.lastLap !== '—') ? state.lastLap : 'a respectable time',
            lapNum: state.prevLapNumber > 0 ? state.prevLapNumber : '?',
            // {delta} — absolute seconds difference between the two most
            // recent recorded laps. Used by the lapTimeFaster/lapTimeSlower
            // templates. Renders to '?' when there aren't at least two laps
            // on record (so the template stays grammatical even if something
            // odd happens).
            delta: (function () {
                const n = state.lapTimesSec.length;
                if (n < 2) return '?';
                const d = Math.abs(state.lapTimesSec[n - 1] - state.lapTimesSec[n - 2]);
                // Show as a clean integer if within 0.05, else 1dp.
                return d < 1 ? d.toFixed(1) : Math.round(d);
            })(),
            // {avgTime} — running average of all recorded lap times so far,
            // formatted as MM:SS. Used by the lapTimeAverage templates.
            avgTime: (function () {
                const arr = state.lapTimesSec;
                if (!arr.length) return '—';
                let total = 0;
                for (let i = 0; i < arr.length; i++) total += arr[i];
                return formatSecondsAsLapTime(total / arr.length);
            })(),
            // {avgComparison} — pre-formatted phrase comparing the current
            // running average to the previously-reported one. Per spec v2.77:
            //   faster: "2s down on last average"
            //   slower: "3s slower than last average"
            // (no leading sign, suffix "s" on the number, no trailing full
            // stop — the template adds it). Empty string when there's no
            // prior reading or when the diff is too small (caller should
            // pick a "level with" template instead).
            avgComparison: (function () {
                const arr = state.lapTimesSec;
                if (!arr.length || !state.lastAvgSec) return '';
                let total = 0;
                for (let i = 0; i < arr.length; i++) total += arr[i];
                const cur = total / arr.length;
                const diff = cur - state.lastAvgSec;
                if (Math.abs(diff) < 0.5) return '';
                // Round to nearest integer for the headline number.
                const absRound = Math.round(Math.abs(diff));
                if (diff < 0) {
                    // Got faster — "2s down on last average".
                    return absRound + 's down on last average';
                }
                // Got slower — "3s slower than last average".
                return absRound + 's slower than last average';
            })(),
            // {trackFlavour} — per spec v2.76, a short context-appropriate
            // phrase derived from the track's characteristics that can be
            // dropped into player/proximity/movement commentary. Resolves to
            // a track-specific fragment like "across the bridges", "past
            // the funnels", "through the slalom", "down the long straight"
            // based on which tags fired for the current track. Falls back
            // to a generic phrase when no specific tags are active. This is
            // what gives lap-by-lap commentary track-aware texture without
            // needing track-specific templates.
            trackFlavour: (function () {
                const tags = getTrackCharacteristics();
                const phrases = [];
                if (tags.slalom)         phrases.push('through the slalom');
                if (tags.hairpins)       phrases.push('through the hairpins');
                if (tags.rightAngles)    phrases.push('into the 90-degree bends');
                if (tags.sharpCorners)   phrases.push('into the razor-sharp corners');
                if (tags.softBends)      phrases.push('through the gentle bends');
                if (tags.straights)      phrases.push('down the long straight');
                if (tags.bridges)        phrases.push('across the bridges');
                if (tags.lake)           phrases.push('round the lake');
                if (tags.islands)        phrases.push('round the island');
                if (tags.powerPlant)     phrases.push('past the cooling towers');
                if (tags.waterTreatment) phrases.push('past the treatment plant');
                if (tags.jail)           phrases.push('past the jail');
                if (tags.financial)     phrases.push('through the financial district');
                if (tags.shopping)       phrases.push('through the shopping district');
                if (tags.docks)          phrases.push('round the dock cranes');
                if (tags.industrial)     phrases.push('between the factory walls');
                if (tags.water)          phrases.push('along the waterfront');
                if (tags.country)        phrases.push('through the park');
                if (tags.upmarket)       phrases.push('through the rich district');
                if (tags.mud)            phrases.push('through the dirt section');
                if (tags.oval)           phrases.push('round the banking');
                if (tags.hilly)          phrases.push('over the rise');
                if (!phrases.length) phrases.push('through the field');
                return phrases[Math.floor(Math.random() * phrases.length)];
            })(),
            // ─── Track record tokens (spec v2.78) ────────────────────────────
            // {recordTime}, {recordHolder}, {recordCar}: top class record at
            // current track. Empty strings when no records cached yet (or no
            // key); templates that include these tokens should be in pools
            // that get filtered out when the token would render empty.
            recordTime: (function () {
                const r = getTopTrackRecord();
                return r ? formatSecondsAsLapTime(r.lap_time) : '';
            })(),
            recordHolder: (function () {
                const r = getTopTrackRecord();
                return r && r.driver_name ? r.driver_name : '';
            })(),
            recordCar: (function () {
                const r = getTopTrackRecord();
                return r && r.car_item_name ? r.car_item_name : '';
            })(),
            // {recordGap}: player's last lap vs the class record. Renders as
            // a phrase like "Only 1.2 seconds off the track record" when
            // close (within 5s), or longer-form descriptive text when further
            // back. Empty when no last-lap or no record cached.
            recordGap: (function () {
                const r = getTopTrackRecord();
                const arr = state.lapTimesSec;
                if (!r || !arr.length) return '';
                const lastLap = arr[arr.length - 1];
                const gap = lastLap - r.lap_time;
                if (gap < 0.05) {
                    // Player BEAT the record (or matched it within rounding)
                    return 'a new track record';
                }
                if (gap < 0.5) {
                    return 'within a tenth of the track record';
                }
                if (gap < 2) {
                    return 'only ' + gap.toFixed(1) + ' seconds off the track record';
                }
                if (gap < 5) {
                    return gap.toFixed(1) + ' seconds off the record';
                }
                return Math.round(gap) + ' seconds off the all-time record';
            })(),
            // ─── Car-attribute tokens (spec v2.78) ───────────────────────────
            // {carStrength}: a phrase describing the player's car's standout
            // attribute (whichever is rated "high" first, in a priority that
            // matches what the current track demands). Falls back to a
            // generic phrase when no car data or no high attribute.
            carStrength: (function () {
                const attrs = getPlayerCarAttrs();
                if (!attrs) return '';
                const tags = getTrackCharacteristics();
                // Build a priority list of attribute → phrase based on what
                // the track demands. Iterate priorities and return the first
                // attribute classified "high" at the player's car class.
                const phrases = {
                    top_speed: 'with serious top end',
                    acceleration: 'with a strong launch out of slow corners',
                    braking: 'with brakes that can do the work',
                    handling: 'with handling to thread the eye of a needle',
                    safety: 'with safety to spare',
                    dirt: 'tuned right for the rough stuff',
                    tarmac: 'set up for grippy tarmac'
                };
                const priority = [];
                // Track-driven priority: list the attribute most relevant to
                // current tags first.
                if (tags.straights || tags.fast) priority.push('top_speed', 'acceleration');
                if (tags.hairpins || tags.rightAngles || tags.sharpCorners) priority.push('braking', 'acceleration');
                if (tags.twisty || tags.slalom || tags.handlingFocus) priority.push('handling');
                if (tags.mud) priority.push('dirt');
                if (tags.tarmac) priority.push('tarmac');
                if (tags.brakingFocus) priority.push('braking');
                // Always-fallback ordering at the end.
                const fallback = ['handling', 'acceleration', 'top_speed', 'braking', 'tarmac', 'dirt', 'safety'];
                for (let i = 0; i < fallback.length; i++) {
                    if (priority.indexOf(fallback[i]) === -1) priority.push(fallback[i]);
                }
                for (let i = 0; i < priority.length; i++) {
                    const k = priority[i];
                    if (attrs[k] && attrs[k].level === 'high') return phrases[k];
                }
                // Per spec v2.82 BUG FIX: empty {carStrength} produced
                // "The {car} setup is . {player} ready to make it count."
                // because templates assume the token always renders a
                // complete phrase. For class D/E cars (and modest B/C
                // cars) no attribute reaches "high" on the class-scaled
                // threshold — return empty would break the template.
                // Fall back through MEDIUM-classified attributes first,
                // then the single highest raw value, then a generic
                // phrase. Token always renders non-empty when car data
                // exists.
                for (let i = 0; i < priority.length; i++) {
                    const k = priority[i];
                    if (attrs[k] && attrs[k].level === 'medium') return phrases[k];
                }
                // Final fallback: pick the highest raw value across the
                // attributes we have phrases for. This catches the all-low
                // class-E case (e.g. Skids with all stats 5-15).
                let bestKey = null, bestValue = -1;
                const phraseKeys = Object.keys(phrases);
                for (let i = 0; i < phraseKeys.length; i++) {
                    const k = phraseKeys[i];
                    if (attrs[k] && typeof attrs[k].value === 'number' && attrs[k].value > bestValue) {
                        bestValue = attrs[k].value;
                        bestKey = k;
                    }
                }
                if (bestKey) return phrases[bestKey];
                // Truly nothing — generic positive phrase so the sentence
                // still parses cleanly.
                return 'running well';
            })(),
            // {carWeakness}: opposite of {carStrength} — surfaces a "low"
            // attribute the current track would punish. Empty when no car
            // data or no concerning low attribute.
            carWeakness: (function () {
                const attrs = getPlayerCarAttrs();
                if (!attrs) return '';
                const tags = getTrackCharacteristics();
                const phrases = {
                    top_speed: 'top speed limited',
                    acceleration: 'sluggish on the throttle',
                    braking: 'brakes a real concern',
                    handling: 'handling not its strong suit',
                    dirt: 'no setup for the rough stuff',
                    tarmac: 'tarmac grip a worry'
                };
                // Which low attribute matters MOST on this track?
                if (tags.mud && attrs.dirt && attrs.dirt.level === 'low') return phrases.dirt;
                if (tags.tarmac && attrs.tarmac && attrs.tarmac.level === 'low') return phrases.tarmac;
                if ((tags.straights || tags.fast) && attrs.top_speed && attrs.top_speed.level === 'low') return phrases.top_speed;
                if ((tags.hairpins || tags.brakingFocus) && attrs.braking && attrs.braking.level === 'low') return phrases.braking;
                if ((tags.twisty || tags.handlingFocus) && attrs.handling && attrs.handling.level === 'low') return phrases.handling;
                if (tags.accelFocus && attrs.acceleration && attrs.acceleration.level === 'low') return phrases.acceleration;
                return '';
            })(),
            // {raceRecord}: short "won X of Y" phrase. Empty when no data.
            raceRecord: (function () {
                const attrs = getPlayerCarAttrs();
                if (!attrs || !attrs.races_entered) return '';
                return attrs.races_won + ' wins from ' + attrs.races_entered + ' races';
            })()
        }, extras || {});
        return tpl.replace(/\{(\w+)\}/g, function (_, k) {
            // If a template token is unknown, return the original {token}
            // form rather than the bare key. The previous fallback returned
            // the literal key (e.g. "{Position}" → "Position"), which is
            // exactly the silent-failure mode that produced the long-standing
            // "Position has joined the track" rendering bug — a bad template
            // token would render as a UI-label word that looked like a real
            // player name. Returning {token} makes the bug visible instantly.
            return vars[k] !== undefined ? vars[k] : '{' + k + '}';
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
        position: 'fl-position', finish: 'fl-finish', outro: 'fl-outro', lapTime: 'fl-laptime',
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

    // Per spec: certain quiet statuses must always render commentary top-down,
    // regardless of the user's scroll-direction setting. These statuses have a
    // fixed, short sequence of messages that read as a list — they should not
    // be reversed when the user has set scrollDirection to 'up'.
    const FORCE_TOP_DOWN_STATUSES = [
        'HOSPITAL', 'JAIL', 'TIMED_OUT', 'ALREADY_STARTED', 'NOT_ALLOWED',
        'RACE_FULL', 'NOT_ENOUGH_FUNDS', 'TORN_DOWN', 'UNAVAILABLE',
        'IN_GARAGE', 'STATISTICS', 'ENLISTED'
    ];
    function effectiveScrollDirection () {
        if (FORCE_TOP_DOWN_STATUSES.indexOf(state.status) !== -1) return 'down';
        return state.scrollDirection;
    }

    // In 'down' mode newest entries are at the bottom — auto-scroll keeps bottom visible.
    // In 'up' mode newest entries are at the top — auto-scroll keeps top visible.
    function scrollToEdge () {
        requestAnimationFrame(function () {
            const el = getFeedEl();
            if (!el) return;
            if (effectiveScrollDirection() === 'up') {
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
        if (effectiveScrollDirection() === 'up') {
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
        if (effectiveScrollDirection() === 'up') {
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
        if ((commentaryPaused || replayPausedAuto) && !alwaysShow) return;
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
                        // Per spec: each new arrival in PRE_LAUNCH gets ONE of
                        // three messages, chosen randomly, after a 1-second pause.
                        const arrivalName = r.name;
                        const preLaunchLines = [
                            arrivalName + ' just joined in position ' + posStr + '.',
                            arrivalName + ' does a last minute check.',
                            arrivalName + ' looks fidgety behind the wheel.'
                        ];
                        const choice = preLaunchLines[Math.floor(Math.random() * preLaunchLines.length)];
                        setTimeout(function () {
                            try {
                                if (currentStatus !== S.PRE_LAUNCH) return;
                                pushLine(choice, 'status', ICON.join);
                            } catch (e) { console.error('[TC RC] pre-launch line:', e); }
                        }, 1000);
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
    // Throttle slider gate (per spec v2.73): controls how many non-player
    // non-ambient lines pass through during RACING/RACE_REPLAY. Replaces the
    // old big-race throttle which gated by racer count.
    // Behaviour by slider value (0-100):
    //   100  → admit everything (no gap, no suppression)
    //   1-99 → admit at most one line per gap that scales inversely with the
    //          slider. At 50 the gap is ~3s; at 10 the gap is ~9s.
    //   0    → reject all non-player non-ambient lines entirely
    // The `isPlayerRelated` flag lets callers bypass the gate for any line
    // involving the focused player (per spec: "Less means only player related
    // messages"). Ambient lines also pass — callers omit the gate for those.
    function throttleShouldShow (isPlayerRelated) {
        // Outside racing-like statuses, no throttling — full commentary.
        if (!isRacingLike(state.status)) return true;
        // Player-related lines always pass.
        if (isPlayerRelated) return true;
        // Slider at 100 — no throttling at all.
        if (throttleValue >= 100) return true;
        // Slider at 0 — suppress all non-player non-ambient lines outright.
        if (throttleValue <= 0) return false;
        // Time-based gate. Gap scales inversely with slider value so a higher
        // slider lets more lines through. At slider=99 gap ≈ 100ms (effectively
        // no throttle); at slider=10 gap ≈ 9000ms.
        const now = Date.now();
        if (now < throttleNextAllowedAt) return false;
        // Linear interpolation: gap_ms = (100 - slider) * 100. Tuned so the
        // mid-slider feels like the old 3-5s big-race throttle (slider≈65-70).
        const gapMs = (100 - throttleValue) * 100;
        throttleNextAllowedAt = now + gapMs;
        return true;
    }

    // Legacy alias — earlier code paths still call bigRaceShouldShow() in a
    // few places. Route them through the new throttle so the old name keeps
    // working without a wide rename across the file. Callers that don't pass
    // an explicit isPlayerRelated argument default to false (treat as
    // non-player), preserving the existing call-site semantics.
    function bigRaceShouldShow (isPlayerRelated) {
        return throttleShouldShow(!!isPlayerRelated);
    }

    function fireCommentary (st) {
        // In quiet statuses (CRASHED, UNAVAILABLE, HOSPITAL, TIMED_OUT) the entry
        // message(s) have already fired in onStatusChange. No further commentary
        // should print until the player returns to a normal status.
        if (QUIET_STATUSES.indexOf(st) !== -1) return;
        const now = Date.now();

        if (st === S.COUNTDOWN) {
            if (now >= tAmbient) {
                const picked = pickLine(ambientPoolFor(LINES.COUNTDOWN), 'ambient');
                // If this line uses the full description text, latch the 20-min
                // throttle so apiAmbient lines can't fire again until it expires.
                if (picked && picked.indexOf('{trackDesc}') !== -1) markFullDescUsed();
                pushLine(fill(picked), 'ambient');
                tAmbient = now + COUNTDOWN_GAP + Math.random() * 30000;
            }
            if (now >= tPlayer) {
                pushLine(fill(pickLine(LINES.COUNTDOWN.player, 'player')), 'player');
                tPlayer = now + COUNTDOWN_GAP + Math.random() * 30000;
            }
        }

        if (st === S.PRE_LAUNCH && state.preLaunchMsgCount < PRE_LAUNCH_MAX) {
            if (now >= tAmbient) {
                // Per spec v2.75: track-description-flavoured messages can
                // appear during PRE_LAUNCH as well as RACING/COUNTDOWN.
                // Route through ambientPoolFor() so the characteristic-derived
                // pool (mud/tarmac/docks/etc.) gets merged in alongside the
                // base PRE_LAUNCH ambient lines.
                const picked = pickLine(ambientPoolFor(LINES.PRE_LAUNCH), 'ambient');
                if (picked && picked.indexOf('{trackDesc}') !== -1) markFullDescUsed();
                pushLine(fill(picked), 'ambient');
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

        if (isRacingLike(st)) {
            // Per spec v2.78: "If the player is last and all other racers
            // have finished, add commentary which reflects being alone on
            // the track". When we detect this state, prefer the lonely-
            // finish pool and suppress proximity/position/movement chatter
            // (there's nobody to be near or to overtake). Detection uses
            // the existing finisher tracking: if every non-player non-crashed
            // racer is in knownFinishers, we're alone.
            const lonely = isPlayerAloneOnTrack();
            // Per spec v2.83: in the first ~15 seconds of RACING, prefer
            // the startGrid pool over normal ambient. Cap at 2 lines fired
            // so we don't flood the feed with start chatter — by then the
            // race is properly underway. Skip entirely when restored into
            // RACING from a refresh (raceStartedAt stays 0 in that case).
            const inStartWindow = state.raceStartedAt > 0
                && (Date.now() - state.raceStartedAt) < 15000
                && state.startGridLinesFired < 2;
            if (now >= tAmbient) {
                if (lonely) {
                    pushLine(fill(pickLine(LINES.RACING.lonelyFinish, 'lonely')), 'ambient');
                } else if (inStartWindow) {
                    pushLine(fill(pickLine(LINES.RACING.startGrid, 'startGrid')), 'ambient');
                    state.startGridLinesFired++;
                    // Tighter cadence during the start window so the two
                    // launch lines land within the first 10s of racing.
                    tAmbient = now + 4500 + Math.random() * 2000;
                    return;
                } else {
                    const picked = pickLine(ambientPoolFor(LINES.RACING), 'ambient');
                    if (picked && picked.indexOf('{trackDesc}') !== -1) markFullDescUsed();
                    pushLine(fill(picked), 'ambient');
                }
                tAmbient = now + AMBIENT_GAP + Math.random() * 15000;
            }
            if (now >= tPlayer && !lonely) {
                if (bigRaceShouldShow(true)) {
                    pushLine(fill(pickLine(LINES.RACING.player, 'player')), 'player');
                }
                tPlayer = now + PLAYER_GAP + Math.random() * 8000;
            }
            // Position calls — gated by cooldown; pool selection uses authoritative racerCount.
            // Suppressed when player is alone (no other racers left to reference).
            if (now >= tPosition && now >= tPosCooldown && state.racers.length >= 2 && !lonely) {
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
            // Movement and proximity also gated on !lonely — no other racers
            // means nothing to move past or alongside.
            if (!lonely) detectMovement();
            if (now >= tProximity && state.racers.length >= 2 && !lonely) {
                // Per spec v2.82: proximity commentary should fire when the
                // actual completion gap between adjacent racers is within
                // 0.1%. We compute this from per-racer % completions scraped
                // from the DOM. When completion data isn't available (older
                // Torn UI variant or scrape failure), fall back to the
                // legacy random-leaderboard-adjacent pick so the feature
                // still produces lines, just without the gap guarantee.
                //
                // Per spec v2.84 MESSAGES INVOLVING TWO PLAYERS: the
                // convention for the two-player tokens is:
                //   {p1name} = the racer BEHIND (chaser, attacker)
                //   {p2name} = the racer AHEAD  (defender, leader of pair)
                // This is what makes directional templates read correctly:
                //   "{p1} right on the bumper of {p2}"        — chaser on
                //                                                 defender's
                //                                                 bumper ✓
                //   "{p1} bumps their fender, {p2} brake checks" — chaser
                //                                                 bumps,
                //                                                 defender
                //                                                 brake-
                //                                                 checks ✓
                //   "{p1} tries the move on {p2}"             — chaser
                //                                                 overtakes
                //                                                 defender ✓
                // Symmetric templates (side by side, wheel to wheel, locked
                // in a duel) read the same with either assignment, so the
                // convention is purely about getting the directional ones
                // right.
                const completions = scrapeRacerCompletions();
                const haveCompletions = Object.keys(completions).length >= 2;
                let p1 = null, p2 = null;
                if (haveCompletions) {
                    // Strict mode: only fire when gap < 0.1%.
                    const closePair = findClosestPair(state.racers, completions, 0.1);
                    if (closePair) {
                        // Cooldown per pair so a sustained 0.1% battle
                        // doesn't refire every poll.
                        const key = proximityPairKey(closePair.front.name, closePair.back.name);
                        const last = recentProximityPairs[key] || 0;
                        if (now - last >= PROXIMITY_PAIR_COOLDOWN_MS) {
                            // p1 = chaser (back), p2 = defender (front).
                            p1 = closePair.back;
                            p2 = closePair.front;
                            recentProximityPairs[key] = now;
                        }
                    }
                } else {
                    // Legacy fallback: random adjacent leaderboard pair.
                    // state.racers is leaderboard-ordered (pos 1, 2, 3...)
                    // so racers[idx] is AHEAD of racers[idx+1]. Map to the
                    // chaser/defender convention by assigning the higher-
                    // indexed (further-back) racer to p1.
                    const idx = Math.floor(Math.random() * (state.racers.length - 1));
                    p1 = state.racers[idx + 1];
                    p2 = state.racers[idx];
                }
                if (p1 && p2 && bigRaceShouldShow()) {
                    pushLine(
                        fill(pickLine(LINES.RACING.proximity, 'proximity'), { p1name: p1.name, p2name: p2.name }),
                        'position', ICON.proximity
                    );
                }
                // Advance the cadence whether or not we fired. When we did
                // fire, use the full gap to space lines out. When we didn't
                // (no close pair OR cooldown), re-check sooner since the
                // race state can change quickly.
                if (p1 && p2) {
                    tProximity = now + PROXIMITY_GAP + Math.random() * 8000;
                } else {
                    tProximity = now + 4000;
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
        if (!isRacingLike(state.status) && !restoredIntoRacing) return;

        // Collect candidate crash markers via several selector strategies,
        // covering Torn's possible class variations (plain "status crash",
        // hashed module CSS like statusCrash___xyz, or crash-suffix patterns).
        const selectors = [
            '.status.crash',
            '[class*="status"][class*="crash"]',
            '[class*="statusCrash"]',
            '[class*="crashed"]',
            // Lone .crash element inside an lbr- racer row — catches Torn's
            // structure where the crash indicator is just <div class="crash">
            // without "status" being a sibling class on the same element
            'li[class*="lbr-"] .crash',
            'li[class*="lbr_"] .crash',
            // Some module-CSS schemes hash class names like _crash_xyz123
            'li[class*="lbr-"] [class^="crash"]',
            'li[class*="lbr-"] [class*=" crash"]',
            // Status-wrap with crash child — the spec's exact path
            'li[class*="status-wrap"] [class*="crash"]'
        ];
        const candidates = new Set();
        selectors.forEach(function (sel) {
            try {
                document.querySelectorAll(sel).forEach(function (el) { candidates.add(el); });
            } catch (_) {}
        });

        candidates.forEach(function (crashEl) {
            // Per spec, walk up to the enclosing racer row. Each row uses the
            // class pattern lbr-{id}; fall back to any <li>/driver/racer wrapper
            // if Torn's class scheme has shifted.
            const lbrRow = crashEl.closest('li[class*="lbr-"], li[class*="lbr_"]');
            const li = lbrRow ||
                       crashEl.closest('li') ||
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

            // Extract the racer name. Prefer the spec's structure
            // <li class="name"><span>name</span></li>; fall back to broader patterns.
            let name = '';
            const nameSelectors = [
                'li.name > span',
                'li[class*="name"] > span',
                'span.name',
                'span[class*="name"]',
                'a[class*="name"]',
                '[class*="name"] > span',
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

    // Per spec v2.82: scrape per-racer completion percentage from the
    // leaderboard rows so we can compute true proximity (gap in %) between
    // adjacent racers rather than just leaderboard-position adjacency.
    //
    // Torn's UI shows each racer's progress somewhere on their driver-item
    // row, but the exact selector has shifted across versions. We try
    // several strategies in order of specificity, returning the first one
    // that produces a sensible percentage. When nothing matches, the
    // returned object is empty and the caller falls back to the legacy
    // leaderboard-adjacent picking.
    //
    // Returns { [name]: pct } where pct is in [0, 100].
    function scrapeRacerCompletions () {
        const result = {};
        const rows = document.querySelectorAll(
            'ul.driver-item, ul[class*="driver-item"], ul[class*="driver_item"]'
        );
        if (!rows || !rows.length) return result;
        rows.forEach(function (row) {
            if (isInsideTornMenu(row)) return;
            if (looksLikeEventsRow(row)) return;
            const nameEl = row.querySelector('li.name > span, li.name, li[class*="name"] > span, li[class*="name"]');
            if (!nameEl) return;
            const name = (nameEl.textContent || '').trim();
            if (!name || name.length < 2 || name.length > 40) return;

            let pct = null;

            // Strategy 1: dedicated completion/progress element with text.
            const compEl = row.querySelector(
                'li.completion, li[class*="completion"], li.percent, li[class*="percent"], ' +
                'li.progress, li[class*="progress"]'
            );
            if (compEl) {
                const m = (compEl.textContent || '').match(/(\d+(?:\.\d+)?)\s*%?/);
                if (m) {
                    const v = parseFloat(m[1]);
                    if (!isNaN(v) && v >= 0 && v <= 100) pct = v;
                }
            }

            // Strategy 2: progress bar inline-style width (Torn often
            // renders progress as a div with style="width: 73.45%").
            if (pct === null) {
                const barEls = row.querySelectorAll('[style*="width"]');
                for (let i = 0; i < barEls.length; i++) {
                    const style = barEls[i].getAttribute('style') || '';
                    const m = style.match(/width:\s*(\d+(?:\.\d+)?)\s*%/);
                    if (m) {
                        const v = parseFloat(m[1]);
                        // Skip 100% width fillers (full-width containers).
                        // Also skip very small values that are probably
                        // decorative bars rather than progress.
                        if (!isNaN(v) && v > 0 && v < 100) { pct = v; break; }
                    }
                }
            }

            // Strategy 3: data-completion / data-progress / data-percent
            // attributes anywhere in the row.
            if (pct === null) {
                const dataEl = row.querySelector('[data-completion], [data-progress], [data-percent]');
                if (dataEl) {
                    const raw = dataEl.getAttribute('data-completion')
                        || dataEl.getAttribute('data-progress')
                        || dataEl.getAttribute('data-percent');
                    const v = parseFloat(raw);
                    if (!isNaN(v) && v >= 0 && v <= 100) pct = v;
                }
            }

            if (pct !== null) result[name] = pct;
        });
        return result;
    }

    // Per spec v2.82: from a set of racers and their completion %s, find
    // the adjacent pair (by completion order, front-to-back) with the
    // smallest gap and return it if the gap is within the threshold.
    // Returns { front, back, gap } or null if no pair qualifies.
    //
    // Racers are expected to come from state.racers (the leaderboard scrape)
    // and the result is filtered by what's actually present in `completions`.
    // Crashed and finished racers should have been filtered out of state.racers
    // by excludeCrashed() before calling this — but we belt-and-brace via
    // the completion map (anyone not in `completions` is silently skipped).
    function findClosestPair (racers, completions, thresholdPct) {
        if (!racers || racers.length < 2) return null;
        if (!completions || Object.keys(completions).length < 2) return null;
        // Build a sorted list (descending completion = front-to-back of race).
        const ranked = [];
        for (let i = 0; i < racers.length; i++) {
            const r = racers[i];
            if (!r || !r.name) continue;
            const c = completions[r.name];
            if (typeof c !== 'number') continue;
            ranked.push({ r: r, c: c });
        }
        if (ranked.length < 2) return null;
        ranked.sort(function (a, b) { return b.c - a.c; });
        let best = null;
        for (let i = 0; i < ranked.length - 1; i++) {
            const gap = ranked[i].c - ranked[i + 1].c;
            if (gap >= thresholdPct) continue;
            if (!best || gap < best.gap) {
                best = { front: ranked[i].r, back: ranked[i + 1].r, gap: gap };
            }
        }
        return best;
    }

    // Per-pair cooldown tracking for proximity announcements. Without this
    // a sustained close battle (which can last many seconds at 0.1% gap)
    // would refire the same line every poll. Keyed by sorted name pair.
    // Session-only — fine for the use case.
    let recentProximityPairs = {};
    const PROXIMITY_PAIR_COOLDOWN_MS = 25000;
    function proximityPairKey (a, b) {
        return [a, b].sort().join('|');
    }

    // Per spec v2.80: detect other racers crossing the finish line from the
    // DOM. The previous logic only added the PLAYER to knownFinishers when
    // ENDED status fired, which meant the lonely-finish branch (added in
    // v2.78) could never trigger — there was always exactly one "finisher"
    // (the player) but never any others to compare against.
    //
    // Spec-provided selector:
    //   div.cont-black.bottom-round
    //     div / ul.driver-item.driver-item_NEXT  (Torn uses both _ and - in
    //                                              class names depending on
    //                                              the page state)
    //       li.name   - the driver's name
    //       li.time   - format "00:00:00" when finished, empty/non-time
    //                   when still racing
    //
    // This runs on every racing poll. Adding to knownFinishers is idempotent
    // (Set semantics) so re-running is cheap.
    function detectOtherFinishers () {
        if (!isRacingLike(state.status)) return;
        // Iterate every driver row on the page. We accept both ul and div
        // hosts and both underscore and hyphen class-name variants because
        // Torn's racing UI has shipped both forms historically. The crash/
        // events-feed guards from the crash scraper apply here too.
        const rows = document.querySelectorAll(
            'ul.driver-item, ul[class*="driver-item"], ul[class*="driver_item"], ' +
            'div.driver-item, div[class*="driver-item"], div[class*="driver_item"]'
        );
        if (!rows || !rows.length) return;
        rows.forEach(function (row) {
            if (isInsideTornMenu(row)) return;
            if (looksLikeEventsRow(row)) return;
            // The time element only exists on finished rows. When present,
            // its text matches HH:MM:SS or MM:SS — both valid finish times
            // (a sub-hour race shows MM:SS in some Torn variants).
            const timeEl = row.querySelector('li.time, li[class*="time"]');
            if (!timeEl) return;
            const tText = (timeEl.textContent || '').trim();
            // Require a colon-separated time. Per spec v2.81, the actual
            // format Torn uses is MM:SS.ss (minutes:seconds.hundredths) —
            // e.g. "02:34.56" for a 2-minute 34.56-second race. The v2.80
            // regex only accepted colon-separated HH:MM:SS / MM:SS forms,
            // which is why finisher detection still wasn't firing.
            // Accepted variants:
            //   MM:SS.ss      — primary form per spec
            //   MM:SS         — defensive (some pages may omit hundredths)
            //   HH:MM:SS      — defensive for long races
            //   HH:MM:SS.ss   — defensive belt-and-braces
            if (!/^\d{1,2}:\d{2}(:\d{2})?(\.\d{1,2})?$/.test(tText)) return;
            // Now pull the name. Same defensive selectors as the leaderboard
            // scraper (li.name with possible inner span).
            const nameEl = row.querySelector('li.name > span, li.name, li[class*="name"] > span, li[class*="name"]');
            if (!nameEl) return;
            let name = (nameEl.textContent || '').trim();
            // Strip any stray prefixes ("You ", position numbers, etc.).
            if (!name || name.length < 2 || name.length > 40) return;
            if (/^\d+$/.test(name)) return;
            if (/^You(\s|$)/.test(name)) return;
            // Don't double-record. The player gets added by the existing
            // ENDED-status path; we just record non-player finishers here.
            if (name === state.playerName) return;
            if (knownFinishers.has(name)) return;
            if (otherCrashedNames.has(name)) return;
            // Record the finisher. We don't fire a "X crosses the line"
            // line here — per spec "It will not display other players who
            // finish afterwards." The detection is purely for state
            // tracking so the lonely-finish branch and commentary filtering
            // (excludeCrashed) can do their job.
            knownFinishers.add(name);
            // Push into state.finishers too, with whatever position info we
            // can muster. We don't strictly need the position for any
            // downstream logic, but maintaining the shape keeps state
            // serialisation consistent across versions.
            state.finishers.push({ name: name, time: tText });
        });
    }

    // Filter out crashed racers from any active racer list used for commentary.
    // Spec: "disregard them from the commentary, do not use their name again."
    // Per spec v2.78: ALSO filter out racers who've already finished the
    // race — "Do not include drivers ahead of the player if they finish the
    // race." Same principle: once they're out of the race (whether by crash
    // or by crossing the line), commentary about them is irrelevant.
    function excludeCrashed (racers) {
        if (!otherCrashedNames.size && (!knownFinishers || !knownFinishers.size)) return racers;
        return racers.filter(function (r) {
            if (otherCrashedNames.has(r.name)) return false;
            // Don't exclude the player themself from their own racer list
            // just because they've been recorded as a finisher in some race
            // state edge case.
            if (r.name !== state.playerName && knownFinishers.has(r.name)) return false;
            return true;
        });
    }

    // ─── Status transition ────────────────────────────────────────────────────────
    const CLEAR_ON_ENTRY = [S.COUNTDOWN, S.PRE_LAUNCH, S.RACING, S.RACE_REPLAY];

    function onStatusChange (oldSt, newSt) {
        resetTimers();
        // Always reset the WAITING confirmation counter on any status transition
        waitingSeenCount = 0;

        // Per spec: when leaving IN_GARAGE / TORN_DOWN / STATISTICS / ENLISTED,
        // clear commentary on exit so the quiet-status messages don't linger
        // alongside whatever the new status produces. Most new-status entry
        // handlers already call clearFeed(), but this exit-clear runs first
        // and unconditionally — defence-in-depth in case a future entry handler
        // is added that doesn't clear.
        const CLEAR_ON_EXIT_FROM = [S.IN_GARAGE, S.TORN_DOWN, S.STATISTICS, S.ENLISTED];
        if (oldSt && CLEAR_ON_EXIT_FROM.indexOf(oldSt) !== -1 && oldSt !== newSt) {
            clearFeed();
        }

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
                // Reset throttle gate timestamp for the new race.
                throttleNextAllowedAt = 0;
                // Per spec v2.82: proximity pair cooldowns are race-scoped.
                // Clearing on race entry stops a battle from race N still
                // suppressing the same name-pair if it recurs in race N+1.
                recentProximityPairs = {};
                // Per spec v2.83: re-arm the start-grid window on race
                // entry. raceStartedAt gets stamped when status actually
                // hits RACING; here we just ensure stale values from a
                // previous race don't leak in.
                state.raceStartedAt = 0;
                state.startGridLinesFired = 0;
                state.racers = [];
                state.prevRacers = [];
                state.racerCount = 0;
                state.raceFieldSize = 0;
                state.prevLapNumber = 0;
                state.lapTimesSec = [];
                state.totalLaps = 0;
                state.nextLapMsgAt = 0;
                state.nextAvgLapAt = 0;
                state.lastAvgSec = 0;

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
            const validName = state.playerName !== '—' && state.playerName !== ''
                && !NAME_BLACKLIST.test(state.playerName);
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
                // Per spec v2.83: arm the start-grid window. ambient
                // dispatch will draw from LINES.RACING.startGrid for the
                // next few seconds, then revert to normal RACING ambient.
                // restoredIntoRacing skip means a mid-race page refresh
                // won't trigger start-grid lines — the race is already
                // underway and start commentary would read wrong.
                state.raceStartedAt = Date.now();
                state.startGridLinesFired = 0;
            }
        }
        if (newSt === S.RACE_REPLAY && oldSt !== S.RACE_REPLAY) {
            // Replays are treated like RACING for commentary, but with a
            // dedicated entry line so the user knows what they're watching.
            clearFeed();
            const tn = state.track !== '—' ? state.track : 'this circuit';
            pushLine('Replay rolling — race action on ' + tn + '!', 'status', ICON.flag);
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
        if (newSt === S.JAIL && oldSt !== S.JAIL) {
            clearFeed();
            // Jail: single line, then no further commentary until the page
            // returns to a normal status. Per spec v2.71 — plain text, no
            // hyperlink (unlike HOSPITAL).
            pushLine('You are in jail, no access to racing right now.', 'status', '', true);
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
            pushLine(safeName + ' attempts to squeeze his car onto the race.', 'status');
            pushLine('Armed marshalls draw their weapons.', 'status');
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
        if (newSt === S.NOT_ALLOWED && oldSt !== S.NOT_ALLOWED) {
            clearFeed();
            const safeName = (state.playerName !== '—' && state.playerName)
                ? state.playerName : 'The driver';
            const safeCar = (state.car !== '—' && state.car) ? state.car : 'car';
            pushLine(safeName + ' drives onto the paddock in their ' + safeCar + '.', 'status');
            pushLine('Marshalls frantically point towards the exit.', 'status');
            pushLine('"Can\'t you read the race specs. You fool"', 'status');
            pushLine('Incorrect car chosen.', 'status');
        }
        if (newSt === S.TORN_DOWN && oldSt !== S.TORN_DOWN) {
            clearFeed();
            pushLine('Please wait.', 'status');
        }
        if (newSt === S.IN_GARAGE && oldSt !== S.IN_GARAGE) {
            clearFeed();
            pushLine('Lots of modification available here.', 'status');
        }
        if (newSt === S.STATISTICS && oldSt !== S.STATISTICS) {
            clearFeed();
            pushLine(fill('{player} checks out the leaderboards and track statistics.'), 'status');
        }
        if (newSt === S.ENLISTED && oldSt !== S.ENLISTED) {
            clearFeed();
            pushLine(fill("{player}'s cars glimmer in their garage."), 'status');
            pushLine('Now... which one to use.', 'status');
        }
    }

    // ─── Finishers ────────────────────────────────────────────────────────────────
    // Template pool for the AI-style race summary — second of the four outro
    // lines. A Tampermonkey userscript cannot embed an Anthropic API key in
    // public source (anyone could read and abuse it), so genuine LLM-generated
    // summaries are not feasible here. Instead these templates are written in
    // commentator voice and filled with race-specific data (player, track,
    // position, field size, top finishers). The pool is large enough that
    // repeats are uncommon, and the dedupe machinery in pickLine respects
    // recentByType so consecutive races don't get identical summaries.
    const OUTRO_SUMMARIES = [
        // 3-sentence templates. Each sentence-end is a real full stop so the
        // line reads naturally even when tokens fail to resolve.
        "What a contest we have witnessed today on {track}. {player} battled through a field of {total} and came home in {pos}. The crowd will remember this one for some time.",
        "{track} put on a show, ladies and gentlemen. {player} fought hard and finished {pos} out of {total}. Performances like that are what bring the punters back race after race.",
        "An absolute belter of a race on {track}. {player} crossed the line in {pos} after a frantic battle. The standard of driving today was truly something to behold.",
        "Drama, speed, and a touch of madness — that was the story on {track} today. {player} took {pos} from a field of {total}. We have seen some racing here, my goodness.",
        "From flag to flag, {track} delivered everything we hoped for. {player} secured {pos} in a {total}-driver scrap. A worthy result on a tough circuit.",
        "If you missed this one on {track}, you missed something special. {player} brought it home in {pos} amidst a frantic field of {total}. Pure racing entertainment from start to finish.",
        "The chequered flag has fallen on {track}, and what a race it was. {player} fought tooth and nail to claim {pos}. Every position out there was earned, not given.",
        "Today's race on {track} had everything we love about this sport. {player} finishes in {pos} of {total} after a relentless battle. Tip of the cap to every driver who lined up today.",
        "Sometimes a race rewrites the form book — this was one of those days at {track}. {player} took {pos} from a {total}-strong field. Memorable scenes from start to finish.",
        "Hold onto your hats — {track} just served up a thriller. {player} settled into {pos}, fighting every inch of the way. That, my friends, is why we tune in week after week."
    ];

    // pickSummary selects a templated outro summary that hasn't been used
    // recently, fills in the race-specific tokens, and returns the result.
    function pickSummary () {
        try {
            const template = pickLine(OUTRO_SUMMARIES, 'outro');
            // Fill tokens manually here so we control which fields are available
            const total = state.raceFieldSize || state.racerCount || state.finishers.length || '?';
            const playerFinish = state.finishers.find(function (f) { return f.name === state.playerName; });
            const posNum = playerFinish ? playerFinish.pos : (parseInt(state.position, 10) || 0);
            const safePlayer = (state.playerName && state.playerName !== '—' && !NAME_BLACKLIST.test(state.playerName))
                ? state.playerName : 'The driver';
            const safeTrack = (state.track && state.track !== '—') ? state.track : 'this circuit';
            return template
                .replace(/\{player\}/g, safePlayer)
                .replace(/\{track\}/g, safeTrack)
                .replace(/\{pos\}/g, posNum > 0 ? ordinal(posNum) : 'a strong position')
                .replace(/\{total\}/g, total);
        } catch (e) {
            console.error('[TC Race Commentary] pickSummary:', e);
            // Conservative fallback if anything throws — keeps the outro flowing.
            return 'A truly memorable contest from start to finish. Hard racing throughout, and every driver gave their all. We will not forget this one in a hurry.';
        }
    }

    function processFinishers (scraped) {
        // Per spec rewrite: this function is now PLAYER-ONLY. We do NOT print
        // finish-line lines for other racers. We watch only for the player's
        // own crossing, fire one line for them, then trigger the 4-line outro
        // sequence (1s pauses between, all in white text). This change makes
        // the outro deterministic: it always fires after the player crosses,
        // regardless of which other racers Torn is currently displaying.
        if (state.outroShown) return;
        const pname = state.playerName;
        if (!pname || pname === '—' || NAME_BLACKLIST.test(pname)) return;

        // Check if the player is in the scraped finisher list. If yes, capture
        // their position. If no, fall back to using state.position when ENDED.
        let playerFinish = null;
        for (let i = 0; i < scraped.length; i++) {
            if (scraped[i].name === pname) {
                playerFinish = scraped[i];
                break;
            }
        }
        if (!playerFinish && state.status === S.ENDED) {
            const fromPos = parseInt(state.position, 10);
            if (fromPos > 0) playerFinish = { name: pname, pos: fromPos };
        }
        if (!playerFinish) return;

        // Only fire the player-cross line once.
        if (!knownFinishers.has(pname)) {
            knownFinishers.add(pname);
            state.finishers.push(playerFinish);
            pushLine(
                pname + ' crosses the finish line in ' + ordinal(playerFinish.pos) + '!',
                'finish', ICON.flag
            );
        }

        // Fire the 4-line outro sequence with 1-second pauses between lines.
        // All four lines render in white via the 'outro' type (see CSS).
        state.outroShown = true;
        saveState();
        // Stagger: line1 immediate (after the cross line just pushed), line2 +1s,
        // line3 +2s, line4 +3s. We use 1000/2000/3000/4000ms offsets from the
        // start so that the cross-line has visible breathing room before line1.
        const summary = pickSummary();
        setTimeout(function () {
            try { pushLine('That was a fantastic race, ladies and gentlemen!', 'outro'); }
            catch (e) { console.error('[TC RC] outro 1:', e); }
        }, 1000);
        setTimeout(function () {
            try { pushLine(summary, 'outro'); }
            catch (e) { console.error('[TC RC] outro 2:', e); }
        }, 2000);
        setTimeout(function () {
            try { pushLine('Thank you for tuning in.', 'outro'); }
            catch (e) { console.error('[TC RC] outro 3:', e); }
        }, 3000);
        setTimeout(function () {
            try {
                pushLine('Brought to you by Sanxion [2987640].', 'outro');
                saveState();
            } catch (e) { console.error('[TC RC] outro 4:', e); }
        }, 4000);
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
        // Per-poll cache: return memoised text if computed already this tick.
        // The cache is invalidated at the top of poll() so it can never serve
        // stale data across ticks. This is the primary memory-leak fix —
        // previously each poll cloned the body ~11 times.
        if (pollTextCache !== null) return pollTextCache;
        if (!document.body) {
            pollTextCache = '';
            return '';
        }
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
            pollTextCache = raw;
            return raw;
        } catch (_) {
            const fallback = document.body.innerText || '';
            pollTextCache = fallback;
            return fallback;
        }
    }

    function scrapeName () {
        const m = getPageText().match(/Name:\s+([A-Za-z0-9_\-[\]]+)/);
        if (!m) return null;
        const candidate = m[1].trim();
        if (NAME_BLACKLIST.test(candidate)) return null;
        return candidate;
    }

    // Pulls a human-readable countdown / race-time-remaining string from the
    // page text. Used by the {countdown} template token. Tries the PRE-LAUNCH
    // "Race will Start in X" pattern first, then the COUNTDOWN long-form
    // duration pattern. Returns null if neither is found.
    function scrapeCountdown () {
        if (pollCountdownCache !== undefined && pollCountdownCache !== null) {
            return pollCountdownCache === '__null__' ? null : pollCountdownCache;
        }
        try {
            const text = getPageText();
            // PRE-LAUNCH: "Race will Start in 1 minute 48 seconds" / "...48 seconds"
            const m1 = text.match(/Race\s+will\s+Start\s+in\s+([^.\n\r]+?seconds?)/i);
            if (m1) { pollCountdownCache = m1[1].trim(); return pollCountdownCache; }
            // COUNTDOWN: "Docks - 100 laps - 1 hours, 17 minutes, 10 seconds"
            const m2 = text.match(/-\s+\d+\s+laps?\s+-\s+([^.\n\r]+?seconds?)/i);
            if (m2) { pollCountdownCache = m2[1].trim(); return pollCountdownCache; }
            pollCountdownCache = '__null__';
            return null;
        } catch (_) {
            pollCountdownCache = '__null__';
            return null;
        }
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
        // Torn site-wide outage: when Torn itself is down, racing isn't possible.
        // Highest-priority detection so we don't try to interpret half-rendered DOM.
        if (/torn\s+is\s+currently\s+down/i.test(text)) {
            return S.TORN_DOWN;
        }
        // Hospital: player can't race at all while in hospital.
        // Torn currently shows "This page is not available while in hospital."
        // Older versions of the page showed "You cannot do this while in hospital."
        // Match the common stable substring "while in hospital" which appears in
        // both forms and is unique enough not to false-positive elsewhere.
        if (/while\s+in\s+hospital/i.test(text)) {
            return S.HOSPITAL;
        }
        // Jail: the player is in jail (per spec v2.71). The page shows
        // "This page is not available while in jail". Same shape as the
        // hospital lockout — single line, no further commentary until the
        // page returns to a normal status. Match the stable substring
        // "while in jail" which is unique enough to not false-positive.
        if (/while\s+in\s+jail/i.test(text)) {
            return S.JAIL;
        }
        // Race timed out: a previous race attempt failed to start
        if (/your\s+last\s+race\s+timed\s+out\s+at/i.test(text)) {
            return S.TIMED_OUT;
        }
        // Not allowed: incorrect car for the chosen race. Must be checked BEFORE
        // the "Incorrect race" check below since both share the "Incorrect" prefix.
        if (/incorrect\s+car/i.test(text)) {
            return S.NOT_ALLOWED;
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
        // In garage: player is browsing the racing modifications page.
        // Detected by the garage's racing-points header text.
        if (/you\s+have\s+\d[\d,]*\s+racing\s+points\s+available/i.test(text)) {
            return S.IN_GARAGE;
        }
        // Statistics: player is on the racing leaderboards / statistics page.
        if (/racing\s+leaderboards/i.test(text) || /race\s+statistics/i.test(text)) {
            return S.STATISTICS;
        }
        // Enlisted cars: player is viewing their owned cars page.
        if (/your\s+enlisted\s+cars/i.test(text)) {
            return S.ENLISTED;
        }
        // Travel block: when the player is flying or abroad, Torn shows
        // "This page is unavailable while you're traveling." — racing isn't
        // possible during travel so return a dedicated UNAVAILABLE status.
        if (/this\s+page\s+is\s+unavailable\s+while\s+you'?re\s+travel(l)?ing/i.test(text)) {
            return S.UNAVAILABLE;
        }
        // CRASHED detection (player) — text-based fallback. Per spec, look for
        // the literal "You Crashed!" announcement on the page. This catches
        // the player's own crash even when the DOM markers haven't propagated
        // (or use a class scheme we don't recognise). The page text from
        // getPageText() already has Events-feed pollution scrubbed (via
        // EVENTS_TEXT_PATTERN), so this match is from the live racing UI.
        if (/you\s+crashed\s*!/i.test(text)) {
            return S.CRASHED;
        }

        // CRASHED detection (player): per spec, walk the precise DOM hierarchy.
        // Each racer row is an <li class="lbr-{id}"> containing an
        // <li class="status-wrap"> with a <div class="status crash"> when that
        // racer has crashed. The racer's name lives in a sibling
        // <li class="name"><span>{playername}</span></li> within the same lbr- row.
        // To activate CRASHED for the player: find a crash marker, walk up to
        // the enclosing lbr- row, then check the .name span matches the player.
        const crashMarkers = document.querySelectorAll(
            'div.status.crash, div[class*="status"][class*="crash"], ' +
            '[class*="statusCrash"], [class*="crashed"], [class*="wrecked"], ' +
            'li[class*="lbr-"] .crash, li[class*="lbr_"] .crash, ' +
            'li[class*="lbr-"] [class^="crash"], li[class*="lbr-"] [class*=" crash"], ' +
            'li[class*="status-wrap"] [class*="crash"]'
        );
        for (let i = 0; i < crashMarkers.length; i++) {
            const m = crashMarkers[i];
            // Skip our own HUD and Torn's notification dropdowns
            if (m.closest('#tc-rc-hud')) continue;
            if (isInsideTornMenu(m)) continue;
            // Walk up to the enclosing racer row. Try the spec's lbr- pattern
            // first, then fall back to any <li> ancestor.
            const lbrRow = m.closest('li[class*="lbr-"], li[class*="lbr_"]');
            const li = lbrRow || m.closest('li') ||
                       m.closest('[class*="driver"]') || m.closest('[class*="racer"]');
            if (!li) continue;
            if (looksLikeEventsRow(li)) continue;
            // Try to extract the racer's name from the same row using the
            // spec's nested structure: <li class="name"><span>...</span></li>.
            // Fall back to any element with class "name" containing a span.
            const nameSpan = li.querySelector('li.name > span, li[class*="name"] > span, [class*="name"] > span');
            const rowName = nameSpan ? nameSpan.textContent.trim() : '';
            // Activate CRASHED if the row's name matches the player. Fall back
            // to a substring check on the row's full text if the structured
            // selector didn't find a name (defends against Torn DOM tweaks).
            if (state.playerName && state.playerName !== '—'
                && !NAME_BLACKLIST.test(state.playerName)) {
                if (rowName === state.playerName) return S.CRASHED;
                if (!rowName) {
                    try {
                        const liText = (li.textContent || '');
                        // Use word-boundary match so "Sanxion" doesn't match "Sanxion42"
                        const re = new RegExp('\\b' + state.playerName
                            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
                        if (re.test(liText)) return S.CRASHED;
                    } catch (_) {}
                }
            }
        }
        if (/race\s+finished/i.test(text) || /you\s+finished\s+in\s+\d/i.test(text) || document.querySelector('[class*="raceEnd"], [class*="raceFinished"]')) return S.ENDED;
        // RACE REPLAY: a recorded replay of an earlier race. Behaves like RACING
        // but gets a distinct status label. Detected by the "Race Replay" page
        // marker. Checked BEFORE the live-race detection so a replay isn't
        // mistaken for an in-progress race.
        //
        // Bug fix v2.70: a paused replay swaps the page text from
        // "Race replaying" to "Race paused" (per spec clarification — "the
        // text shown is 'Race paused' instead of 'Race replaying'"). With
        // only the "race replay" check, the paused state fell through to
        // RACING and the auto-pause detection (gated on RACE_REPLAY) never
        // fired. We now also treat "Race paused" as a replay marker so the
        // status stays RACE_REPLAY through the pause and the pause-detect
        // block in poll() picks it up and surfaces "Replay Paused". Note
        // that "Race paused" is specific enough to only appear in the
        // replay context — no risk of false-matching during a live race.
        if (/race\s+replay/i.test(text)
                || /\brace\s+paused\b/i.test(text)
                || document.querySelector('[class*="raceReplay"], [class*="race-replay"]')) {
            return S.RACE_REPLAY;
        }
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
        // Reset the per-poll cache so getPageText/scrapeCountdown each compute
        // exactly once per tick instead of per-call. See pollTextCache for
        // memory-leak background.
        invalidatePollCache();
        const newName = scrapeName();
        const newTrack = scrapeTrack();
        const newCar = scrapeCar();
        const posData = scrapePosition();
        const newRacers = scrapeRacers();
        const newStatus = detectStatus();

        if (newName) state.playerName = newName;
        if (newTrack) state.track = newTrack;
        // Only update car when we're in an active race context.
        // While browsing car selection in MENU, or on the modifications/garage,
        // statistics, or enlisted-cars pages, the scraper can pick up unrelated
        // car-list entries and show them incorrectly in the display. Freeze the
        // CAR display on those pages — keep whatever was last shown.
        const carFrozenStatuses = [S.MENU, S.IN_GARAGE, S.STATISTICS, S.ENLISTED, S.RACE_REPLAY];
        if (newCar && carFrozenStatuses.indexOf(newStatus) === -1) state.car = newCar;

        if (posData) {
            state.position = posData.pos;
            // *** ONLY source of racerCount — Position: X/Y from the page ***
            // Always trust this value; it's the authoritative Torn count.
            if (posData.total > 0) {
                state.racerCount = posData.total;
                // Latch the maximum field size seen during the race — used for
                // the outro threshold so we wait for ALL racers to cross the line.
                if (posData.total > state.raceFieldSize) {
                    state.raceFieldSize = posData.total;
                }
            }
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
                if (isRacingLike(newStatus)) {
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
                // Per spec v2.80: scrape finish times the same way so the
                // lonely-finish branch can see other racers crossing the line.
                detectOtherFinishers();
            }
            // Filter out crashed AND finished racers from the active commentary
            // list. Both are out of the race and shouldn't appear in lines
            // about position changes, proximity, or movement.
            if (otherCrashedNames.size || (knownFinishers && knownFinishers.size)) {
                state.racers = excludeCrashed(state.racers);
                state.prevRacers = excludeCrashed(state.prevRacers);
            }
        }

        // Blank stats in all menu/error/quiet statuses
        const blankStatsStatuses = [S.MENU, S.UNAVAILABLE, S.HOSPITAL, S.JAIL, S.TIMED_OUT,
            S.ALREADY_STARTED, S.RACE_FULL, S.NOT_ENOUGH_FUNDS, S.NOT_ALLOWED,
            S.TORN_DOWN, S.IN_GARAGE, S.STATISTICS, S.ENLISTED];
        if (blankStatsStatuses.indexOf(newStatus) === -1) {
            const ll = scrapeLastLap();
            const cl = scrapeCurrentLap();
            const co = scrapeCompletion();
            if (ll) state.lastLap = ll;
            if (cl) state.currentLap = cl;
            if (co && state.completion !== '100%') state.completion = formatCompletion(co);

            // Lap-time commentary (per spec v2.66). DEFAULTS to firing every
            // lap from lap 2 onwards with a basic "completed lap N in TT" line.
            // At cadenced intervals (8-12 laps for 50+ races, 2-6 laps for
            // shorter races) the message UPGRADES to a comparison (faster/
            // slower/same vs the previous lap). Occasionally, an eligible
            // comparison lap UPGRADES further to a running-average line, with
            // a hard cap of 25% of total race laps. Restricted to RACING/
            // RACE_REPLAY.
            if (cl && isRacingLike(newStatus)) {
                // currentLap is in "47/100" form; capture both halves.
                const parts = cl.split('/');
                const lapNumNow = parseInt(parts[0], 10);
                const totalNow = parseInt(parts[1], 10);
                if (totalNow > 0) state.totalLaps = totalNow;
                if (lapNumNow > 0 && lapNumNow > state.prevLapNumber) {
                    // A new lap has just started — capture the previous lap's
                    // time into the history BEFORE deciding commentary, so
                    // {delta} and {avgTime} reflect the freshly-completed lap.
                    if (state.prevLapNumber >= 1
                        && state.lastLap && state.lastLap !== '—') {
                        const sec = parseLapTimeToSeconds(state.lastLap);
                        if (sec > 0) {
                            state.lapTimesSec.push(sec);
                            if (state.lapTimesSec.length > 200) {
                                state.lapTimesSec = state.lapTimesSec.slice(-200);
                            }
                        }
                    }

                    // Fire commentary from lap 2 onwards.
                    if (state.prevLapNumber >= 1 && !commentaryPaused && !replayPausedAuto) {
                        // Initialise the comparison cadence target on the first
                        // eligible transition (when nextLapMsgAt is still 0).
                        if (state.nextLapMsgAt === 0) {
                            state.nextLapMsgAt = lapNumNow + rollLapMessageGap(state.totalLaps);
                        }
                        // Per spec v2.67: average cadence starts from lap 5,
                        // every 2-4 laps. Initialise nextAvgLapAt the moment
                        // we reach lap 5 — first average fires AT lap 5.
                        if (state.nextAvgLapAt === 0 && lapNumNow >= 5) {
                            state.nextAvgLapAt = lapNumNow;
                        }
                        const comparisonEligible = (lapNumNow >= state.nextLapMsgAt);
                        const averageEligible = (state.nextAvgLapAt > 0
                            && lapNumNow >= state.nextAvgLapAt
                            && state.lapTimesSec.length >= 3);

                        try {
                            let poolKey, typeKey;
                            // Bug fix v2.73: track the new average to assign
                            // AFTER pushLine() runs. If we set state.lastAvgSec
                            // before pushLine, fill() computes avgComparison
                            // by diffing current avg against the just-overwritten
                            // value (diff = 0), returns empty string, and the
                            // template renders ". ." at the end — the reported
                            // double-stop bug. Deferring keeps fill() correct.
                            let pendingLastAvgSec = null;

                            // PRIORITY: average > comparison > basic. The
                            // average line is the most informative on its lap;
                            // showing both an avg and a comparison on the same
                            // lap would just be redundant noise.
                            if (averageEligible) {
                                // First-ever average vs subsequent (compared)
                                // average. lastAvgSec === 0 means no prior
                                // reading; we'll record one after firing.
                                if (state.lastAvgSec === 0) {
                                    poolKey = 'lapTimeAverageFirst';
                                    typeKey = 'lapTimeAverageFirst';
                                } else {
                                    // Compute current average to decide which
                                    // pool — Level (within 0.5s) or compared.
                                    const arrSel = state.lapTimesSec;
                                    let totalSel = 0;
                                    for (let i = 0; i < arrSel.length; i++) totalSel += arrSel[i];
                                    const curAvg = totalSel / arrSel.length;
                                    if (Math.abs(curAvg - state.lastAvgSec) < 0.5) {
                                        // Per spec v2.68: dedicated wording
                                        // for the "level" case.
                                        poolKey = 'lapTimeAverageLevel';
                                        typeKey = 'lapTimeAverageLevel';
                                    } else {
                                        poolKey = 'lapTimeAverage';
                                        typeKey = 'lapTimeAverage';
                                    }
                                }
                                // Bug fix v2.73: compute the new lastAvgSec
                                // value here but DO NOT assign it yet. fill()
                                // computes the {avgComparison} token by
                                // diffing current avg against state.lastAvgSec
                                // — if we overwrite lastAvgSec first, that
                                // diff would always be zero and avgComparison
                                // would return '', leaving the rendered line
                                // ending in ". ." (the reported double-stop
                                // bug). Assigning AFTER pushLine() ensures
                                // fill() sees the previous reading.
                                const arr = state.lapTimesSec;
                                let total = 0;
                                for (let i = 0; i < arr.length; i++) total += arr[i];
                                const newAvgSec = total / arr.length;
                                state.nextAvgLapAt = lapNumNow + rollAverageLapGap();
                                // Stash newAvgSec for the post-push assignment.
                                // Using a local rather than mutating
                                // state.lastAvgSec now keeps fill() seeing
                                // the prior value (essential for the
                                // {avgComparison} token to render correctly).
                                pendingLastAvgSec = newAvgSec;
                            } else if (comparisonEligible) {
                                const arr = state.lapTimesSec;
                                if (arr.length < 2) {
                                    poolKey = 'lapTimeBasic';
                                    typeKey = 'lapTimeBasic';
                                } else {
                                    const diff = arr[arr.length - 1] - arr[arr.length - 2];
                                    if (Math.abs(diff) < 0.5) {
                                        poolKey = 'lapTimeSame'; typeKey = 'lapTimeSame';
                                    } else if (diff < 0) {
                                        poolKey = 'lapTimeFaster'; typeKey = 'lapTimeFaster';
                                    } else {
                                        poolKey = 'lapTimeSlower'; typeKey = 'lapTimeSlower';
                                    }
                                }
                                state.nextLapMsgAt = lapNumNow + rollLapMessageGap(state.totalLaps);
                            } else {
                                // DEFAULT: every-lap basic line.
                                poolKey = 'lapTimeBasic';
                                typeKey = 'lapTimeBasic';
                            }

                            const pool = LINES.RACING[poolKey];
                            if (pool && pool.length) {
                                const picked = pickLine(pool, typeKey);
                                pushLine(fill(picked), 'lapTime', ICON.stopwatch);
                            }
                            // Now safe to commit the deferred average update —
                            // fill() has already rendered using the previous
                            // value (see Bug fix v2.73 note above).
                            if (pendingLastAvgSec !== null) {
                                state.lastAvgSec = pendingLastAvgSec;
                            }
                        } catch (e) { console.error('[TC RC] lap-time:', e); }
                    }
                    state.prevLapNumber = lapNumNow;
                }
            }
        } else {
            state.lastLap = '—';
            state.currentLap = '—';
            state.completion = '—';
        }

        // Replay pause/resume detection (per spec v2.69). During RACE_REPLAY,
        // Torn can pause the replay — page text shows "Race paused". When
        // detected we auto-pause commentary and surface a "Replay Paused"
        // line. When "Race replaying" appears the auto-pause clears with a
        // "Replay Resumed" line. The replayPausedAuto flag is kept separate
        // from the manual commentaryPaused so neither one disturbs the other.
        // Outside RACE_REPLAY, any lingering auto-pause is cleared silently
        // (e.g. user navigates away from the replay page).
        try {
            if (newStatus === S.RACE_REPLAY) {
                const text = getPageText();
                // Order matters slightly: check "Race paused" first since
                // "Race replaying" is the more verbose phrase and an unlikely
                // accidental substring match for "paused".
                const isPaused = /\brace\s+paused\b/i.test(text);
                const isReplaying = /\brace\s+replaying\b/i.test(text);
                if (isPaused && !replayPausedAuto) {
                    replayPausedAuto = true;
                    // "Replay Paused" line bypasses the pause filter because
                    // pushLine treats type 'status' as always-show.
                    pushLine('Replay Paused', 'status');
                } else if (isReplaying && replayPausedAuto) {
                    replayPausedAuto = false;
                    pushLine('Replay Resumed', 'status');
                }
            } else if (replayPausedAuto) {
                // Left RACE_REPLAY status — clear silently. The user has
                // navigated away or the replay ended; no point firing a
                // resume message in a different context.
                replayPausedAuto = false;
            }
        } catch (e) { console.error('[TC RC] replay pause detect:', e); }

        if (newStatus !== currentStatus) {
            // Update state.status BEFORE firing the transition handler so that
            // any pushLine() calls inside the handler see the new status. This
            // matters for effectiveScrollDirection() which forces top-down
            // rendering for certain quiet statuses (HOSPITAL, RACE_FULL, etc.).
            state.status = newStatus;
            onStatusChange(currentStatus, newStatus);
            currentStatus = newStatus;
        }

        if (state.status === S.ENDED) processFinishers(scrapeFinishers());

        // Scrape Torn's .status.crash DOM markers unconditionally each poll —
        // catches crashes even if newRacers was briefly empty this tick,
        // and catches any crash already in the DOM after a page refresh.
        if (isRacingLike(state.status) || restoredIntoRacing) {
            detectOtherCrashes();
            // Per spec v2.80: same parallel call so finishers are picked up
            // here too. This branch runs when scraping fails through the
            // primary leaderboard route (e.g. on a refresh during a race).
            detectOtherFinishers();
            if (otherCrashedNames.size || (knownFinishers && knownFinishers.size)) {
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
            [S.RACE_REPLAY]: { label: 'RACE REPLAY', cls: 'st-replay' },
            [S.ENDED]: { label: 'ENDED', cls: 'st-ended' },
            [S.CRASHED]: { label: 'CRASHED', cls: 'st-crashed' },
            [S.UNAVAILABLE]: { label: 'UNAVAILABLE', cls: 'st-unavailable' },
            [S.HOSPITAL]: { label: 'HOSPITAL', cls: 'st-hospital' },
            [S.JAIL]: { label: 'IN JAIL', cls: 'st-jail' },
            [S.TIMED_OUT]: { label: 'TIMED OUT', cls: 'st-timedout' },
            [S.ALREADY_STARTED]: { label: 'TOO LATE', cls: 'st-toolate' },
            [S.RACE_FULL]: { label: 'RACE FULL', cls: 'st-racefull' },
            [S.NOT_ENOUGH_FUNDS]: { label: 'INSUFFICIENT FUNDS', cls: 'st-nofunds' },
            [S.NOT_ALLOWED]: { label: 'NOT ALLOWED', cls: 'st-notallowed' },
            [S.TORN_DOWN]: { label: 'RECONNECTING TO RACETRACK', cls: 'st-torndown' },
            [S.IN_GARAGE]: { label: 'IN GARAGE', cls: 'st-garage' },
            [S.STATISTICS]: { label: 'STATISTICS', cls: 'st-stats' },
            [S.ENLISTED]: { label: 'ENLISTED CARS', cls: 'st-enlisted' }
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
        if (state.status === S.JAIL) { el.innerHTML = '<div class="tc-lb-empty">In jail.</div>'; return; }
        if (state.status === S.TIMED_OUT) { el.innerHTML = '<div class="tc-lb-empty">Race timed out.</div>'; return; }
        if (state.status === S.ALREADY_STARTED) { el.innerHTML = '<div class="tc-lb-empty">Race already started.</div>'; return; }
        if (state.status === S.RACE_FULL) { el.innerHTML = '<div class="tc-lb-empty">Race full.</div>'; return; }
        if (state.status === S.NOT_ENOUGH_FUNDS) { el.innerHTML = '<div class="tc-lb-empty">Insufficient funds.</div>'; return; }
        if (state.status === S.NOT_ALLOWED) { el.innerHTML = '<div class="tc-lb-empty">Incorrect car.</div>'; return; }
        if (state.status === S.TORN_DOWN) { el.innerHTML = '<div class="tc-lb-empty">Reconnecting\u2026</div>'; return; }
        if (state.status === S.IN_GARAGE) { el.innerHTML = '<div class="tc-lb-empty">In the garage.</div>'; return; }
        if (state.status === S.STATISTICS) { el.innerHTML = '<div class="tc-lb-empty">Viewing statistics.</div>'; return; }
        if (state.status === S.ENLISTED) { el.innerHTML = '<div class="tc-lb-empty">Choosing a car.</div>'; return; }
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

    // Per spec v2.79: "Show which key is active, and show summary line of
    // what has been retrieved." This populates the diagnostic block on the
    // settings page with the inferred key tier and counts of cached data.
    // Called whenever the settings panel is opened so the user sees current
    // truth, not a stale snapshot.
    //
    // Tier inference:
    //   - No key entered → "No key"
    //   - carsOK true → Minimal key (the /v2/user/enlistedcars endpoint
    //                   only succeeds with minimal or higher access)
    //   - tracksOK or recordsOK true → Public key (these endpoints are
    //                   public and need no user-data scope)
    //   - Key entered but no flags yet → "Detecting…" (first poll hasn't
    //                   returned, or the key is invalid — same UX either way
    //                   until enough time has passed)
    function refreshKeyDiagnostic () {
        const el = document.getElementById('tc-key-diag');
        if (!el) return;

        const key = getApiKey();
        // Build tier headline.
        let tier = '';
        let tierColor = 'var(--c-dim)';
        if (!key) {
            tier = 'No key entered';
            tierColor = 'var(--c-orange)';
        } else if (keyAccessFlags.carsOK) {
            tier = 'Minimal key (full access)';
            tierColor = 'var(--c-green)';
        } else if (keyAccessFlags.tracksOK || keyAccessFlags.recordsOK) {
            tier = 'Public key (limited access)';
            tierColor = 'var(--c-blue)';
        } else {
            tier = 'Key set, awaiting first response\u2026';
            tierColor = 'var(--c-orange)';
        }

        // Build summary of what's been retrieved.
        const lines = [];
        if (tracksCache && Array.isArray(tracksCache.tracks) && tracksCache.tracks.length) {
            lines.push(tracksCache.tracks.length + ' track descriptions cached');
        }
        if (recordsCache && recordsCache.byKey) {
            const recKeys = Object.keys(recordsCache.byKey);
            if (recKeys.length) {
                let recordsTotal = 0;
                for (let i = 0; i < recKeys.length; i++) {
                    const block = recordsCache.byKey[recKeys[i]];
                    if (block && Array.isArray(block.records)) recordsTotal += block.records.length;
                }
                lines.push(recordsTotal + ' track records across ' + recKeys.length + ' (track, class) keys');
            }
        }
        if (carsCache && Array.isArray(carsCache.cars) && carsCache.cars.length) {
            lines.push(carsCache.cars.length + ' enlisted cars cached');
        }

        // Build current-context detail (if available) — useful for
        // "is this actually working" debugging without opening the console.
        const detail = [];
        const car = getPlayerCarData();
        if (car) {
            detail.push('Current car: ' + escH(car.car_item_name || '?')
                + ' (Class ' + escH(String(car.class || '?'))
                + ', ' + (car.races_won || 0) + '/' + (car.races_entered || 0) + ' wins)');
        } else if (key && state.car && state.car !== '\u2014' && carsCache) {
            detail.push('Current car (' + escH(state.car) + ') not matched in enlisted cars cache.');
        }
        const topRec = getTopTrackRecord();
        if (topRec) {
            detail.push('Class record at ' + escH(state.track || '?') + ': '
                + formatSecondsAsLapTime(topRec.lap_time)
                + ' by ' + escH(topRec.driver_name || '?')
                + ' in a ' + escH(topRec.car_item_name || '?'));
        }

        const html = [
            '<div style="color:' + tierColor + ';font-weight:600;margin-bottom:4px;">'
                + escH(tier) + '</div>',
            lines.length
                ? '<div>Cached:<br>&bull; ' + lines.map(escH).join('<br>&bull; ') + '</div>'
                : '<div style="color:var(--c-dim);">Nothing cached yet.</div>',
            detail.length
                ? '<div style="margin-top:6px;">' + detail.join('<br>') + '</div>'
                : ''
        ].join('');
        el.innerHTML = html;
    }

    function updatePauseBtn () {
        const btn = document.getElementById('tc-btn-pause');
        if (!btn) return;
        btn.textContent = commentaryPaused ? '\u25B6 Resume' : '\u23F8 Pause';
        btn.classList.toggle('tc-btn-active', commentaryPaused);
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
#tc-rc-drag{display:flex;align-items:center;justify-content:space-between;padding:6px 10px 5px;background:linear-gradient(90deg,#0c0f1c 0%,#111628 100%);border-bottom:1px solid var(--c-border);cursor:grab;flex-shrink:0;}
#tc-rc-drag:active{cursor:grabbing;}
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
.st-menu{color:var(--c-gold);}.st-countdown{color:var(--c-blue);}.st-prelaunch{color:var(--c-orange);}.st-waiting{color:var(--c-orange);}.st-racing{color:var(--c-green);}.st-replay{color:var(--c-purple);}.st-ended{color:var(--c-purple);}.st-crashed{color:var(--c-red);}.st-unavailable{color:var(--c-orange);}.st-hospital{color:var(--c-red);}.st-jail{color:var(--c-red);}.st-timedout{color:var(--c-orange);}.st-toolate{color:var(--c-orange);}.st-racefull{color:var(--c-orange);}.st-nofunds{color:var(--c-orange);}.st-notallowed{color:var(--c-red);}.st-torndown{color:var(--c-red);font-size:11px;letter-spacing:.06em;}.st-garage{color:var(--c-blue);}.st-stats{color:var(--c-blue);}.st-enlisted{color:var(--c-blue);}
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
.fl-outro{color:#fff;font-weight:600;border-left-color:#fff;background:rgba(255,255,255,.06);padding-top:5px;padding-bottom:5px;}
.fl-laptime{color:#ff9a3c;border-left-color:#ff9a3c;background:rgba(255,154,60,.07);}
.fl-crash{color:var(--c-red);font-weight:700;border-left-color:var(--c-red);background:rgba(255,102,102,.08);}
.fl-waiting{color:var(--c-orange);font-style:italic;border-left-color:var(--c-orange);background:rgba(255,170,80,.07);}
#tc-rc-footer{display:flex;align-items:center;gap:5px;padding:4px 10px;background:var(--c-bg2);border-top:1px solid var(--c-border2);flex-shrink:0;flex-wrap:wrap;}
.tc-foot-btn{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;background:rgba(255,255,255,.04);border:1px solid var(--c-border);color:var(--c-dim);padding:2px 9px;border-radius:3px;cursor:pointer;letter-spacing:.05em;text-transform:uppercase;transition:background .15s,color .15s,border-color .15s;white-space:nowrap;}
.tc-foot-btn:hover{background:rgba(245,192,48,.12);border-color:var(--c-gold);color:var(--c-gold);}
.tc-foot-btn.tc-btn-active{background:rgba(245,192,48,.15);border-color:var(--c-gold);color:var(--c-gold);}
/* Throttle slider (per spec v2.73). Compact slider that sits next to the
 * Pause button in the footer. Labels "Less" and "All" flank the input. */
.tc-throttle-wrap{display:flex;align-items:center;gap:4px;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;color:var(--c-dim);letter-spacing:.05em;text-transform:uppercase;}
.tc-throttle-wrap input[type=range]{width:55px;height:14px;accent-color:var(--c-gold);cursor:pointer;}
.tc-throttle-wrap .tc-thr-lbl{user-select:none;}
#tc-live-dot{margin-left:auto;width:6px;height:6px;border-radius:50%;background:var(--c-green);flex-shrink:0;animation:tc-pulse 2.5s ease-in-out infinite;}
@keyframes tc-pulse{0%,100%{opacity:1;}50%{opacity:.15;}}
#tc-rc-settings{display:none;flex-direction:column;align-items:center;justify-content:flex-start;gap:7px;padding:20px 18px;flex:1;overflow-y:auto;}
.tc-set-title{font-family:'Orbitron',monospace;font-size:12px;font-weight:900;color:var(--c-gold);letter-spacing:.1em;text-align:center;margin-bottom:6px;width:100%;}
.tc-set-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid var(--c-border2);border-radius:3px;width:100%;box-sizing:border-box;}
.tc-set-row-stack{flex-direction:column;align-items:stretch;}
.tc-set-row-stack .tc-set-lbl{margin-bottom:6px;}
.tc-api-row{display:flex;gap:6px;align-items:center;}
.tc-api-input{flex:1;min-width:0;background:rgba(0,0,0,.5);border:1px solid var(--c-border2);color:var(--c-fg);padding:5px 8px;font-family:'Share Tech Mono',monospace;font-size:11px;border-radius:3px;letter-spacing:.04em;}
.tc-api-input:focus{outline:1px solid var(--c-gold);border-color:var(--c-gold);}
#tc-api-status{margin-top:6px;font-size:11px;}
#tc-api-status.tc-ok{color:var(--c-green);}
#tc-api-status.tc-err{color:var(--c-red);}
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
.tc-cred-forum{color:var(--c-blue);font-size:12px;text-decoration:none;margin-top:4px;}
.tc-cred-forum:hover{text-decoration:underline;}
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
        <div class="tc-col-hdr" id="tc-col-hdr-commentary">COMMENTARY <span id="tc-col-hdr-arrow">&#8593;</span></div>
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
    <a class="tc-cred-forum" href="https://www.torn.com/forums.php#/p=threads&amp;f=21&amp;t=16559767&amp;b=0&amp;a=0&amp;start=20&amp;to=0" target="_blank" rel="noopener">Forum link: Bugs, feedback and LIKES welcome!</a>
    <div class="tc-set-divider"></div>
    <div class="tc-set-row">
      <span class="tc-set-lbl">Commentary scroll</span>
      <button id="tc-btn-scroll-dir" class="tc-foot-btn">&#8593; Up</button>
    </div>
    <div class="tc-set-hint">
      Down: newest messages appear at the bottom, older scroll up.<br>
      Up: newest messages appear at the top, older scroll down.
    </div>
    <div class="tc-set-divider"></div>
    <div class="tc-set-row tc-set-row-stack">
      <span class="tc-set-lbl">Torn API key (optional)</span>
      <div class="tc-api-row">
        <input id="tc-api-key" class="tc-api-input" type="password" placeholder="16-char API key" autocomplete="off" spellcheck="false" />
        <button id="tc-api-save" class="tc-foot-btn">Save</button>
      </div>
      <div id="tc-api-status" class="tc-set-hint"></div>
    </div>
    <div class="tc-set-hint">
      Stored only in Tampermonkey on this device. Get a key at
      <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener" style="color:var(--c-blue);">torn.com/preferences#api</a>.
    </div>
    <div class="tc-set-divider"></div>
    <div class="tc-set-lbl">Active key status</div>
    <div id="tc-key-diag" class="tc-set-hint">Open settings to refresh.</div>
    <div class="tc-set-divider"></div>
    <div class="tc-set-lbl">Key access tiers</div>
    <div class="tc-set-hint">
      <strong style="color:var(--c-orange);">No key</strong> &mdash; basic
      commentary works (status detection, leaderboard, lap times, all
      built-in ambient lines). No track-description flavour, no track
      records, no car-attribute flavour.<br><br>
      <strong style="color:var(--c-blue);">Public key</strong> &mdash;
      unlocks <em>track descriptions</em> (16 Torn tracks, ~108 keyword-
      derived flavour lines weaving location/surface/feature detail into
      commentary), and <em>track records</em> (top class lap times with
      "Only 1.2s off the record" style references in lap-time commentary).<br><br>
      <strong style="color:var(--c-green);">Minimal key</strong> &mdash;
      everything above, PLUS <em>your enlisted-cars data</em>: car
      attribute classification (top speed, acceleration, braking,
      handling, dirt, tarmac on a Low/Medium/High scale relative to your
      car's class), and race-record flavour. Lines like "{car} is with
      serious top end" or "tarmac grip a worry" appear automatically
      when relevant to the current track.<br><br>
      Either key type can be entered &mdash; the script uses whatever
      access it has and gracefully drops lines it can't populate.
    </div>
  </div>
</div>
<div id="tc-rc-footer">
  <button id="tc-btn-settings" class="tc-foot-btn">Settings</button>
  <button id="tc-btn-back" class="tc-foot-btn" style="display:none">&#8592; Back</button>
  <button id="tc-btn-pause" class="tc-foot-btn">&#9208; Pause</button>
  <span class="tc-throttle-wrap" title="Throttle commentary: Less = player-only, All = full">
    <span class="tc-thr-lbl">Less</span>
    <input id="tc-throttle" type="range" min="0" max="100" step="5" value="100">
    <span class="tc-thr-lbl">All</span>
  </span>
  <span id="tc-live-dot"></span>
</div>`;
        document.body.appendChild(hud);
        // Restore persisted window position and size. Fix Button was removed
        // in v2.62 (per spec); the window is always floating now, so no guard.
        if (state.windowLeft) { hud.style.left = state.windowLeft; hud.style.right = 'auto'; }
        if (state.windowTop) { hud.style.top = state.windowTop; }
        if (state.windowWidth) { hud.style.width = state.windowWidth; }
        if (state.windowHeight) { hud.style.height = state.windowHeight; }
        makeDraggable(hud, document.getElementById('tc-rc-drag'));
        document.getElementById('tc-rc-min').addEventListener('click', function () { setMinimised(!isMinimised); });
        document.getElementById('tc-btn-settings').addEventListener('click', function () {
            document.getElementById('tc-rc-main').style.display = 'none';
            document.getElementById('tc-rc-settings').style.display = 'flex';
            document.getElementById('tc-btn-settings').style.display = 'none';
            document.getElementById('tc-btn-back').style.display = '';
            updateScrollDirBtn();
            // Per spec v2.79: refresh the active-key diagnostic each time
            // settings is opened. Also kick off lazy fetches for any data
            // we don't have yet — most useful when the user has JUST entered
            // a key and wants to confirm it's working without waiting for
            // the next race tick to surface a flavour line.
            try {
                if (getApiKey()) {
                    if (!tracksCache) fetchTracksFromApi();
                    fetchEnlistedCars();
                }
            } catch (_) {}
            refreshKeyDiagnostic();
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
        // API key handling — populate the input with the currently-stored key
        // (masked because the input is type="password") and wire the Save button.
        const apiInput = document.getElementById('tc-api-key');
        const apiStatus = document.getElementById('tc-api-status');
        const apiSave = document.getElementById('tc-api-save');
        if (apiInput && apiSave && apiStatus) {
            const existing = getApiKey();
            if (existing) {
                apiInput.value = existing;
                apiStatus.className = 'tc-set-hint tc-ok';
                apiStatus.textContent = 'Key set. Track-flavour lines active when cache populates.';
            }
            apiSave.addEventListener('click', function () {
                const val = (apiInput.value || '').trim();
                if (!val) {
                    setApiKey('');
                    apiStatus.className = 'tc-set-hint';
                    apiStatus.textContent = 'Key cleared. Track-flavour lines disabled.';
                    return;
                }
                // Light client-side sanity check. Torn keys are 16 alphanumeric chars.
                if (!/^[A-Za-z0-9]{16}$/.test(val)) {
                    apiStatus.className = 'tc-set-hint tc-err';
                    apiStatus.textContent = 'That does not look like a 16-character Torn API key.';
                    return;
                }
                setApiKey(val);
                apiStatus.className = 'tc-set-hint tc-ok';
                apiStatus.textContent = 'Saved. Fetching tracks…';
                // Per spec v2.78: try the user-data endpoint too so we can
                // detect whether this is a minimal key. Public keys will fail
                // silently and we'll just see the tracks/records calls succeed.
                fetchTracksFromApi();
                fetchEnlistedCars();
                // Re-check the cache after a short delay to give the user feedback.
                setTimeout(function () {
                    if (!apiStatus) return;
                    if (tracksCache && tracksCache.tracks && tracksCache.tracks.length) {
                        apiStatus.className = 'tc-set-hint tc-ok';
                        apiStatus.textContent = 'Saved. ' + tracksCache.tracks.length + ' tracks cached.';
                    } else {
                        apiStatus.className = 'tc-set-hint';
                        apiStatus.textContent = 'Saved. Cache will populate on next API call.';
                    }
                    // Refresh the diagnostic so the user sees the tier
                    // detection update once the first response lands.
                    refreshKeyDiagnostic();
                }, 2500);
            });
        }
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
        // Throttle slider — set the persisted value and bind input handler.
        // Per spec v2.73: live update on input so the user sees the effect
        // immediately. No commentary message is fired on change (it's a
        // density control, not a state toggle).
        const throttleEl = document.getElementById('tc-throttle');
        if (throttleEl) {
            throttleEl.value = String(throttleValue);
            throttleEl.addEventListener('input', function () {
                const v = parseInt(throttleEl.value, 10);
                if (!isNaN(v)) {
                    throttleValue = Math.max(0, Math.min(100, v));
                    // Reset the gate timestamp so a slider increase takes
                    // effect right away rather than waiting for any prior
                    // gap to expire.
                    throttleNextAllowedAt = 0;
                    saveThrottleValue();
                }
            });
        }
        updatePauseBtn();
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
        try {
            loadState();
            loadThrottleValue();
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
            // Warm the tracks cache on startup so apiAmbient lines become
            // available as soon as possible. If no key is set, this no-ops.
            try { fetchTracksFromApi(); } catch (_) {}
            // Per spec v2.79: hydrate keyAccessFlags from any existing
            // caches so the settings-page diagnostic reflects historical
            // success across page refreshes — not just the current session.
            // Without this, the diagnostic would say "awaiting first response"
            // even when the user has perfectly valid week-old cached data.
            try {
                if (!tracksCache) tracksCache = loadTracksCache();
                if (tracksCache && tracksCache.tracks && tracksCache.tracks.length) {
                    keyAccessFlags.tracksOK = true;
                }
                if (!recordsCache) recordsCache = loadRecordsCache();
                if (recordsCache && recordsCache.byKey && Object.keys(recordsCache.byKey).length) {
                    keyAccessFlags.recordsOK = true;
                }
                if (!carsCache) carsCache = loadCarsCache();
                if (carsCache && carsCache.cars && carsCache.cars.length) {
                    keyAccessFlags.carsOK = true;
                }
            } catch (_) {}
        } catch (e) {
            // If init fails, log loudly but still try to build the HUD so the
            // user sees *something* and can report what went wrong. A thrown
            // error here previously left the page completely blank.
            console.error('[TC Race Commentary] init failed:', e);
            try { buildHUD(); } catch (_) {}
        }
        try {
            poll();
        } catch (e) {
            console.error('[TC Race Commentary] first poll failed:', e);
        }
        // Subsequent polls are wrapped so a single bad poll doesn't kill the
        // interval. setInterval keeps firing regardless of one tick's errors.
        setInterval(function () {
            try { poll(); } catch (e) {
                console.error('[TC Race Commentary] poll error:', e);
            }
        }, POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
