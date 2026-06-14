// ==UserScript==
// @name         TORN CITY Race Commentary
// @namespace    sanxion.tc.racecommentary
// @version      3.5.3
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
    const SCRIPT_VERSION = '3.5.3';
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

    // Per spec v3.1: COUNTDOWN and PRE-LAUNCH should keep messages varied
    // across a wider window (20 lines) since the player is parked there for
    // longer and repeats stick out more. RACING and other statuses keep the
    // standard 10-line window to allow flavour to recycle naturally.
    const REPEAT_WINDOW_LONG = 20;
    function getRepeatWindowFor (typeKey) {
        // Pre-race type keys (countdown ambient/player, pre-launch ambient).
        // Anything matching gets the wider 20-line lookback.
        if (typeKey === 'countdown' || typeKey === 'preLaunch'
            || typeKey === 'mechAdvert' || typeKey === 'officialFlavour') {
            return REPEAT_WINDOW_LONG;
        }
        return REPEAT_WINDOW;
    }

    // ─── Track API integration ────────────────────────────────────────────────────
    // Per spec: hit https://api.torn.com/v2/racing/tracks and match the scraped
    // track name against each record's `title`, then use the `description` to
    // flavour ambient commentary. Requires a Torn API key (Public Access tier
    // is sufficient - track data is public information). The key is stored
    // locally via GM_setValue and NEVER transmitted anywhere except api.torn.com.
    const API_KEY_STORAGE = 'tc_racecomm_api_key';
    const TRACKS_CACHE_STORAGE = 'tc_racecomm_tracks_cache';
    const TRACKS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week - track data rarely changes
    // Per spec v2.78: track records and player enlisted cars APIs.
    // Records are per-track-per-class lap times - refresh once per session
    // is fine (they only change when someone sets a new record). Cars are
    // per-player attributes - refresh a few times per hour at most so we
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
    // keyAccessFlags schema: { tracksOK, recordsOK, carsOK } - set after the
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
        // Stopwatch icon for lap-time commentary (per spec v2.65 - orange themed
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
        STATISTICS: 'STATISTICS', ENLISTED: 'ENLISTED',
        // Per spec v3.1: official-race sign-up screen. Detected by the
        // "Would you like to join a race?" text. Single "Points to be won"
        // line fires once, then the screen moves on to WAITING/COUNTDOWN
        // for the actual race. The HUD shows "OFFICIAL RACE SIGN UP".
        OFFICIAL_SIGNUP: 'OFFICIAL_SIGNUP'
    };

    // Statuses where commentary is suppressed entirely after the entry message(s).
    // The user will see the announcement once, then nothing more until the page
    // returns to MENU (or some other active status).
    const QUIET_STATUSES = [
        'CRASHED', 'UNAVAILABLE', 'HOSPITAL', 'JAIL', 'TIMED_OUT',
        'ALREADY_STARTED', 'RACE_FULL', 'NOT_ENOUGH_FUNDS', 'NOT_ALLOWED',
        'TORN_DOWN', 'IN_GARAGE', 'STATISTICS', 'ENLISTED',
        // Per spec v3.1: official-race sign-up. One-shot "Points to be won
        // here..." line fires on status entry, then silent until the user
        // clicks a button and the screen changes.
        'OFFICIAL_SIGNUP'
    ];

    // RACE_REPLAY behaves identically to RACING for commentary, position
    // tracking, ambient timing, halfway message, etc. Only the display label
    // differs. This helper centralises the "is the race actively running?"
    // check so the two statuses stay in sync.
    function isRacingLike (st) {
        return st === S.RACING || st === S.RACE_REPLAY;
    }

    // Per spec v2.78: detect when the player is the only racer still on
    // track - every other non-crashed racer has crossed the finish line.
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
    // Per spec v3.1: API CONNECT TO MECHANIC SHOPS AND CAR DEALERSHIPS
    // (https://api.torn.com/v2/company/?type=30 for mechanic, type=4 for
    // car dealership). The real API integration is deferred pending more
    // info; in the meantime we use dummy data to show the flavour. When
    // the real API is wired in, replace MECH_SHOP_DUMMIES with the fetched
    // list of player-run shops that are HIRING. Each entry needs:
    //   name      - the shop name shown in the advert
    //   stars     - star rating 1-10 (used in radio-DJ-style copy)
    //   owner     - the player who runs it (used occasionally for flavour)
    //
    // Adverts fire from the COUNTDOWN ambient flow at most once every 20
    // minutes (MECH_ADVERT_COOLDOWN_MS) via the mechAdvert type-key in
    // pickLine, which uses the 20-line REPEAT_WINDOW_LONG so different
    // templates pair with different shops over a long session.
    // Per spec v3.4.1: Torn City crimes list used by the {crime} token in
    // police-scanner lines. Sourced from Crimes 2.0 and Organized Crime
    // 2.0 references. Phrased in lowercase noun form so they slot into
    // sentences like "dealing with a {crime}" naturally.
    const TC_CRIMES = [
        'stagecoach robbery',
        'counterfeiting bust',
        'pickpocketing ring',
        'bank robbery',
        'burglary in progress',
        'hustling operation',
        'forgery investigation',
        'cash-search sweep',
        'vandalism spree',
        'arson incident',
        'theft from a vehicle',
        'shoplifting case',
        'card-skimming operation',
        'jewellery store heist',
        'illegal weapons run',
        'casino-job tip-off',
        'truck-jacking call',
        'protection-racket complaint',
        'graffiti spree',
        'big-con sting'
    ];

    const MECH_SHOP_DUMMIES = [
        { name: 'Big Al\'s Tune-Up Garage', stars: 10, owner: 'BigAl' },
        { name: 'Spark Plug Sammy\'s', stars: 8, owner: 'Sammy' },
        { name: 'Torn City Speed Shop', stars: 9, owner: 'Vince' },
        { name: 'Greasy Tina\'s', stars: 7, owner: 'Tina' },
        { name: 'Wrench & Roll', stars: 10, owner: 'Mike' },
        { name: 'Downtown Mods', stars: 6, owner: 'Lou' },
        { name: 'Nitro Annie\'s', stars: 9, owner: 'Annie' },
        { name: 'Chrome Cathedral', stars: 8, owner: 'Reggie' },
        { name: 'The Boost Bunker', stars: 10, owner: 'Dax' },
        { name: 'Pistons & Pints', stars: 7, owner: 'Maureen' }
    ];

    const MECH_ADVERT_TEMPLATES = [
        'And a word from our sponsors - {shopName}, {stars} star service, and they are hiring! Get down there.',
        'Need your ride dialled in? {shopName} is your shop. {stars} star rated, and looking for new hands.',
        'Brought to you by {shopName} - {stars} star tuning and currently hiring. Tell them KZYM sent you.',
        'If your engine is whining, get yourself over to {shopName}. {stars} star reputation, and yes, they are hiring.',
        'Hey racers - {shopName} is on the lookout for mechanics. {stars} star outfit. Solid place to learn the trade.',
        'Quick shout out to {shopName} - {stars} stars and counting. They have openings, get your CV in.',
        'When the dust settles, {shopName} will get you race-ready again. {stars} star shop, hiring now.',
        '{shopName} - the {stars} star garage Torn talks about. Recruiting today.',
        'Sponsorship corner: {shopName}, run by {owner}, {stars} star rated, taking on staff this week.',
        'And we are told {shopName} is hiring mechanics. {stars} stars - one of the best in town.'
    ];

    // pickMechAdvert: returns a filled advert string using a random dummy
    // shop and a non-recently-repeated template (20-line window via the
    // mechAdvert type-key). Returns null if there are no dummies.
    function pickMechAdvert () {
        if (!MECH_SHOP_DUMMIES.length) return null;
        const shop = MECH_SHOP_DUMMIES[Math.floor(Math.random() * MECH_SHOP_DUMMIES.length)];
        const template = pickLine(MECH_ADVERT_TEMPLATES, 'mechAdvert');
        return template
            .replace(/\{shopName\}/g, shop.name)
            .replace(/\{stars\}/g, String(shop.stars))
            .replace(/\{owner\}/g, shop.owner);
    }

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
                // Per spec v3.1: more believable paddock atmosphere -
                // last-minute prep, drivers physically present, mechanics
                // doing final touches, normal radio chatter and banter.
                '{player} sits on the bonnet of their car, breathing in the track.',
                '{p2} sits on the bonnet of their car, breathing in the track.',
                'Last minute modifications and tuning across the paddock.',
                'Mechanics swarming the cars for one final check.',
                '{player} fiddles with the wheel for the tenth time.',
                'A spanner clatters on concrete in the {player} pit.',
                'Final tyre pressures being set. Crews look anxious.',
                '{p2} chats with their chief mechanic at the driver door.',
                'The radio hisses with last-minute team chatter.',
                'A mechanic gives {player} a thumbs up. All systems set.',
                'Quiet banter from crew to crew. Old rivalries, fresh nerves.',
                '{player} climbs out for one last walk around the car.',
                'Crew chief leans into {p2}\'s cockpit for a final word.',
                'Toolboxes snapping shut up and down the lane.',
                'Engineers tap clipboards, double-checking everything.',
                'A trolley jack rolls past, the work all but done.',
                '{p2} adjusts their mirrors one more time.',
                'Race control radio crackles through the paddock speakers.',
                'A photographer leans low for the shot of {player} on the grid.',
                'Police nearby, eyes scanning the crowd more than the cars.',
                '{player} stretches their arms, loosening up for the off.',
                'The PA cuts through the hum - final boarding call for race fans.',
                // Per spec v3.2: telemetry/diagnostics flavour. The
                // commentator's radio has a "wave length scanning device"
                // that picks up paddock telemetry. 20 lines tying these
                // words to vehicle condition or driver mood. COUNTDOWN
                // context (pre-race), so it's pre-flight checks, idle
                // readings, sensor sweeps - not in-action live data.
                'Telemetry from {player}\'s car shows oil temp climbing nicely on idle.',
                'Our scanner picks up diagnostics off {p2}\'s rig - all green.',
                'Pre-flight diagnostics on {player}\'s {car} reading clean.',
                'Telemetry suggests {p2} has dialled in stiffer rear springs today.',
                'Live diagnostics off the grid: tyre pressures look spot on for {track}.',
                'Our wave length scanner indicates {player} is calm. Heart rate steady.',
                'Telemetry says {p3} is running rich. Last-minute carb tweak coming.',
                'Diagnostics off {player}\'s car: ECU happy, no fault codes.',
                'Scanner picks up cockpit telemetry - {p2}\'s hands are steady on the wheel.',
                'Pre-race diagnostics across the grid: nothing untoward to report.',
                'Telemetry from {player}\'s {car} suggests fresh brakes and clean lines.',
                'Our paddock scanner pulls in suspension data - {p2}\'s rig is set firm.',
                'Diagnostics on {player}\'s setup all green. Just the start to worry about.',
                'Telemetry indicates {p3} is dialling in their gear ratios. Last-minute change.',
                'Cockpit telemetry: {player}\'s breathing is steady. Focused.',
                'Our scanner catches {p2}\'s engine note - sounds healthy and crisp.',
                'Diagnostics suggest {player}\'s tyres are right in the sweet spot.',
                'Telemetry off {p3} shows ambient brake temps. Ready for the off.',
                'Scanner reading {player}\'s pulse - rising, naturally. The wait does that.',
                'Pre-race diagnostics show {p2} ran a quick rev test. Sounds clean.',
                // Per spec v3.4: race-day atmosphere. Sensory details
                // (smells, sounds, sights) that make the paddock feel
                // alive without referencing in-race action. Wheel spins
                // on the grid, tyre smoke from warm-ups, the smell of
                // oil, photographers and press doing their rounds, food
                // stands feeding the crowd.
                'A quick wheel spin from {player} on the warm-up - tyre smoke drifting away.',
                'Tyre smoke curls up from {p2}\'s grid box. Heat going into the rubber.',
                'The smell of hot oil hangs over the grid this afternoon.',
                'A waft of methanol fumes drifts across from the far side of the paddock.',
                'Garage smells mingling - rubber, oil, fresh paint.',
                'Frantic personnel movement as crews dart between cars one last time.',
                'A team principal jogs over to the {player} pit, clipboard in hand.',
                'Photographers crouch low at the front of the grid, jostling for the shot.',
                'A press interview with {p3} cut short by the call to mount up.',
                'Television crews swing their cameras across the grid.',
                'Food stands behind the stands are doing brisk trade.',
                'The unmistakable smell of fried onions drifting from the food trucks.',
                'A vendor calls out his last burgers before the race starts.',
                'A quick burnout from {p2} for the photographers. Showmanship.',
                'Marshalls signal cars to settle - the wheel-spinning is over.',
                'Tyre-warmer cables snake back to the trolleys, the rubber up to temperature.',
                'A pre-race interview wraps up by the {player} pit.',
                'Plumes of light smoke from idling engines drift across the grid.',
                'The clatter of crew running with tool trolleys, last moves before the start.',
                'A photographer almost gets in the way - a marshal shoos them clear.',
                // Per spec v3.4: more varied driver-focused commentary.
                // Mention car setup, wins-on-track (when known), how they
                // might handle the race, what they could be thinking, how
                // well the car might do, reaction to the track and racer
                // count. The {raceRecord} token (already used elsewhere)
                // resolves to wins-on-track flavour from the enlisted-cars
                // API when available.
                '{player} runs through the racing line in their head one more time.',
                '{player} eyes the field - {total} other cars to deal with today.',
                '{p2} looks across the grid, sizing up the competition.',
                '{player} taps the dashboard, settling their thoughts.',
                'The {car} set-up looks dialled in for {track} today.',
                '{player} carrying {raceRecord} into this one. Form and customisation matters.',
                '{p2} has done their homework on {track}. It shows in their posture.',
                '{player} could spring a surprise here if the start goes right.',
                'Question marks over how {p3} will handle the volume of cars today.',
                '{player} knows {track} well - they will not be caught napping.',
                '{p2} looks calm. A driver who has been here before.',
                '{player} runs through their gear shifts on the steering wheel.',
                'You can see {player} mentally rehearsing the first corner.',
                '{p3} bobs their head to music only they can hear.',
                'Plenty for {player} to think about with this many cars on track.',
                '{p2} reaches forward, double-checking the dash readouts.',
                '{player} looks every inch the racer in that {car}.',
                'A confident look on {p3}\'s face - they fancy their chances.',
                '{player} blinks slowly. Composure. The race starts in the head.',
                'A reassuring nod from {p2}\'s engineer. Setup confirmed.',
                '{p2} starts fighting {p3}.',
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
                'For those joining us, {track} - {trackDesc}',
                'A reminder for the newcomers: {trackDesc}',
                'The track guide says it all - {trackDesc}',
                'Worth noting on {track}: {trackDesc}',
                'They say of {track} - {trackDesc}'
            ],
            // Per spec v3.3: race-timer milestone commentary. Fires when
            // the COUNTDOWN remaining time crosses one of the configured
            // thresholds (45min/30min/15min/5min/1min/30sec). 20 templates,
            // each using {timeLeft} which gets filled per milestone. Each
            // milestone fires at most once per race (firedMilestones map).
            timerMilestones: [
                '{timeLeft} until pre-launch. Hold tight.',
                'Mark it - {timeLeft} until we go racing.',
                'Official confirmation: {timeLeft} until the racers are released.',
                'Just {timeLeft} to go before the lights come up.',
                '{timeLeft} on the clock. Anticipation builds.',
                'And we are now {timeLeft} from pre-launch.',
                '{timeLeft} until the action starts. Get comfortable.',
                'Race control: {timeLeft} remaining until pre-launch.',
                'Heads up everyone - {timeLeft} until launch.',
                '{timeLeft} now between us and the start.',
                'Punters will want to know - {timeLeft} until things kick off.',
                'Across the paddock, the call goes out: {timeLeft} to go.',
                '{timeLeft} until pre-launch. The grid grows quieter.',
                'Word from race control - {timeLeft} until the off.',
                '{timeLeft} to go. Final preparations under way.',
                'Tannoy crackles to life - {timeLeft} until pre-launch.',
                '{timeLeft} on the timer. Nerves jangling for some.',
                'Just {timeLeft} now until we are racing on {track}.',
                '{timeLeft} to go before pre-launch. Engines stirring.',
                'And the call: {timeLeft} remaining until the race begins.'
            ],
            player: [
                '{player} has settled into {pos} and holds their nerve.',
                '{player} locked in and ready. Grid position secured.',
                'All eyes on {player} as the countdown ticks away.',
                '{player} in the {car}, sitting {pos}. Cool and composed.'
            ]
        },
        PRE_LAUNCH: {
            // Per spec v3.2: one entry line fires when transitioning from
            // COUNTDOWN to PRE_LAUNCH. Pool of 20 different "we are now in
            // pre-launch" moments - crews finalising cars, doors slamming,
            // engineers stepping back, drivers settling in. Picked once
            // per pre-launch entry, then the regular ambient pool below
            // takes over.
            entryLines: [
                'We are now in pre-launch. Race crews scrabble to finalise cars.',
                'Pre-launch underway. Door slam as racers get comfortable.',
                'Pre-launch begins. Engineers step back from the cars one by one.',
                'Pre-launch announced. Final torque checks across the grid.',
                'And we are into pre-launch. Drivers belted in, eyes forward.',
                'Pre-launch underway. The last spanners come off the cars.',
                'Pre-launch is on us. Crews wheeling tool boxes off the grid.',
                'Pre-launch confirmed. Helmets buckled, visors snapping down.',
                'Pre-launch begins. The grid area empties of all but officials.',
                'Pre-launch underway. Drivers double-checking belts and brakes.',
                'We are in pre-launch. The final radio checks crackle through.',
                'Pre-launch declared. Mechanics retreat behind the wall.',
                'Pre-launch underway. A last gulp of water across the grid.',
                'Pre-launch begins. Engines settle to their idle note.',
                'And here we go - pre-launch. Last looks down the track from every cockpit.',
                'Pre-launch confirmed. Marshals taking up their final positions.',
                'Pre-launch underway. The boards come out one last time.',
                'We are into pre-launch. Crews pat their drivers on the helmet.',
                'Pre-launch begins. The PA goes silent. The wait is short now.',
                'Pre-launch underway. Every driver checks their mirrors.'
            ],
            ambient: [
                'Not long now.',
                'Tensions are rising.',
                'Rioting can be seen across the other side of the track.',
                'Engines build to a crescendo. Nearly time.',
                'Every driver coiled and ready. The start is almost upon us.',
                'The grid trembles with anticipation. Seconds away.',
                'All systems ready. The crowd has gone eerily quiet.',
                'The {startSignal}. This is the moment.',
                'Pre-launch can be the worst part of the race.',
                '{player} is shaking behind the wheel.',
                'Faction members hold banners up, their message clear.'
            ],
            player: [
                '{player} poised in {pos}. The launch will be critical.',
                'Watch {player} - reaction time off the line could be decisive.',
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
        // Per spec v3.3: OFFICIAL RACE extras pool. Merged into COUNTDOWN,
        // PRE_LAUNCH, and RACING ambient ONLY when state.officialRacePending
        // is set (which means the player came from the OFFICIAL_SIGNUP
        // screen and hasn't yet finished the resulting race). Lines cover:
        //   - the points structure (3/2/1 to top 3, nothing below)
        //   - balanced class-A field, head-to-head jousting
        //   - bands playing, celebrations, official atmosphere
        //   - background Torn crimes around the crowd (pickpockets,
        //     graffiting, arson, searching for cash)
        // Tone is upbeat and "event day" - different from the gritty
        // street-race feel that police/illegal pools bring.
        OFFICIAL: {
            // Per spec v3.4.1: lines that reference officials in crisp
            // uniforms, podium ceremony, brass bands and other glitter-
            // and-glamour cues only fit a Speedway race. Move those three
            // into a dedicated Speedway-only sub-pool, merged separately
            // in ambientPoolFor. The street-race official events on
            // illegal tracks (which CAN still be flagged as "official"
            // via the sign-up flow) should stay gritty.
            ambientSpeedwayOnly: [
                'Local musicians warming up the crowd. Officials in full ceremony mode.',
                'Race officials in their crisp uniforms today. Proper occasion.',
                'Confetti cannons primed near the podium. Someone is going to need them.'
            ],
            ambient: [
                'Reminder for the home viewers - three points for the win, two for second, one for third. Nothing below that.',
                'An official points race today. Six class-A drivers, all on the same level.',
                'A tight, balanced field. The kind that produces real wheel-to-wheel scraps.',
                'Six matched drivers, three sets of points. This will get fierce.',
                'Heads up - this is an official points-paying race. Every position matters in the top three.',
                'A brass band strikes up near the main stand. Race day proper, this.',
                'Bunting, banners, the official championship sponsors out in force.',
                'A celebrity grid walker doing the rounds. Big day for {track}.',
                'The crowd in their proper Sunday best - or whatever the local equivalent is.',
                'Pickpockets working the busy crowd at the far stand. As ever.',
                'Police chasing a tagger - someone has graffitied the back of the press box.',
                'Smoke rises from a small fire near the south gate. Arson, says race control.',
                'A scuffle as someone is caught searching for cash in the bleachers.',
                'Crime reports trickling in - a pickpocketing ring is active around the food trucks.',
                'Fresh graffiti gets sprayed onto the perimeter wall during the chaos. Charming.',
                'Police break up a fight over a wallet near the betting kiosks.',
                'Someone tried setting fire to a portable loo. Marshalls have it under control.',
                'Whispered word of more cash-searchers working the crowd. Eyes peeled.',
                'Expect head-to-head jousting today - six drivers, no slow ones to lap.',
                'No backmarkers in this race. Every overtake is for real points.',
                'Officials have done their job - this field is brutally well matched.',
                'A balanced field always means more contact. Watch for elbows out today.',
                // Per spec v3.4: official-race driver-focused commentary
                // mentioning points hopes and championship implications.
                '{player} hoping to add some points to their championship tally today.',
                '{p2} eyeing those three points for the win. Worth fighting for.',
                'Even one point would be a useful pick-up for {player} this season.',
                '{p3} knows top three pays. They will be racing for the podium.',
                '{player} could really do with a points finish here.',
                'A points day for {p2} would shake up the standings.',
                '{player} runs the points maths in their head - 3, 2, 1, then nothing.',
                'The pressure of points racing weighs on {p3}\'s shoulders today.',
                '{player} has hands tight on the wheel. Points matter today.',
                'Six drivers, three sets of points - {p2} wants their share.'
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
                "Watch the {car} - {carStrength}. A real weapon on a track like this.",
                "The {car} setup is {carStrength}. {player} ready to make it count.",
                "It's not just one upgrade that wins races - but {player}'s car is {carStrength}.",
                "{player} carrying {raceRecord} into this one. Form and customisation matters.",
                "{player} could be a problem out there - {raceRecord} in this {car}.",
                "The {car} has {carWeakness}. Could hurt {player} today.",
                "Concerns over the {car} - {carWeakness} on a track like this.",
                "{carWeakness} for {player}'s {car}. Watch for time loss in the wrong sections.",
                // Per spec v2.78: record-aware ambient. {recordTime},
                // {recordHolder}, {recordCar} resolve to top-class records
                // fetched from /v2/racing/{id}/records. Filtered out when
                // no records cached.
                'Track record here is {recordTime}, set by {recordHolder} in a {recordCar}.',
                'Anyone wanting to threaten the {recordTime} class record by {recordHolder} has work to do.',
                'The bar is {recordHolder}\u2019s {recordTime} - set in a {recordCar}.',
                'A reminder: class record on {track} sits at {recordTime}.'
            ],
            // Per spec v2.78: lonely-finish lines, used when the player is
            // last on track and all other racers have finished. Switches the
            // commentary tone to "alone on the road". These templates do
            // NOT reference other racers (because there are none left).
            // Per spec v2.83: start-of-race lines fired in the first few
            // seconds after RACING begins. Cover launch types (clean, slow,
            // wheelspin), nudges in the pack, and player-focused starts.
            // These reference the grid/launch - never mid-race action like
            // "halfway through" or "down the long straight" - because the
            // race has only just got underway.
            // Per spec v2.92: police-themed ambient lines that only fire
            // on ILLEGAL races. These mention Torn City crimes the police
            // are dealing with elsewhere, helicopter overhead, crowd
            // control, or just absent police. Merged into RACING.ambient
            // only when the current track is illegal (see ambientPoolFor).
            // Per spec v3.2: telemetry/diagnostics flavour for RACING.
            // Same paddock-scanner conceit as the COUNTDOWN pool, but
            // now reading live data while cars are on the move. 20 lines
            // tying these words to in-race performance shifts. Merged
            // into ambient on every track. {p1name} and {p2name} are NOT
            // used here so the lines never require active proximity data;
            // {player}, {p2}, {p3} resolve to whoever is currently in
            // those positions.
            telemetryRacing: [
                'Telemetry off {player}\'s car shows rising oil temps. Worth watching.',
                'Live diagnostics on {p2}: brakes running hot but still in range.',
                'Our scanner picks up cleaner sector data from {player} this lap.',
                'Telemetry suggests {p3} has just turned the engine up a notch.',
                'Diagnostics show {p2} is leaning on the brakes harder than the rest.',
                'Live telemetry off {player}\'s {car} - throttle traces look aggressive.',
                'Scanner reading {p2}\'s pulse - dropping nicely. They\'re finding their rhythm.',
                'Cockpit telemetry from {player} shows steady inputs. Calm under pressure.',
                'Diagnostics catch a small wobble in {p3}\'s lap consistency. Manageable.',
                'Telemetry from {player}: tyres holding temp beautifully through the corners.',
                'Our scanner picks up suspension data - {p2} riding the kerbs harder now.',
                'Live diagnostics show {player}\'s ECU pulling timing slightly. Heat soak.',
                'Telemetry from {p2} suggests they\'re saving the engine for later.',
                'Scanner indicates {p3}\'s brake bias is shifting forward. Adjusting on the fly.',
                'Diagnostics show {player} carrying more entry speed through the right-handers.',
                'Telemetry catches a brief slip from {p2} - corrected in milliseconds.',
                'Live cockpit telemetry: {player}\'s breathing has settled into the race.',
                'Scanner picks up gearbox traces - {p3} hitting the rev limiter occasionally.',
                'Diagnostics off {player}\'s rig: fuel burn dead on target.',
                'Telemetry off {p2} suggests their tyre strategy is going to plan.'
            ],
            // Per spec v3.2: Speedway-only cockpit-to-pits comms flavour.
            // Not actual dialogue - impression-style lines summarising
            // what the pit wall would be hearing. 20 lines, merged into
            // RACING.ambient only when state.track === 'Speedway'. The
            // logic for that merge lives in ambientPoolFor.
            speedwayCockpit: [
                'Cockpit to pits comms suggest a gear ratio problem for {player}.',
                '{player} will be happy with the current telemetry information.',
                'Pit wall radio chatter - {player}\'s engineer talking them through traffic.',
                'Cockpit to pits: {player} reporting good balance through the banking.',
                'Comms suggest {player} is querying their fuel target. Engineer reassures.',
                '{p2}\'s engineer comes on the radio - brake temps holding firm.',
                'Pit wall to {player}: tyre stint extended by a couple of laps.',
                'Cockpit telemetry sent to pits - {player} is on their fastest lap so far.',
                '{player}\'s engineer in their ear, calling out gaps to the cars ahead and behind.',
                'Comms hint at a setup tweak request from {p2} for the next race.',
                'Pit wall radio: {player} acknowledging "understood, pushing now".',
                'Cockpit comms suggest {player} is comfortable with the current power maps.',
                '{p2}\'s pit board flashes a target lap time - their engineer pleased on the radio.',
                'Engineer to {player}: stay out, stay out, build the gap.',
                'Cockpit to pits chatter - {player} reports the kerbs are a touch sharper today.',
                'Pit wall calls a sector split to {p2}. Two tenths up.',
                'Comms suggest {player} is querying tyre wear. Engineer says they\'re fine.',
                'Quick exchange between {p2} and the pit wall - they\'re settling into a rhythm.',
                'Engineer to {player}: focus on tyre management through the next stint.',
                'Cockpit comms relay {player}\'s feedback - the car is "alive" today.'
            ],
            police: [
                'No police around. We are clear, ladies and gentlemen.',
                'Police scanner indicates they are taking care of a hustling job across town.',
                'Police scanner crackles - they are on their way to a counterfeiting bust.',
                'Most of the police force is on their lunch break. Lucky us.',
                'Police scanner picks up a burglary in progress on the other side of Torn. Not our problem.',
                'The cops are dealing with a {crime} at the moment.',
                // Per spec v3.4.1: three more crime-aware variants. All
                // use the {crime} token so the police-elsewhere flavour
                // stays fresh across long sessions.
                'Word over the scanner - a {crime} just landed in their lap. Lucky us.',
                'Police all tied up with a {crime}. Their night just got busy.',
                'Scanner squawks - a {crime} is pulling every spare car. Not our problem.',
                'Police are keeping crowd control - we suspect they enjoy the racing too.',
                'A police helicopter hovers overhead. The pilot waves at the leading car.',
                'Sirens in the distance - not for us, thankfully.',
                'Police scanner: a forgery ring just got tipped off. The force is in chaos.',
                'Local police standing nearby with arms folded, enjoying the show.',
                'Word is the police union are on strike today. Convenient.',
                'Police scanner squawks about a vandalism spree downtown.',
                'A lone constable watches from the kerb. He is grinning.',
                'A pickpocketing complaint just came in over the scanner. They are taking that one.',
                'Police helicopter circles, spotlight playing across the pack.',
                'The boys in blue are at the throwing-the-match investigation. We are safe here.',
                'No badge in sight. The track belongs to the racers tonight.',
                'Police radio: a search-for-cash operation just went sideways elsewhere. Distractions are our friend.',
                'Mounted police drift past. They tip their caps to the leaders.'
            ],

            // Per spec v2.92: post-launch gradient pools selected based on
            // the player's starting position in the field. The FIRST start-
            // grid line each race uses a positional pool reflecting how the
            // player did off the line. Subsequent start-grid lines (up to
            // the cap) draw from the generic startGrid pool above.
            //
            // Tone tiers:
            //   1st place           : "amazingly", celebratory
            //   top 25% (not 1st)   : "perfectly", competent
            //   middle 50%          : neutral, businesslike
            //   bottom 25%          : negative, behind
            //
            // For small fields (10 or fewer racers), the buckets are
            // mapped by direct position rather than percentage so the
            // gradient still has resolution.
            startGridFirst: [
                '{player} amazingly times the launch from pole - a perfect getaway!',
                'An astonishing start by {player} from {pos}. Already opening a gap.',
                'Pole sitter {player} converts the start into a clear lead.',
                '{player} bullets off the line from {pos} - what a launch!',
                'Beautifully timed start by {player}. Holding the lead with authority.',
                '{player} away cleanly from the front. Everyone has work to do behind.',
                'A textbook start by {player} from {pos}. The field is already chasing.'
            ],
            startGridTopQuarter: [
                '{player} perfectly times the launch from {pos}.',
                'A clean, decisive getaway by {player}. Holding station up front.',
                '{player} away cleanly from {pos} - good position to attack from.',
                'Looking ready for the fight - {player} executes a tidy start.',
                '{player} away in good order from {pos}. The attack starts now.',
                'Strong launch from {player} - the {car} putting the power down well.',
                '{player} settles into {pos} cleanly. In the mix from the start.'
            ],
            startGridMid: [
                '{player} away in {pos}. A solid, unremarkable start.',
                'Nothing dramatic from {player} off the line. Position held.',
                '{player} settles in from {pos}. Long race ahead.',
                'Steady start for {player}. The work begins now.',
                '{player} away cleanly from {pos}. Plenty of laps to make moves.',
                'A workmanlike launch by {player}. Time to find a rhythm.',
                '{player} stays right where they started. The middle of the pack is busy already.'
            ],
            startGridBottomQuarter: [
                '{player} bogs down on the launch from {pos}. Lots to recover.',
                'A slow getaway for {player}. Already on the back foot.',
                'Wheelspin from {player} - the {car} struggling to put power down.',
                'Not the launch {player} wanted from {pos}. Tough start.',
                '{player} hesitates on the line. The chase begins immediately.',
                'A scrappy start for {player} from {pos}. Long way to recover.',
                '{player} caught napping at the lights. Bad way to begin the day.'
            ],
            startGrid: [
                'Lightning start from {leader}! Straight into the lead.',
                'Clean getaway for {leader} - holding position into turn one.',
                '{leader} bogs down on the launch! {p2} sneaks past.',
                'Wheelspin from {leader}! That\u2019s a tenth or two lost already.',
                '{p2} times the launch perfectly - instant move on {leader}.',
                'Bad start for {p2} - hesitates at the line.',
                'Nudges and bumps in the pack as the cars get away.',
                'Drama in the midfield! Smoke at the back of the grid.',
                'Side-by-side launches all down the front row.',
                'The whole pack jumps as one - heads straight for the first corner.',
                'A slow start for some of the back-row cars. Lots to recover.',
                '{leader} gets the jump and everyone is left chasing.',
                '{player} times the launch nicely in the {car}.',
                '{player} struggles off the line - slow start in the {car}.',
                'Off they go! Engines screaming as the field gets up to speed.',
                'Clean start across the field. No drama on the launch.',
                'Carnage at the start! Cars all over the place.',
                'A bit of a fumble for {p3} on the launch - slipping back.',
                '{p2} just edges {leader} off the line! What a getaway.',
                'Everyone away cleanly. Now the racing begins.'
            ],
            lonelyFinish: [
                'Just {player} now - everyone else home and showered.',
                'A long lonely road to the line for {player}.',
                '{player} the only car still circulating. Just have to bring it home.',
                'The crowd is starting to drift away. {player} still out there grinding.',
                'Nothing for company but the engine noise. {player} laps to the finish.',
                'A processional finish for {player}. Just complete the laps and pick up the points.',
                'No mirrors needed - {player} is the last one on track.',
                'The chequered flag is ready and waiting. {player} just needs to get there.',
                'No traffic, no overtakes - just {player} and the road.',
                '{player} working alone now. Smooth and consistent will do the job.'
            ],
            // API-flavoured RACING ambient - uses {trackDesc} from the Torn
            // tracks endpoint, merged into the active pool only when the
            // description has been fetched and cached.
            apiAmbient: [
                'Remember this is {track} - {trackDesc}',
                'For those tuning in late: {trackDesc}',
                '{track} demands respect. As the briefing puts it - {trackDesc}',
                'Worth bearing in mind on {track} - {trackDesc}',
                'Every driver here knows what {track} can do - {trackDesc}'
            ],
            // Tier-specific ambient pools, gated by state.racerCount. The tier
            // boundaries (2-6, 7-15, 16-50, 51-75, 76-100) come from the spec
            // section "NUMBER OF RACERS AFFECTS TYPE OF MESSAGES SHOWN". Each
            // tier captures the FEEL of a race of that size - space, noise,
            // grit, visibility - and mixes those flavour notes into commentary.
            tierTiny: [
                // 2-6: quiet, plenty of space
                'Plenty of room out there - almost a private session.',
                'A quiet field today. Each driver has space to breathe.',
                'Just a handful of cars, and you can hear every engine note.',
                'No traffic to fight - pure driving on display.',
                'With so few entries, every overtake matters double.',
                'A sparse grid means clean lines and clear sightlines.'
            ],
            tierSmall: [
                // 7-15: filling up, less space
                'Field starting to fill up. Less space, more drama.',
                'The pack tightens - overtaking gets trickier from here.',
                'Mid-sized field, and you can feel the pressure building.',
                'Enough cars now that every corner has a queue.',
                'Drivers having to pick their gaps carefully.',
                'The track no longer feels like the driver\'s own.'
            ],
            tierMedium: [
                // 16-50: lots of cars, noisier, smellier
                'A busy track today - the noise is something to hear.',
                'Lots of metal out there. The smell of fuel and rubber is heavy.',
                'Plenty of cars in the mix - space at a premium.',
                'The growl of all those engines together is a special sound.',
                'A proper field - and a proper racket from the grandstands.',
                'Fuel fumes hang thick over the track. This is racing.'
            ],
            tierLarge: [
                // 51-75: lots of cars, mud/grit flying, hard to see
                'Mud and grit flying up - visibility is becoming a real problem.',
                'A huge field - and you can barely see through the windscreen.',
                'Cars stacked up everywhere. Mud spraying from every wheel.',
                'Drivers will be wiping grit from their visors at every straight.',
                'Wall-to-wall cars and a windscreen full of debris.',
                'Vying for space at every turn - and a face full of muck.'
            ],
            tierMassive: [
                // 76-100: total carnage
                'Absolute carnage out there! Cars everywhere!',
                'The whole grid is one big rolling traffic jam.',
                'Slowing down, speeding up, slowing down again - chaos.',
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
            //     Used for the majority of laps - the every-lap baseline.
            //   - lapTimeFaster/Slower/Same (comparison): used at cadenced
            //     intervals (50-100 laps → every 8-12, 2-49 laps → every 2-6).
            //   - lapTimeAverage / lapTimeAverageFirst: every 2-4 laps from
            //     lap 5 onwards. The first message uses lapTimeAverageFirst
            //     (no previous average to compare against); subsequent ones
            //     use lapTimeAverage and reference the change vs the
            //     previously-reported average ("3s down on the last reading").
            //     Has higher priority than comparison - if both cadences hit
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
            //                      no prior reading or when level - the
            //                      "level" case uses dedicated templates
            //                      from lapTimeAverageLevel instead.
            lapTimeBasic: [
                '{player} completes lap {lapNum} in {lapTime}.',
                'A {lapTime} for {player} on lap {lapNum}. Steady work.',
                'Lap {lapNum} done - {lapTime} for {player}.',
                "{player}'s last lap: {lapTime}. Lap {lapNum} on the board.",
                'Through lap {lapNum} in {lapTime}. {player} keeping the rhythm.',
                'That was {lapTime} for {player}. Lap {lapNum} ticked off.',
                '{player} clocks {lapTime} for lap {lapNum}. Holding {pos}.',
                'Lap {lapNum} in {lapTime} - {player} on the move.',
                '{lapTime} on the boards for {player}. Lap {lapNum} complete.',
                'A {lapTime} from {player} that time. Lap {lapNum} done.',
                'Splits show {player} round in {lapTime} for lap {lapNum}.',
                '{player} crosses the line for lap {lapNum}. {lapTime}.',
                'Another lap down for {player} - {lapTime} on lap {lapNum}.',
                '{lapTime} this time for {player}. Working on lap {lapNum} now.'
            ],
            lapTimeFaster: [
                "{player} chops {delta}s off the previous lap - {lapTime} for lap {lapNum}.",
                "Quicker by {delta}s - {player} round in {lapTime} on lap {lapNum}.",
                "{lapTime} for {player} on lap {lapNum}. That's {delta}s up on the previous tour.",
                "A {delta}-second improvement for {player}. Lap {lapNum} in {lapTime}.",
                "Pace stepping up - {player} {delta}s quicker, lap {lapNum} in {lapTime}.",
                "{player} finds another {delta}s. Lap {lapNum} clocked at {lapTime}.",
                "Sharper through the turns - {lapTime} for {player}, {delta}s faster on lap {lapNum}.",
                "{player} putting the hammer down: {lapTime}, {delta}s up on the last one.",
                // Per spec v2.78: record-aware variants. {recordGap} resolves
                // to phrases like "only 1.2 seconds off the track record" or
                // "a new track record". When no record cached, {recordGap}
                // renders empty - these templates fall through to other pools
                // via the pickLine recent-blocklist on empty render.
                "{player} {delta}s up on the last one - {recordGap}.",
                "Lap {lapNum} in {lapTime} for {player}, {recordGap}.",
                "{lapTime} that time - {player} {recordGap}!"
            ],
            lapTimeSlower: [
                "{player} loses {delta}s that lap - {lapTime} for lap {lapNum}.",
                "Slower by {delta}s - {lapTime} for {player} on lap {lapNum}.",
                "Tyres starting to talk? {player} drops {delta}s, lap {lapNum} in {lapTime}.",
                "{lapTime} for {player} on lap {lapNum}. That's {delta}s down on the previous one.",
                "Pace easing for {player} - {delta}s slower, lap {lapNum} clocked at {lapTime}.",
                "{player} can't match the last one - {lapTime}, {delta}s shy of pace.",
                "A {delta}-second drop for {player} on lap {lapNum}. {lapTime} on the boards."
            ],
            lapTimeSame: [
                "{player} stays on the pace - {lapTime} for lap {lapNum}, near-identical to the last.",
                "Metronomic stuff from {player}. {lapTime} again, lap {lapNum} done.",
                "{player} matches the previous lap to within a whisker. {lapTime} on lap {lapNum}.",
                "Same time, different lap - {lapTime} for {player} on lap {lapNum}.",
                "Consistency on display - {player} round in {lapTime} for lap {lapNum}."
            ],
            lapTimeAverage: [
                // Compared to the previous reported average. {avgComparison}
                // expands to a pre-formatted phrase like "2s down on last
                // average" or "3s slower than last average". Per spec v2.68
                // these are NOT used when the new average is level - see the
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
            // Level case - the running average is unchanged (within 0.5s) of
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
                '{player} pushes hard {trackFlavour} - full commitment in the {car}.',
                'Watch {player} {trackFlavour}. They\'re finding tenths there.'
            ],
            funny: [
                '{name} appears to be shooting out their side window.',
                '{name} is driving backwards.',
                'Looks like {name} is drinking a bottle of beer, feet on the steering wheel.',
                '{name} pulls a 360, just for a laugh.',
                '{name} swerves left and right, grinding rubber.',
                'Showoff {name} blasts music out of their external speakers.'
            ],
            moverUp: [
                '{mover} moves from {moverFrom} to {moverTo}! Charging through the field.',
                'Excellent move from {mover} - {moverFrom} to {moverTo}!',
                '{mover} surges forward, {moverFrom} to {moverTo}.',
                'Position gained! {mover} moves from {moverFrom} to {moverTo}.',
                '{mover} makes a brilliant move, from {moverFrom} to {moverTo}.',
                'Up goes {mover}! From {moverFrom} to {moverTo} in a flash.',
                // Per spec v2.76: weave track-description flavour into the
                // overtake calls so they feel anchored to the actual track.
                '{mover} makes the move {trackFlavour} - {moverFrom} to {moverTo}!',
                'Brilliant pass {trackFlavour} for {mover} - {moverFrom} to {moverTo}.'
            ],
            moverDownEngine: [
                '{faller} drops from {fallerFrom} to {fallerTo} - looks like engine trouble.',
                'Engine issues for {faller}! Sliding from {fallerFrom} to {fallerTo}.',
                '{faller} loses ground fast, {fallerFrom} to {fallerTo}. That engine sounds rough.',
                'Mechanical grief for {faller} - dropping from {fallerFrom} to {fallerTo}.'
            ],
            moverDownTyre: [
                '{faller} moves down from {fallerFrom} to {fallerTo} - tyre trouble suspected.',
                'Tyre problems for {faller}! From {fallerFrom} to {fallerTo} and falling.',
                '{faller} struggles with rubber, sliding from {fallerFrom} to {fallerTo}.',
                'A blowout for {faller}? Dropping from {fallerFrom} to {fallerTo}.'
            ],
            moverDownMiscalc: [
                '{faller} drops from {fallerFrom} to {fallerTo} - a costly miscalculation.',
                'Poor decision from {faller} - {fallerFrom} to {fallerTo} and regretting it.',
                '{faller} misjudges the corner, dropping from {fallerFrom} to {fallerTo}.',
                'A miscalculation from {faller} - sliding back from {fallerFrom} to {fallerTo}.'
            ],
            moverDown: [
                '{faller} moves down from {fallerFrom} to {fallerTo}. Losing ground.',
                '{faller} drops from {fallerFrom} to {fallerTo}. The pack closes in.',
                '{faller} concedes ground, sliding from {fallerFrom} to {fallerTo}.',
                '{faller} under pressure, dropping from {fallerFrom} to {fallerTo}.'
            ],
            proximity: [
                '{p1name} coming very close to {p2name} - side by side through the sector!',
                'Intense battle between {p1name} and {p2name}. Barely a car width between them.',
                '{p1name} right on the bumper of {p2name}. This is going to get interesting.',
                'Wheel to wheel action - {p1name} and {p2name} are inseparable right now.',
                '{p1name} and {p2name} locked in a fierce duel. Neither gives an inch.',
                'The crowd on their feet as {p1name} and {p2name} go door to door.',
                '{p1name} scrapes metal, {p2name} swerves with the impact.',
                '{p1name} bumps their fender, {p2name} brake checks.',
                // Per spec v2.76: weave track-description flavour into
                // proximity calls so duels feel rooted in the actual track.
                '{p1name} and {p2name} side by side {trackFlavour}!',
                'Door to door {trackFlavour} - {p1name} and {p2name} won\'t give an inch.',
                '{p1name} tries the move on {p2name} {trackFlavour}. Brave stuff!'
            ],
            // Per spec v2.92: "refusing to drop away" / lingering-proximity
            // lines. These fire when the gap between adjacent racers is
            // LARGER than the close-proximity threshold but still within
            // (threshold + 5%) - i.e. the chaser is in touch but not in
            // attacking position. {p1name} is the chaser, {p2name} is the
            // defender (same convention as proximity).
            proximityLingering: [
                '{p1name} refusing to drop away from {p2name}. Still in striking distance.',
                '{p1name} just hanging on to {p2name} - not letting the gap grow.',
                'A second or two between {p1name} and {p2name}, but the chase is on.',
                '{p1name} keeping {p2name} honest. The gap holds steady.',
                '{p1name} won\'t let {p2name} settle - constant pressure from behind.',
                '{p2name} can see {p1name} in the mirrors. No room to relax.',
                '{p1name} stalking {p2name} - waiting for the moment to pounce.',
                'The gap from {p2name} to {p1name} just won\'t close up.',
                '{p1name} matching {p2name} sector for sector. A battle brewing.',
                '{p2name} looking edgy with {p1name} that close behind.'
            ],
            // These lines reference {p3} - ONLY used when racerCount >= 3
            position3: [
                'Current order: {leader} leads, {p2} in 2nd, {p3} in 3rd.',
                '{leader} out front, {p2} on their tail, {p3} watching closely.',
                'Top three right now - {leader}, {p2}, {p3}. All very close.',
                '{leader} leads from {p2} and {p3}. Every lap a new story.',
                'Midfield carnage behind {leader}. {p2} and {p3} fighting hard.'
            ],
            // These lines only mention 2 players - safe for any racer count
            position2: [
                '{leader} out front with {p2} right behind. This is tense.',
                '{leader} holds the lead but {p2} applies relentless pressure.',
                '{p2} presses hard on {leader}. Every corner a potential overtake.',
                '{leader} still leads, {p2} refusing to drop away.',
                // Per spec v2.75: when the field is small (≤5 racers) the
                // "at the back" framing reads oddly - there's nowhere to BE
                // at the back of. Reference their position ordinal instead.
                // For larger fields, "at the back" / "in last position" is
                // fine. The {lastDesc} token resolves accordingly.
                '{last} {lastDesc} - but races can change in an instant on {track}.'
            ]
        }
    };

    // ─── State ────────────────────────────────────────────────────────────────────
    let state = {
        status: S.MENU,
        playerName: '-',
        track: '-',
        car: '-',
        position: '-',
        // When the user clicks another racer in Torn's race list, their name goes
        // here. The display (NAME/CAR/POS) then tracks that racer until focus is
        // cleared. Empty string / null means no focus override - show real player.
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
        // Per spec v3.1: set when the player has just seen the OFFICIAL
        // RACE SIGN UP screen. The next race they enter is then treated
        // as an official 6-driver class-A points race. Cleared when the
        // race ends or the player returns to the menu without racing.
        officialRacePending: false,
        lastLap: '-',
        currentLap: '-',
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
        // Per spec v2.67: average lap-time messages have their own cadence -
        // every 2-4 laps starting from lap 5. nextAvgLapAt is the next lap at
        // which an average message will fire (0 = not yet scheduled).
        nextAvgLapAt: 0,
        // Previous average lap time (in seconds) - used to compute the
        // running-vs-previous comparison shown in average commentary. 0 means
        // "no previous average recorded yet"; first average message just
        // states the current value.
        lastAvgSec: 0,
        completion: '-',
        // Fix Button removed in v2.62 - windowFixed is no longer used but
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
        // session-only - race-entry reset clears them. We don't persist
        // these because a page refresh during a race shouldn't replay the
        // start-grid lines (we're already underway).
        raceStartedAt: 0,
        startGridLinesFired: 0,
        // Per spec v2.87: track which light/flag sequence lines have fired
        // during pre-launch. Keys are the second markers (5, 3, 2, 1).
        // Session-only; cleared on race entry.
        lightSeqFired: {}
    };

    // commentaryPaused - session only, never persisted. Manual via the Pause button.
    let commentaryPaused = false;

    // replayPausedAuto - session only. Set true when a RACE_REPLAY is paused
    // by Torn itself (page text "Race paused") and cleared when "Race
    // replaying" appears. Independent of commentaryPaused so a manual pause
    // toggle isn't disturbed by auto-pause state, and vice versa. The pause
    // filter (see pushLine) treats either flag as "paused".
    let replayPausedAuto = false;

    // Timers - session only, never persisted
    let tAmbient = 0;
    let tPlayer = 0;
    let tPosition = 0;
    let tProximity = 0;
    let tFunny = 0;
    let tWaiting = 0;
    let tPosCooldown = 0;
    // Per spec v3.1: mechanic-shop radio adverts fire at most once every
    // 20 minutes during COUNTDOWN. Persisted as last-fired ms timestamp.
    let tMechAdvert = 0;
    const MECH_ADVERT_COOLDOWN_MS = 20 * 60 * 1000;

    // Per spec v3.3: race-timer milestone commentary fires once per race
    // when the COUNTDOWN remaining time crosses each threshold. Each
    // milestone fires at most once per countdown (reset on race entry).
    // Thresholds in seconds, paired with their human-readable phrasing.
    const COUNTDOWN_MILESTONES = [
        { sec: 45 * 60, label: 'Forty-five minutes' },
        { sec: 30 * 60, label: 'Just over half an hour' },
        { sec: 15 * 60, label: 'Fifteen minutes' },
        { sec: 5 * 60,  label: 'Five minutes' },
        { sec: 60,      label: 'One minute' },
        { sec: 30,      label: 'Thirty seconds' }
    ];
    let firedMilestones = {};

    // Throttle slider (per spec v2.73): a 0-100 slider next to the Pause
    // button controls how dense the commentary is during RACING/RACE_REPLAY.
    //   0   = "Less" - only player-related messages get through (everything
    //         else is suppressed). Ambient messages still pass.
    //   100 = "All"  - every line passes (no throttling).
    //   In between, non-player non-ambient lines are gated by a time-based
    //   probability: higher slider value → shorter gap between messages.
    // Persisted to GM storage so the user's preference survives reload.
    // Throttle is INDEPENDENT of racer count (per spec - explicitly do NOT
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
    // - resets to 0 on page load, which is fine because the alternation is
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
    // Racers we have already announced as crashed - prevents repeat messages
    // for the same player. Reset on every new race entry.
    let otherCrashedNames = new Set();
    let currentStatus = S.MENU;
    let clearedForStatus = null;
    let isMinimised = false;

    // Consecutive polls that have seen "not enough drivers" - requires 2 to confirm WAITING.
    // Resets to 0 the moment any other status is detected, preventing stuck WAITING.
    let waitingSeenCount = 0;

    // ─── Per-poll page-text cache ─────────────────────────────────────────────────
    // getPageText() is expensive: it clones the entire document.body, queries
    // and removes overlay nodes, and extracts innerText. Called 11+ times per
    // poll tick from various scrapers, this allocated dozens of megabytes per
    // second - the root cause of the >2GB tab memory growth reported. Solution:
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
    // is updated. Failures are silent - the script falls back to its built-in
    // commentary pool, so the user notices nothing if the API is unreachable
    // or the key is invalid.
    function fetchTracksFromApi () {
        if (tracksFetchInFlight) return;
        const key = getApiKey();
        if (!key) return;
        // GM_xmlhttpRequest is the Tampermonkey cross-origin XHR - works
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
    // races within one session). TTL of 6 hours - records rarely change.

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
    // Records endpoint is public - works with public OR minimal key.
    function fetchTrackRecords (trackId, carClass) {
        if (!trackId || !carClass) return;
        const cacheKey = trackId + '-' + carClass;
        if (recordsFetchInFlight[cacheKey]) return;
        if (!recordsCache) recordsCache = loadRecordsCache() || { fetchedAt: Date.now(), byKey: {} };
        // Already have it (and not expired) - skip.
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
        // rely on that - find the min explicitly.
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
                            // here - that's expected, not a script bug.
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
        if (!cur || cur === '-') return null;
        const matches = [];
        for (let i = 0; i < carsCache.cars.length; i++) {
            const c = carsCache.cars[i];
            const nm = (c.car_item_name || '').trim().toLowerCase();
            if (nm === cur) matches.push(c);
        }
        if (!matches.length) return null;
        return matches[Math.floor(Math.random() * matches.length)];
    }

    // Player car class - used to drive both record-class lookup and the
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
    /
