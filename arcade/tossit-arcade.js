window.TossitArcade = window.TossitArcade || {};

/*
  Loaded on demand: the section ships a poster and only fetches this file
  when someone actually presses play, so the home page pays nothing for the
  game unless it is wanted.
*/
window.TossitArcade.boot = function (root) {
  if (!root || root.dataset.booted === '1') return;
  root.dataset.booted = '1';

  var canvas = root.querySelector('.ta-canvas');
  var ctx = canvas.getContext('2d');
  var startScreen = root.querySelector('[data-screen="start"]');
  var endScreen = root.querySelector('[data-screen="end"]');
  var soundBtn = root.querySelector('[data-sound-toggle]');
  var soundIcon = root.querySelector('[data-sound-icon]');

  /* ---------------------------------------------------------- config */

  var YELLOW = '#edbd00';
  var TEAL = '#58cfbe';
  var RED = '#f04a3a';

  var DIFF = {
    chill: { near: 430, far: 620, speed: [16, 30], count: 6, label: 'CHILL' },
    classic: { near: 430, far: 720, speed: [26, 46], count: 8, label: 'CLASSIC' },
    pro: { near: 460, far: 840, speed: [42, 78], count: 10, label: 'RUSH HOUR' }
  };

  var cfg = {
    darts: Math.max(1, Math.min(9, parseInt(root.dataset.darts, 10) || 5)),
    diff: DIFF[root.dataset.difficulty] || DIFF.classic
  };

  var G = 260;             /* gravity, cm/s^2 */
  var DRAG_AIR = 0;        /* the sight solves the arc exactly, so no drag */
  var SPD_MIN = 340;
  var SPD_MAX = 860;
  var STREET_Y = -160;     /* road surface, cm below eye level */
  var DART_LEN = 21;
  var HEAD_R = 17;         /* cm */

  var DART_COLORS = ['#f04a3a', '#58cfbe', '#edbd00', '#f04a3a', '#58cfbe', '#edbd00', '#f04a3a', '#58cfbe', '#edbd00'];

  var TAUNTS = [
    'MISSED ME', 'NICE ARM', 'OVER HERE', 'IS THAT IT?', 'STILL WALKING',
    'TOO SLOW', 'AIM HIGHER', 'NOT EVEN CLOSE', 'MY NEPHEW THROWS BETTER',
    'NICE TRY, PAL', 'WHIFF', 'KEEP PRACTISING', 'THIS SIDEWALK IS SAFE',
    'YOU CALL THAT A TOSS?', 'WALKING HERE!'
  ];
  var HIT_LINES = [
    'HEY!', 'MY HEAD!', 'WHO THREW THAT', 'OW!', 'SERIOUSLY?!',
    'NOT AGAIN', 'MY DOME!', 'THAT IS ASSAULT'
  ];
  var SMUG_LINES = ['TOLD YA', 'WRONG GUY', 'GOT HAIR, PAL', 'NOT MY PROBLEM'];

  var STORE_KEY = 'tossit-arcade-best';

  /* ---------------------------------------------------------- state */

  var W = 0, H = 0, DPR = 1, focal = 800, cx = 0, cy = 0, horizon = 0;
  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var state = 'idle';      /* idle | ready | cops | over */
  var score = 0;
  var sticks = 0;
  var combo = 0;
  var dartsLeft = cfg.darts;
  /* stick one and you earn the dart back, so a hot streak keeps itself alive.
     Capped so the rack cannot outgrow the HUD. */
  var DART_CAP = 12;
  var best = 0;
  try { best = parseInt(localStorage.getItem(STORE_KEY), 10) || 0; } catch (e) {}

  var peds = [];
  var cars = [];
  var tauntTimer = 3.5;
  var pedSeq = 0;
  var carTimer = 3;

  /*
    The visitor. Very rarely a saucer rises over the skyline and hovers,
    charging its beam. Stick a dart in the hull before the beam fires and it
    spins down in smoke for big points; hesitate and it zaps your score.
  */
  /* the rat is not a target. The rat is a mood. */
  var rat = null;
  var ratTimer = 12 + Math.random() * 16;

  /* a gust now and then peels the cap off a capped head, and the fresh dome
     underneath is suddenly worth points - to his visible horror */
  var gustTimer = 14 + Math.random() * 16;
  var flyCaps = [];

  /* a dead-centre stick rings the dome like a temple bell */
  var gongs = [];

  var ufo = null;
  var ufoTimer = 26 + Math.random() * 26;
  var UFO_R = 62;          /* hull radius, cm */
  var UFO_SCORE = 250;
  var UFO_ZAP = 75;
  /*
    Back-to-back throws: every dart in the air is its own entry here, each
    with its own trail, so you can let the next one fly while the last is
    still arcing in. The old single `flying` slot forced a wait.
  */
  var flights = [];
  var pops = [];
  var sparks = [];
  var puffs = [];
  var shake = 0;
  var flash = 0;
  var badFlash = 0;
  /* the easter egg: three haired hits in one round brings the dome patrol */
  var wrongHits = 0;
  var copsT = 0;
  var copsShots = 0;
  var bangFlash = 0;
  var beatRed = 0;
  var copCar = null;
  var copsOut = false;
  var copA = null, copB = null;
  var copsHereT = 0;
  var swingL = 0;
  var swingR = 0;
  var raiseL = 0;
  var raiseR = 0;
  var soloSide = 1;
  var lastCall = null;
  var callLife = 0;

  var dragging = false;
  var aimX = 0, aimY = 0;
  var charge = 0;          /* 0..1, sweeps while you hold */
  var chargeT = 0;
  var target = null;       /* where the sight says the dart will land */
  var CHARGE_SWEEP = 1.15; /* seconds for one pass of the meter */
  var PERFECT = 0.62;      /* release here and it lands on the sight */
  var throwAnim = 0;
  var muted = root.dataset.sound !== 'true';

  var t0 = 0, raf = 0;
  var turnTimer = null;

  /* ---------------------------------------------------------- audio */

  var AC = null, master = null, noiseBuf = null, chargeOsc = null, chargeGain = null;

  function audio() {
    if (muted) return null;
    if (!AC) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      AC = new Ctor();
      master = AC.createGain();
      master.gain.value = 0.55;
      master.connect(AC.destination);
      var len = Math.floor(AC.sampleRate * 0.5);
      noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      /*
        iOS keeps a context silent until something has actually been played
        through it inside the gesture that created it. Creating and resuming
        is not enough on its own, so push one silent sample through now.
      */
      try {
        var unlock = AC.createBufferSource();
        unlock.buffer = AC.createBuffer(1, 1, AC.sampleRate);
        unlock.connect(AC.destination);
        unlock.start(0);
      } catch (e) {}
    }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }

  function noise(a) {
    var s = a.createBufferSource();
    s.buffer = noiseBuf;
    return s;
  }

  function env(a, node, t, peak, attack, decay) {
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0004, t + decay);
    node.connect(g);
    g.connect(master);
    return g;
  }

  /* the money sound: suction cup slapping a nice smooth head */
  function sfxSlap(strength) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var v = 0.55 + 0.45 * (strength || 1);

    var n = noise(a);
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2100, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.09);
    bp.Q.value = 0.7;
    n.connect(bp);
    env(a, bp, t, 0.95 * v, 0.003, 0.115);
    n.start(t);
    n.stop(t + 0.2);

    var thump = a.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(200, t);
    thump.frequency.exponentialRampToValueAtTime(62, t + 0.1);
    env(a, thump, t, 0.7 * v, 0.006, 0.19);
    thump.start(t);
    thump.stop(t + 0.24);

    var pop = a.createOscillator();
    pop.type = 'triangle';
    pop.frequency.setValueAtTime(820, t + 0.014);
    pop.frequency.exponentialRampToValueAtTime(170, t + 0.085);
    env(a, pop, t + 0.014, 0.36 * v, 0.008, 0.1);
    pop.start(t + 0.014);
    pop.stop(t + 0.14);
  }

  /* an indignant "HEY!" from the gentleman now wearing your dart */
  function sfxYell(pitch) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime + 0.09;
    var f0 = pitch || 128;

    var osc = a.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 0.86, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.22, t + 0.07);
    osc.frequency.linearRampToValueAtTime(f0 * 0.78, t + 0.3);

    var vib = a.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 15;
    var vibAmt = a.createGain();
    vibAmt.gain.value = f0 * 0.05;
    vib.connect(vibAmt);
    vibAmt.connect(osc.frequency);
    vib.start(t);
    vib.stop(t + 0.36);

    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.03);
    g.gain.setValueAtTime(0.45, t + 0.13);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.33);

    /* two vowel formants turn the buzz into a shout */
    var f1 = a.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(560, t);
    f1.frequency.linearRampToValueAtTime(700, t + 0.16);

    var f2 = a.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 7;
    f2.frequency.setValueAtTime(1500, t);
    f2.frequency.linearRampToValueAtTime(2100, t + 0.16);

    osc.connect(f1);
    osc.connect(f2);
    f1.connect(g);
    f2.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.38);
  }

  function sfxWhoosh(p) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var n = noise(a);
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(1900 + 900 * p, t + 0.26);
    n.connect(bp);
    env(a, bp, t, 0.2 + 0.14 * p, 0.05, 0.34);
    n.start(t);
    n.stop(t + 0.4);
  }

  function sfxThud() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var n = noise(a);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    n.connect(lp);
    env(a, lp, t, 0.4, 0.004, 0.17);
    n.start(t);
    n.stop(t + 0.24);

    var o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    env(a, o, t, 0.35, 0.008, 0.2);
    o.start(t);
    o.stop(t + 0.26);
  }

  /* dart off a wool coat: dull, no stick */
  function sfxFlop() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var n = noise(a);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.1);
    n.connect(lp);
    env(a, lp, t, 0.32, 0.004, 0.12);
    n.start(t);
    n.stop(t + 0.18);
  }

  /*
    A car pass-by, scheduled in one go at spawn rather than driven per frame:
    we already know when it reaches the middle of the view, so the swell,
    the pitch drop and the stereo sweep are all ramped to that moment.
  */
  function sfxCarPass(car) {
    var a = audio();
    if (!a) return;
    var now = a.currentTime;
    var eta = Math.abs(car.x) / Math.max(1, car.speed);
    var half = Math.min(2.4, Math.max(0.9, 520 / car.speed));
    var t0 = now + Math.max(0.02, eta - half);
    var t1 = now + Math.max(0.06, eta);
    var t2 = t1 + half;

    var near = car.z < 560;
    var big = car.kind.name === 'bus' || car.kind.name === 'van';
    var peak = (near ? 0.26 : 0.15) * (big ? 1.3 : 1);

    function panner() {
      if (!a.createStereoPanner) return null;
      var p = a.createStereoPanner();
      p.pan.setValueAtTime(-car.dir * 0.9, t0);
      p.pan.linearRampToValueAtTime(car.dir * 0.9, t2);
      return p;
    }

    /* tyre roar */
    var n = noise(a);
    n.loop = true;
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.55;
    bp.frequency.setValueAtTime(420, t0);
    bp.frequency.linearRampToValueAtTime(1500, t1);
    bp.frequency.linearRampToValueAtTime(380, t2);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t1);
    g.gain.exponentialRampToValueAtTime(0.0001, t2);
    n.connect(bp);
    bp.connect(g);
    var p1 = panner();
    if (p1) { g.connect(p1); p1.connect(master); } else { g.connect(master); }
    n.start(t0);
    n.stop(t2 + 0.05);

    /* engine, dropping in pitch as it goes past */
    var o = a.createOscillator();
    o.type = 'sawtooth';
    var f0 = (near ? 94 : 76) * (big ? 0.7 : 1);
    o.frequency.setValueAtTime(f0 * 1.14, t0);
    o.frequency.linearRampToValueAtTime(f0 * 1.06, t1);
    o.frequency.linearRampToValueAtTime(f0 * 0.84, t2);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;
    var og = a.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(peak * 0.55, t1);
    og.gain.exponentialRampToValueAtTime(0.0001, t2);
    o.connect(lp);
    lp.connect(og);
    var p2 = panner();
    if (p2) { og.connect(p2); p2.connect(master); } else { og.connect(master); }
    o.start(t0);
    o.stop(t2 + 0.05);
  }

  function sfxSiren() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var o = a.createOscillator();
    o.type = 'square';
    for (var i = 0; i < 7; i++) {
      o.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.42);
    }
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.15);
    g.gain.setValueAtTime(0.12, t + 2.6);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 3.3);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    o.connect(lp);
    lp.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 3.4);
  }

  function sfxThwack() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var n = noise(a);
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 1.1;
    var ng = a.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0004, t + 0.12);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(master);
    n.start(t);
    n.stop(t + 0.15);
    var o2 = a.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(110, t);
    o2.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    var g2 = a.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.6, t + 0.006);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + 0.2);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t);
    o2.stop(t + 0.24);
  }

  function sfxHonk() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    for (var i = 0; i < 2; i++) {
      var o = a.createOscillator();
      o.type = 'square';
      o.frequency.value = 370;
      var g = a.createGain();
      var t0 = t + i * 0.22;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + (i ? 0.3 : 0.14));
      var lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      o.connect(lp);
      lp.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + 0.34);
    }
  }

  function sfxBuzz() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var o = a.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(180, t);
    o.frequency.linearRampToValueAtTime(96, t + 0.34);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.36);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    o.connect(lp);
    lp.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  function sfxClang() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var partials = [520, 812, 1290, 1810];
    for (var i = 0; i < partials.length; i++) {
      var o = a.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(partials[i], t);
      o.frequency.exponentialRampToValueAtTime(partials[i] * 0.92, t + 0.4);
      var g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13 / (i + 1), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.42 - i * 0.06);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.5);
    }
    var n = noise(a);
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 1.2;
    n.connect(bp);
    env(a, bp, t, 0.3, 0.003, 0.09);
    n.start(t);
    n.stop(t + 0.14);
  }

  function sfxChime(notes, vol) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    for (var i = 0; i < notes.length; i++) {
      var o = a.createOscillator();
      o.type = 'triangle';
      o.frequency.value = notes[i];
      var st = t + i * 0.07;
      var g = a.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(vol || 0.24, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, st + 0.32);
      o.connect(g);
      g.connect(master);
      o.start(st);
      o.stop(st + 0.36);
    }
  }

  /* ------------------------------------------------------- music bed */
  /*
    A little four-bar chiptune loop, synthesised rather than loaded, so the
    section stays a single file. Two pulse voices and a triangle bass for the
    NES flavour, over a four-on-the-floor kick for the techno side.

    Notes are scheduled well ahead of the clock instead of per animation
    frame: a backgrounded tab throttles both rAF and timers, and anything
    scheduled late would drop out audibly.
  */
  var music = { on: false, timer: null, next: 0, step: 0, gain: null, pulse: null, pulse2: null };

  var BPM = 138;
  var STEP16 = 60 / BPM / 4;
  var LOOKAHEAD = 2.0;

  /* Am - F - C - G, the most video-game progression there is */
  var BARS = [
    { root: 45, tones: [57, 60, 64, 69] },
    { root: 41, tones: [53, 57, 60, 65] },
    { root: 48, tones: [55, 60, 64, 67] },
    { root: 43, tones: [55, 59, 62, 67] }
  ];
  var LEAD = [0, 2, 1, 3, 2, 0, 3, 1, 2, 3, 1, 2, 0, 2, 3, 2];
  var LEAD_ON = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1];

  function midiHz(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  /* square-ish pulse wave, the sound of a NES pulse channel */
  function makePulse(a, duty) {
    var n = 22;
    var real = new Float32Array(n);
    var imag = new Float32Array(n);
    for (var i = 1; i < n; i++) {
      imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    }
    return a.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function blip(a, wave, hz, t, dur, vol) {
    var o = a.createOscillator();
    if (wave === 'tri') o.type = 'triangle';
    else o.setPeriodicWave(wave);
    o.frequency.setValueAtTime(hz, t);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(music.gain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function musicStep(i, t) {
    var a = AC;
    if (!a || !music.gain) return;
    var bar = BARS[(i >> 4) % 4];
    var b = i & 15;

    /* kick on every beat */
    if (b % 4 === 0) {
      var k = a.createOscillator();
      k.type = 'sine';
      k.frequency.setValueAtTime(120, t);
      k.frequency.exponentialRampToValueAtTime(42, t + 0.1);
      var kg = a.createGain();
      kg.gain.setValueAtTime(0.0001, t);
      kg.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      k.connect(kg);
      kg.connect(music.gain);
      k.start(t);
      k.stop(t + 0.2);
    }

    /* clap on the backbeat */
    if (b === 4 || b === 12) {
      var n = noise(a);
      var bp = a.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 0.8;
      var ng = a.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.42, t + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      n.connect(bp); bp.connect(ng); ng.connect(music.gain);
      n.start(t); n.stop(t + 0.14);
    }

    /* offbeat hat */
    if (b % 2 === 1) {
      var h = noise(a);
      var hp = a.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      var hg = a.createGain();
      hg.gain.setValueAtTime(0.0001, t);
      hg.gain.exponentialRampToValueAtTime(b % 4 === 3 ? 0.16 : 0.09, t + 0.003);
      hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      h.connect(hp); hp.connect(hg); hg.connect(music.gain);
      h.start(t); h.stop(t + 0.06);
    }

    /* bass: root with an octave lift, the Mario walk */
    if (b % 2 === 0) {
      var oct = (b % 8 === 4) ? 12 : 0;
      blip(a, 'tri', midiHz(bar.root + oct), t, STEP16 * 1.7, 0.5);
    }

    /* lead arpeggio */
    if (LEAD_ON[b]) {
      blip(a, music.pulse, midiHz(bar.tones[LEAD[b]] + 12), t, STEP16 * 1.3, 0.14);
    }

    /* thin counter-line an octave up, every other bar */
    if ((i >> 4) % 2 === 1 && b % 4 === 2) {
      blip(a, music.pulse2, midiHz(bar.tones[(LEAD[b] + 2) % 4] + 24), t, STEP16 * 1.1, 0.06);
    }
  }

  function musicTick() {
    if (!AC || !music.on || !music.gain) return;
    while (music.next < AC.currentTime + LOOKAHEAD) {
      musicStep(music.step, music.next);
      music.next += STEP16;
      music.step = (music.step + 1) % 64;
    }
  }

  function musicStart() {
    var a = audio();
    if (!a || music.on) return;
    music.gain = a.createGain();
    music.gain.gain.value = 0;
    music.gain.connect(master);
    /* fade in so it does not slam in on the first frame */
    music.gain.gain.setValueAtTime(0.0001, a.currentTime);
    music.gain.gain.linearRampToValueAtTime(0.13, a.currentTime + 1.2);
    music.pulse = makePulse(a, 0.5);
    music.pulse2 = makePulse(a, 0.25);
    music.on = true;
    music.step = 0;
    music.next = a.currentTime + 0.1;
    musicTick();
    music.timer = setInterval(musicTick, 250);
  }

  function musicStop() {
    if (music.timer) clearInterval(music.timer);
    music.timer = null;
    music.on = false;
    if (music.gain) {
      try { music.gain.disconnect(); } catch (e) {}
      music.gain = null;
    }
  }

  function chargeStart() {
    var a = audio();
    if (!a || chargeOsc) return;
    chargeOsc = a.createOscillator();
    chargeOsc.type = 'sawtooth';
    chargeGain = a.createGain();
    chargeGain.gain.value = 0.0001;
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    chargeOsc.connect(lp);
    lp.connect(chargeGain);
    chargeGain.connect(master);
    chargeOsc.frequency.value = 90;
    chargeOsc.start();
    chargeGain.gain.linearRampToValueAtTime(0.045, a.currentTime + 0.08);
  }

  function chargeUpdate(p) {
    if (!chargeOsc || !AC) return;
    chargeOsc.frequency.setTargetAtTime(90 + p * 210, AC.currentTime, 0.04);
  }

  function chargeStop() {
    if (!chargeOsc || !AC) return;
    var o = chargeOsc, g = chargeGain, t = AC.currentTime;
    chargeOsc = null;
    chargeGain = null;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.stop(t + 0.1);
  }

  /* ---------------------------------------------------------- layout */

  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(rect.width);
    H = Math.round(rect.height);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    focal = W * 0.85;
    cx = W / 2;
    cy = H * 0.4;
    horizon = cy;
    buildScene();
  }

  function proj(x, y, z) {
    var s = focal / Math.max(z, 1);
    return { x: cx + x * s, y: cy - y * s, s: s };
  }

  /* deterministic noise so the city looks the same on every repaint */
  var seed = 1;
  function srand() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }

  /* ---------------------------------------------------------- the city */

  var scene = null;
  var lampGlows = [];

  var NEAR_CURB_Z = 400;   /* nearest ground the camera can actually see */
  var FAR_CURB_Z = 615;    /* far side of the avenue */
  var WALK_Z = 680;         /* where the crowd strolls past the park */
  var WALL_Z = 960;         /* the low stone park wall */
  var CURB_H = 16;
  var PATH_HALF = 130;      /* half width of the path out of the park */

  function buildScene() {
    if (!W || !H) return;
    seed = 20260731;
    lampGlows = [];

    scene = document.createElement('canvas');
    scene.width = Math.round(W * DPR);
    scene.height = Math.round(H * DPR);
    var s = scene.getContext('2d');
    s.setTransform(DPR, 0, 0, DPR, 0, 0);

    /*
      Sky is three flat brand bands with a hard-edged sun, not a soft
      photographic gradient. That single choice sets the whole look.
    */
    s.fillStyle = '#241748';
    s.fillRect(0, 0, W, horizon + 6);
    s.fillStyle = '#6c2a5e';
    s.fillRect(0, horizon - H * 0.26, W, H * 0.26 + 6);
    s.fillStyle = '#c04a35';
    s.fillRect(0, horizon - H * 0.13, W, H * 0.13 + 6);
    /* warm band right on the horizon: this is what the treeline reads against */
    s.fillStyle = '#e8a021';
    s.fillRect(0, horizon - H * 0.052, W, H * 0.052 + 6);

    /* flat sun sitting on the treeline */
    /* modest sun that the skyline sits in front of, plus a halo painted back
       over the buildings so the overlap looks deliberate rather than clipped */
    var sunR = Math.min(W, H) * 0.15;
    var sunX = cx + W * 0.05;
    var sunY = horizon - H * 0.095;
    s.fillStyle = '#edbd00';
    s.beginPath();
    s.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    s.fill();
    var sun = { x: sunX, y: sunY, r: sunR };
    scene.__sun = sun;

    for (var st = 0; st < 70; st++) {
      s.fillStyle = 'rgba(255,255,255,' + (0.25 + srand() * 0.5).toFixed(2) + ')';
      var sy = srand() * horizon * 0.5;
      s.fillRect(srand() * W, sy, 2, 2);
    }

    drawParkSkyline(s, sun);

    if (scene.__sun) {
      var g = s.createRadialGradient(
        scene.__sun.x, scene.__sun.y, scene.__sun.r * 0.5,
        scene.__sun.x, scene.__sun.y, scene.__sun.r * 2.6
      );
      g.addColorStop(0, 'rgba(237,189,0,0.34)');
      g.addColorStop(1, 'rgba(237,189,0,0)');
      s.fillStyle = g;
      s.fillRect(0, 0, W, horizon + 6);
    }

    /* ground: two flat values, no gradient */
    s.fillStyle = '#241d33';
    s.fillRect(0, horizon, W, H - horizon);

    drawSkyLife(s);
    drawParkFloor(s);
    drawTreeLine(s);
    drawParkWall(s);
    drawFarSidewalk(s);
    drawAvenue(s);
    drawNearKerb(s);
    drawNearSidewalk(s);
    drawParkProps(s);
  }

  /*
    The sky gets a life of its own: a starfield thickening toward the top,
    two flat inked clouds catching the sunset from below, and birds heading
    home. Everything scales off the sky band so a tall phone canvas - which
    has far more sky - gets proportionally more of it.
  */
  function drawSkyLife(s) {
    var skyH = horizon - H * 0.26;
    if (skyH < 30) return;

    for (var i = 0; i < Math.round(skyH * W / 6500); i++) {
      var sx2 = srand() * W;
      var sy2 = srand() * skyH * (srand() < 0.7 ? 0.75 : 1);
      var tw = 0.35 + srand() * 0.65;
      s.globalAlpha = tw * (1 - sy2 / (skyH + 1)) + 0.12;
      s.fillStyle = srand() < 0.12 ? '#ffd9a0' : '#f6efdd';
      s.fillRect(sx2, sy2, srand() < 0.15 ? 2.4 : 1.4, srand() < 0.15 ? 2.4 : 1.4);
    }
    s.globalAlpha = 1;

    /* flat sunset clouds, lit from beneath */
    for (var c = 0; c < 2; c++) {
      var cy2 = skyH * (0.18 + c * 0.26) + srand() * skyH * 0.08;
      var cx2 = W * (c === 0 ? 0.2 : 0.74) + (srand() - 0.5) * W * 0.12;
      var cw = W * (0.16 + srand() * 0.08);
      var ch = cw * 0.1;
      s.globalAlpha = 0.55;
      s.beginPath();
      s.ellipse(cx2, cy2, cw, ch, 0, 0, Math.PI * 2);
      s.ellipse(cx2 + cw * 0.5, cy2 + ch * 0.5, cw * 0.5, ch * 0.85, 0, 0, Math.PI * 2);
      s.ellipse(cx2 - cw * 0.45, cy2 + ch * 0.35, cw * 0.42, ch * 0.7, 0, 0, Math.PI * 2);
      s.fillStyle = '#4a3568';
      s.fill();
      s.globalAlpha = 0.4;
      s.beginPath();
      s.ellipse(cx2, cy2 + ch * 0.7, cw * 0.8, ch * 0.42, 0, 0, Math.PI * 2);
      s.fillStyle = '#e8a021';
      s.fill();
      s.globalAlpha = 1;
    }

    /* a loose V of birds */
    s.strokeStyle = '#17141b';
    s.lineWidth = Math.max(1.2, W * 0.0016);
    s.lineCap = 'round';
    var bx = W * 0.62, by = skyH * 0.3;
    for (var b = 0; b < 5; b++) {
      var ox = bx + b * W * 0.022 + (b % 2) * W * 0.008;
      var oy = by + Math.abs(b - 2) * skyH * 0.045;
      var ww = W * 0.008;
      s.beginPath();
      s.moveTo(ox - ww, oy);
      s.quadraticCurveTo(ox - ww * 0.3, oy - ww * 0.8, ox, oy);
      s.quadraticCurveTo(ox + ww * 0.3, oy - ww * 0.8, ox + ww, oy);
      s.stroke();
    }
  }

  /*
    The near sidewalk: the strip of pavement the player is standing on. On a
    wide desktop crop it is a sliver, but a tall phone canvas can show a lot
    of blank floor - so it gets seams, a drain grate, a hydrant and some
    chalked practice rings to stand on.
  */
  function drawNearSidewalk(s) {
    var kerbTop = proj(0, STREET_Y + CURB_H, 300).y;
    if (kerbTop >= H - 4) return;

    s.fillStyle = '#565064';
    s.fillRect(0, kerbTop, W, H - kerbTop);

    /* kerb lip */
    s.fillStyle = '#6d6579';
    s.fillRect(0, kerbTop, W, Math.max(3, H * 0.008));

    /* radiating pavement seams */
    s.strokeStyle = 'rgba(23,20,27,0.55)';
    s.lineWidth = 2;
    for (var x = -2000; x <= 2000; x += 260) {
      var a = proj(x, STREET_Y + CURB_H, 300);
      var b2 = proj(x * 2.6, STREET_Y + CURB_H, 90);
      s.beginPath();
      s.moveTo(a.x, a.y);
      s.lineTo(b2.x, H + 10);
      s.stroke();
    }
    /* one lateral seam */
    var mid = kerbTop + (H - kerbTop) * 0.45;
    s.beginPath();
    s.moveTo(0, mid);
    s.lineTo(W, mid);
    s.stroke();

    var deep = H - kerbTop;

    /* drain grate, off to the left */
    var gx = W * 0.17, gy = kerbTop + deep * 0.26;
    var gw = Math.min(W * 0.075, deep * 0.16), gh = gw * 0.42;
    s.fillStyle = '#2c2738';
    s.beginPath();
    s.ellipse(gx, gy, gw, gh, 0, 0, Math.PI * 2);
    s.fill();
    s.strokeStyle = '#17141b';
    s.lineWidth = 2;
    s.stroke();
    s.lineWidth = Math.max(1, gw * 0.06);
    for (var g = -2; g <= 2; g++) {
      s.beginPath();
      s.moveTo(gx + g * gw * 0.3, gy - gh * 0.62);
      s.lineTo(gx + g * gw * 0.3, gy + gh * 0.62);
      s.stroke();
    }

    /* chalked practice ring: the player's mark on the pavement */
    if (deep > H * 0.14) {
      var rx = W * 0.78, ry = kerbTop + deep * 0.55;
      s.strokeStyle = 'rgba(237,189,0,0.4)';
      s.lineWidth = Math.max(2, W * 0.004);
      s.setLineDash([9, 7]);
      s.beginPath();
      s.ellipse(rx, ry, W * 0.1, deep * 0.1, 0, 0, Math.PI * 2);
      s.stroke();
      s.beginPath();
      s.ellipse(rx, ry, W * 0.045, deep * 0.045, 0, 0, Math.PI * 2);
      s.stroke();
      s.setLineDash([]);
    }

    /*
      Hydrant on the right. It stands on the nearest pavement in the frame,
      so it scales off how deep that band is rather than viewport width -
      sized off W it came out ten pixels tall on a phone, a hydrant for ants.
    */
    if (deep > H * 0.1) {
      var hw = Math.max(18, Math.min(56, deep * 0.16));
      var hh = hw * 1.75;
      var hx = W * 0.87;
      var hb = kerbTop + deep * 0.36;
      var ink = Math.max(2, hw * 0.09);

      s.strokeStyle = '#17141b';
      s.lineJoin = 'round';
      s.lineCap = 'round';

      /* ground shadow */
      s.beginPath();
      s.ellipse(hx, hb + hw * 0.1, hw * 1.05, hw * 0.22, 0, 0, Math.PI * 2);
      s.fillStyle = 'rgba(0,0,0,0.3)';
      s.fill();

      /* base flange */
      s.fillStyle = '#9c3b26';
      s.lineWidth = ink;
      s.beginPath();
      if (s.roundRect) s.roundRect(hx - hw * 0.72, hb - hw * 0.34, hw * 1.44, hw * 0.4, hw * 0.1);
      else s.rect(hx - hw * 0.72, hb - hw * 0.34, hw * 1.44, hw * 0.4);
      s.fill();
      s.stroke();

      /* barrel, slightly tapered */
      s.fillStyle = '#b8492f';
      s.beginPath();
      s.moveTo(hx - hw * 0.5, hb - hw * 0.3);
      s.lineTo(hx - hw * 0.42, hb - hh * 0.82);
      s.lineTo(hx + hw * 0.42, hb - hh * 0.82);
      s.lineTo(hx + hw * 0.5, hb - hw * 0.3);
      s.closePath();
      s.fill();
      s.stroke();

      /* collar under the bonnet */
      s.fillStyle = '#9c3b26';
      s.beginPath();
      if (s.roundRect) s.roundRect(hx - hw * 0.56, hb - hh * 0.88, hw * 1.12, hw * 0.18, hw * 0.06);
      else s.rect(hx - hw * 0.56, hb - hh * 0.88, hw * 1.12, hw * 0.18);
      s.fill();
      s.stroke();

      /* bonnet dome + stem nut */
      s.fillStyle = '#b8492f';
      s.beginPath();
      s.ellipse(hx, hb - hh * 0.88, hw * 0.44, hw * 0.4, 0, Math.PI, Math.PI * 2);
      s.fill();
      s.stroke();
      s.fillStyle = '#e8a021';
      s.beginPath();
      s.ellipse(hx, hb - hh * 0.88 - hw * 0.38, hw * 0.13, hw * 0.09, 0, 0, Math.PI * 2);
      s.fill();
      s.lineWidth = ink * 0.7;
      s.stroke();

      /* side nozzle caps */
      s.lineWidth = ink;
      s.fillStyle = '#9c3b26';
      s.beginPath();
      s.ellipse(hx - hw * 0.58, hb - hh * 0.5, hw * 0.17, hw * 0.2, 0, 0, Math.PI * 2);
      s.fill();
      s.stroke();
      s.beginPath();
      s.ellipse(hx + hw * 0.58, hb - hh * 0.5, hw * 0.17, hw * 0.2, 0, 0, Math.PI * 2);
      s.fill();
      s.stroke();

      /* front cap with its nut */
      s.fillStyle = '#9c3b26';
      s.beginPath();
      s.ellipse(hx, hb - hh * 0.44, hw * 0.24, hw * 0.26, 0, 0, Math.PI * 2);
      s.fill();
      s.stroke();
      s.fillStyle = '#e8a021';
      s.beginPath();
      s.ellipse(hx, hb - hh * 0.44, hw * 0.09, hw * 0.1, 0, 0, Math.PI * 2);
      s.fill();
      s.lineWidth = ink * 0.7;
      s.stroke();

      /* highlight down the barrel */
      s.strokeStyle = 'rgba(255,255,255,0.28)';
      s.lineWidth = Math.max(1.6, hw * 0.1);
      s.beginPath();
      s.moveTo(hx - hw * 0.26, hb - hh * 0.76);
      s.lineTo(hx - hw * 0.3, hb - hw * 0.42);
      s.stroke();
    }
  }

  /* one flat ink silhouette, no window detail competing with the crowd */
  /*
    One continuous silhouette. Drawing separate rectangles left gaps that let
    the bright sky bands through, which read as a barcode rather than a city.
  */
  function drawParkSkyline(s, sun) {
    var base = horizon + 8;
    /* the block the sun sits in, where the rooflines drop away */
    var gapL = sun ? sun.x - sun.r * 1.5 : 0;
    var gapR = sun ? sun.x + sun.r * 1.5 : 0;
    var maxTop = sun ? sun.y + sun.r * 0.62 : 0;

    s.fillStyle = '#1d1430';
    s.beginPath();
    s.moveTo(-40, base);
    var x = -40;
    var tops = [];
    while (x < W + 40) {
      var bw = 34 + srand() * 78;
      var bh = 60 + srand() * H * 0.28;
      if (sun && x + bw > gapL && x < gapR) {
        /* keep this roof below the disc so the sun never gets a flat bite
           taken out of it */
        bh = Math.min(bh, Math.max(30, base - maxTop));
      }
      s.lineTo(x, base - bh);
      s.lineTo(x + bw, base - bh);
      tops.push({ x: x, w: bw, top: base - bh });
      x += bw;
    }
    s.lineTo(W + 40, base);
    s.closePath();
    s.fill();

    /* a handful of lit windows, not a grid */
    s.fillStyle = 'rgba(237,189,0,0.55)';
    for (var i = 0; i < tops.length; i++) {
      var t = tops[i];
      if (srand() > 0.55) continue;
      var n = 1 + Math.floor(srand() * 3);
      for (var j = 0; j < n; j++) {
        s.fillRect(t.x + 8 + srand() * (t.w - 16), t.top + 14 + srand() * (base - t.top - 26), 3, 4);
      }
    }
  }

  function drawParkFloor(s) {
    quad(
      s,
      proj(-PATH_HALF, STREET_Y + CURB_H, WALL_Z),
      proj(PATH_HALF, STREET_Y + CURB_H, WALL_Z),
      proj(PATH_HALF * 0.5, STREET_Y + CURB_H, 2400),
      proj(-PATH_HALF * 0.5, STREET_Y + CURB_H, 2400)
    );
    s.fillStyle = '#4a4054';
    s.fill();

    for (var side = -1; side <= 1; side += 2) {
      quad(
        s,
        proj(PATH_HALF * side, STREET_Y + CURB_H, WALL_Z),
        proj(1400 * side, STREET_Y + CURB_H, WALL_Z),
        proj(1400 * side, STREET_Y + CURB_H, 2400),
        proj(PATH_HALF * 0.5 * side, STREET_Y + CURB_H, 2400)
      );
      s.fillStyle = '#1f3326';
      s.fill();
    }
  }

  /* bold canopy blobs with an ink edge, two flat greens for depth */
  /*
    Each canopy is one merged path. Stroking the blobs individually drew a
    ring wherever two overlapped, so they go down as a single nonzero fill
    with a soft vertical gradient instead of an ink edge.
  */
  function drawTreeLine(s) {
    for (var layer = 0; layer < 2; layer++) {
      var z = 1620 - layer * 420;
      var sc = focal / z;
      var top = layer === 0 ? '#2f5232' : '#3d6b3f';
      var bot = layer === 0 ? '#16281a' : '#1e3a22';

      for (var i = 0; i < 22; i++) {
        var tx = -1500 + (i / 21) * 3000 + (srand() - 0.5) * 130;
        if (Math.abs(tx) < 250 + layer * 90) continue;
        var th = 300 + srand() * 210;
        var base = proj(tx, STREET_Y + CURB_H, z);
        var tp = proj(tx, STREET_Y + th, z);
        var rad = (62 + srand() * 40) * sc;

        /* brown trunk, no hard outline */
        s.strokeStyle = layer === 0 ? '#4a3122' : '#5e3f2b';
        s.lineWidth = Math.max(1.5, 15 * sc);
        s.lineCap = 'round';
        s.beginPath();
        s.moveTo(base.x, base.y);
        s.lineTo(tp.x, tp.y + rad * 0.5);
        s.stroke();

        var blobs = [
          { x: tp.x, y: tp.y, r: rad },
          { x: tp.x - rad * 0.7, y: tp.y + rad * 0.3, r: rad * 0.68 },
          { x: tp.x + rad * 0.72, y: tp.y + rad * 0.26, r: rad * 0.62 },
          { x: tp.x - rad * 0.3, y: tp.y - rad * 0.5, r: rad * 0.55 },
          { x: tp.x + rad * 0.34, y: tp.y - rad * 0.46, r: rad * 0.5 }
        ];

        var minY = tp.y - rad * 1.1;
        var maxY = tp.y + rad * 1.05;
        var g = s.createLinearGradient(0, minY, 0, maxY);
        g.addColorStop(0, top);
        g.addColorStop(1, bot);

        s.beginPath();
        for (var bI = 0; bI < blobs.length; bI++) {
          var c = blobs[bI];
          s.moveTo(c.x + c.r, c.y);
          s.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        }
        s.fillStyle = g;
        s.fill();
      }
    }
  }

  function drawParkWall(s) {
    for (var side = -1; side <= 1; side += 2) {
      var inner = PATH_HALF * side;
      var outer = 1500 * side;
      quad(
        s,
        proj(inner, STREET_Y + 78, WALL_Z), proj(outer, STREET_Y + 78, WALL_Z),
        proj(outer, STREET_Y + CURB_H, WALL_Z), proj(inner, STREET_Y + CURB_H, WALL_Z)
      );
      s.fillStyle = '#5a5064';
      s.fill();
      s.strokeStyle = '#17141b';
      s.lineWidth = 2;
      s.stroke();

      quad(
        s,
        proj(inner, STREET_Y + 92, WALL_Z - 8), proj(outer, STREET_Y + 92, WALL_Z - 8),
        proj(outer, STREET_Y + 78, WALL_Z - 8), proj(inner, STREET_Y + 78, WALL_Z - 8)
      );
      s.fillStyle = '#6f6479';
      s.fill();
      s.stroke();

      var px2 = inner + 26 * side;
      quad(
        s,
        proj(px2 - 24 * side, STREET_Y + 156, WALL_Z), proj(px2 + 24 * side, STREET_Y + 156, WALL_Z),
        proj(px2 + 24 * side, STREET_Y + CURB_H, WALL_Z), proj(px2 - 24 * side, STREET_Y + CURB_H, WALL_Z)
      );
      s.fillStyle = '#6f6479';
      s.fill();
      s.stroke();
      quad(
        s,
        proj(px2 - 30 * side, STREET_Y + 172, WALL_Z - 6), proj(px2 + 30 * side, STREET_Y + 172, WALL_Z - 6),
        proj(px2 + 30 * side, STREET_Y + 156, WALL_Z - 6), proj(px2 - 30 * side, STREET_Y + 156, WALL_Z - 6)
      );
      s.fillStyle = '#87798f';
      s.fill();
      s.stroke();
    }
  }

  function drawFarSidewalk(s) {
    quad(
      s,
      proj(-2000, STREET_Y + CURB_H, FAR_CURB_Z), proj(2000, STREET_Y + CURB_H, FAR_CURB_Z),
      proj(2000, STREET_Y + CURB_H, WALL_Z), proj(-2000, STREET_Y + CURB_H, WALL_Z)
    );
    s.fillStyle = '#4c4457';
    s.fill();

    quad(
      s,
      proj(-2000, STREET_Y + CURB_H, FAR_CURB_Z), proj(2000, STREET_Y + CURB_H, FAR_CURB_Z),
      proj(2000, STREET_Y, FAR_CURB_Z), proj(-2000, STREET_Y, FAR_CURB_Z)
    );
    s.fillStyle = '#635a70';
    s.fill();

    s.strokeStyle = 'rgba(23,20,27,0.5)';
    s.lineWidth = 1.5;
    for (var x = -1200; x <= 1200; x += 130) {
      var a = proj(x, STREET_Y + CURB_H, FAR_CURB_Z);
      var b = proj(x, STREET_Y + CURB_H, WALL_Z);
      s.beginPath();
      s.moveTo(a.x, a.y);
      s.lineTo(b.x, b.y);
      s.stroke();
    }
  }

  function drawAvenue(s) {
    quad(
      s,
      proj(-2400, STREET_Y, NEAR_CURB_Z), proj(2400, STREET_Y, NEAR_CURB_Z),
      proj(2400, STREET_Y, FAR_CURB_Z), proj(-2400, STREET_Y, FAR_CURB_Z)
    );
    s.fillStyle = '#1b1826';
    s.fill();

    var mh = proj(-260, STREET_Y, 438);
    var mhs = focal / 438;
    s.fillStyle = '#2c2738';
    s.beginPath();
    s.ellipse(mh.x, mh.y, 46 * mhs, 15 * mhs, 0, 0, Math.PI * 2);
    s.fill();
    s.strokeStyle = '#17141b';
    s.lineWidth = 2;
    s.stroke();

    for (var x = -2200; x < 2200; x += 220) {
      quad(
        s,
        proj(x, STREET_Y, 512), proj(x + 120, STREET_Y, 512),
        proj(x + 120, STREET_Y, 528), proj(x, STREET_Y, 528)
      );
      s.fillStyle = '#edbd00';
      s.fill();
    }
  }

  function drawNearKerb(s) {
    quad(
      s,
      proj(-2400, STREET_Y + CURB_H, 300), proj(2400, STREET_Y + CURB_H, 300),
      proj(2400, STREET_Y + CURB_H, NEAR_CURB_Z), proj(-2400, STREET_Y + CURB_H, NEAR_CURB_Z)
    );
    s.fillStyle = '#4c4457';
    s.fill();
    quad(
      s,
      proj(-2400, STREET_Y + CURB_H, NEAR_CURB_Z), proj(2400, STREET_Y + CURB_H, NEAR_CURB_Z),
      proj(2400, STREET_Y, NEAR_CURB_Z), proj(-2400, STREET_Y, NEAR_CURB_Z)
    );
    s.fillStyle = '#635a70';
    s.fill();
  }

  function drawParkProps(s) {
    for (var i = -5; i <= 5; i++) {
      if (Math.abs(i) < 1) continue;
      var lx = i * 240;
      var lz = WALL_Z - 30;
      var sc = focal / lz;
      var base = proj(lx, STREET_Y + CURB_H, lz);
      var top = proj(lx, STREET_Y + 320, lz);
      s.strokeStyle = '#17141b';
      s.lineWidth = Math.max(1.4, 9 * sc);
      s.beginPath();
      s.moveTo(base.x, base.y);
      s.lineTo(top.x, top.y);
      s.stroke();

      var r = Math.max(3, 15 * sc);
      var lg = s.createRadialGradient(top.x, top.y, 0, top.x, top.y, r * 6);
      lg.addColorStop(0, 'rgba(237,189,0,0.55)');
      lg.addColorStop(1, 'rgba(237,189,0,0)');
      s.fillStyle = lg;
      s.beginPath();
      s.arc(top.x, top.y, r * 6, 0, Math.PI * 2);
      s.fill();

      s.fillStyle = '#f5d23a';
      s.strokeStyle = '#17141b';
      s.lineWidth = Math.max(1, 3 * sc);
      s.beginPath();
      s.arc(top.x, top.y, r * 0.8, 0, Math.PI * 2);
      s.fill();
      s.stroke();

      lampGlows.push({ x: lx, y: STREET_Y + 320, z: lz });
    }

    for (var b = -4; b <= 4; b++) {
      var bx = b * 210 + (srand() - 0.5) * 60;
      if (Math.abs(bx) < 150) continue;
      var bz = FAR_CURB_Z + 40 + srand() * 130;
      var bs = focal / bz;
      var roll = srand();
      s.strokeStyle = '#17141b';
      s.lineWidth = Math.max(1, 3 * bs);

      if (roll > 0.55) {
        var bp = proj(bx, STREET_Y + CURB_H, bz);
        s.fillStyle = '#8a5a34';
        s.beginPath();
        s.rect(bp.x - 62 * bs, bp.y - 48 * bs, 124 * bs, 11 * bs);
        s.fill(); s.stroke();
        s.beginPath();
        s.rect(bp.x - 62 * bs, bp.y - 88 * bs, 124 * bs, 11 * bs);
        s.fill(); s.stroke();
        s.fillStyle = '#2b2536';
        s.beginPath();
        s.rect(bp.x - 58 * bs, bp.y - 48 * bs, 9 * bs, 48 * bs);
        s.fill(); s.stroke();
        s.beginPath();
        s.rect(bp.x + 49 * bs, bp.y - 48 * bs, 9 * bs, 48 * bs);
        s.fill(); s.stroke();
      } else if (roll > 0.3) {
        var tp = proj(bx, STREET_Y + CURB_H, bz);
        s.fillStyle = '#2f6f52';
        s.beginPath();
        s.rect(tp.x - 20 * bs, tp.y - 62 * bs, 40 * bs, 62 * bs);
        s.fill(); s.stroke();
        s.beginPath();
        s.rect(tp.x - 25 * bs, tp.y - 70 * bs, 50 * bs, 9 * bs);
        s.fill(); s.stroke();
      }
    }

    /* hot dog cart, in brand red */
    var cz = FAR_CURB_Z + 70;
    var cs = focal / cz;
    var cp = proj(-430, STREET_Y + CURB_H, cz);
    s.strokeStyle = '#17141b';
    s.lineWidth = Math.max(1, 3 * cs);
    s.fillStyle = '#dfd3b8';
    s.beginPath();
    s.rect(cp.x - 62 * cs, cp.y - 96 * cs, 124 * cs, 62 * cs);
    s.fill(); s.stroke();
    s.fillStyle = '#e0503f';
    s.beginPath();
    s.rect(cp.x - 76 * cs, cp.y - 152 * cs, 152 * cs, 18 * cs);
    s.fill(); s.stroke();
    s.beginPath();
    s.moveTo(cp.x - 60 * cs, cp.y - 152 * cs);
    s.lineTo(cp.x - 60 * cs, cp.y - 96 * cs);
    s.moveTo(cp.x + 60 * cs, cp.y - 152 * cs);
    s.lineTo(cp.x + 60 * cs, cp.y - 96 * cs);
    s.stroke();
    s.fillStyle = '#17141b';
    s.beginPath();
    s.arc(cp.x - 34 * cs, cp.y - 16 * cs, 17 * cs, 0, Math.PI * 2);
    s.fill();
    s.beginPath();
    s.arc(cp.x + 34 * cs, cp.y - 16 * cs, 17 * cs, 0, Math.PI * 2);
    s.fill();
  }

  function quad(s, a, b, c, d) {
    s.beginPath();
    s.moveTo(a.x, a.y);
    s.lineTo(b.x, b.y);
    s.lineTo(c.x, c.y);
    s.lineTo(d.x, d.y);
    s.closePath();
  }

  /* ---------------------------------------------------------- pedestrians */

  /*
    Tossit house style: flat fills, heavy ink outlines, a tight palette drawn
    from the packaging. Everything below draws as filled paths that get inked
    afterwards, which is what keeps it looking screen-printed rather than
    like a generic vector scene.
  */
  var INK = '#17141b';
  var CREAM = '#f6efdd';

  var SKINS = ['#f0bd8f', '#dda06c', '#c07f4c', '#98603a', '#f7d2ac', '#7a4b2c'];
  var GARMENTS = [
    '#e0503f', '#3f9d92', '#e8b02a', '#3c5f96', '#b8492f',
    '#5b4a86', '#2f6f52', '#d9752c', '#31424f', '#a8355c'
  ];
  var UNDERS = ['#f6efdd', '#dfd3b8', '#c9d6d4', '#efd9c0'];
  var PANTS = ['#2f3a4d', '#3b3340', '#4a4033', '#2b3b33', '#514455', '#38404a', '#5c4632'];
  var GARMENTS_CUT = ['plain', 'plain', 'zip', 'stripes', 'puffer', 'vest', 'suit'];
  var HAIR_COLORS = ['#2b2028', '#17141b', '#5a3a22', '#8d7a63', '#c9bfae', '#7d3a2c'];

  var HAIR = ['bald', 'horseshoe', 'horseshoe', 'tufts', 'combover'];
  var MOPS_M = ['mop', 'slick', 'curly', 'cap', 'afro', 'flattop'];
  var MOPS_F = ['bob', 'pony', 'bun', 'longf', 'curlyf', 'braids'];

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  /* fill the current path flat, then ink the edge */
  function pickOne(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function saySomething(p, text, life, kind) {
    if (!p) return;
    p.say = { text: text, life: life || 2.2, max: life || 2.2, kind: kind || 'taunt' };
  }

  /* someone on the near pavement, in frame, not already talking */
  function heckler(baldOnly) {
    var pool = [];
    for (var i = 0; i < peds.length; i++) {
      var q = peds[i];
      if (q.stage !== 'walk' || q.mode !== 'walk' || q.say || q.darts.length) continue;
      if (baldOnly && !q.bald) continue;
      if (Math.abs(q.x) > 0.38 * q.z) continue;
      pool.push(q);
    }
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  /* the big fella is having a day, and it shows across the forehead */
  function drawVeins(hp, hr, time) {
    var throb = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * 5.5));
    ctx.save();
    ctx.strokeStyle = 'rgba(150,40,55,' + (0.55 + 0.35 * throb).toFixed(3) + ')';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var veins = [
      [[-0.62, -0.52], [-0.42, -0.2], [-0.5, 0.02], [-0.34, 0.16]],
      [[-0.2, -0.78], [-0.12, -0.46], [-0.26, -0.28], [-0.14, -0.06]],
      [[0.26, -0.76], [0.2, -0.44], [0.36, -0.26], [0.28, -0.02]],
      [[0.64, -0.5], [0.46, -0.22], [0.56, 0.0], [0.4, 0.14]]
    ];
    for (var v = 0; v < veins.length; v++) {
      var pts = veins[v];
      ctx.lineWidth = Math.max(0.9, hr * (0.05 + 0.022 * throb));
      ctx.beginPath();
      ctx.moveTo(hp.x + pts[0][0] * hr, hp.y + pts[0][1] * hr);
      for (var i = 1; i < pts.length; i++) {
        ctx.lineTo(hp.x + pts[i][0] * hr, hp.y + pts[i][1] * hr);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* comic bubble over his head, kept inside the frame */
  function drawSpeech(p, hp, hr) {
    var say = p.say;
    var fade = Math.min(1, say.life / 0.35) * Math.min(1, (say.max - say.life) / 0.12);
    if (fade <= 0) return;

    var fs = Math.max(9, Math.min(16, hr * 0.66));
    ctx.save();
    ctx.font = '800 ' + fs.toFixed(1) + 'px ui-monospace, Menlo, Consolas, monospace';
    var tw = ctx.measureText(say.text).width;
    var padX = fs * 0.72, padY = fs * 0.5;
    var w = tw + padX * 2;
    var h = fs + padY * 2;

    var bx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, hp.x));
    var by = hp.y - hr - h * 0.62 - fs * 0.7;

    var fill = say.kind === 'hit' ? '#e0503f' : (say.kind === 'smug' ? CREAM : '#edbd00');
    var ink = say.kind === 'hit' ? CREAM : INK;

    ctx.globalAlpha = fade;

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(hp.x - fs * 0.3, by + h / 2 - 1);
    ctx.lineTo(hp.x + fs * 0.3, by + h / 2 - 1);
    ctx.lineTo(hp.x, hp.y - hr * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, fs * 0.14);
    ctx.stroke();

    roundRect(ctx, bx - w / 2, by - h / 2, w, h, h * 0.42);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, fs * 0.14);
    ctx.stroke();

    ctx.fillStyle = fill;
    ctx.fillRect(hp.x - fs * 0.28, by + h / 2 - Math.max(1.4, fs * 0.2), fs * 0.56, Math.max(1.6, fs * 0.22));

    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(say.text, bx, by + 0.5);
    ctx.restore();
  }

  function inked(fill, lw) {
    ctx.fillStyle = fill;
    ctx.fill();
    if (lw > 0.35) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  var CAR_KINDS = [
    { name: 'cab', len: 250, h: 84, color: '#edbd00', roof: true },
    { name: 'sedan', len: 240, h: 80, color: '#3c5f96', roof: false },
    { name: 'sedan', len: 240, h: 80, color: '#a8355c', roof: false },
    { name: 'van', len: 300, h: 116, color: '#f6efdd', roof: false },
    { name: 'bus', len: 470, h: 142, color: '#2f6f52', roof: false }
  ];

  function spawnCar() {
    var dir = Math.random() > 0.5 ? 1 : -1;
    /* near lane runs one way, far lane the other, like a real avenue */
    var near = dir > 0;
    var pool = near ? CAR_KINDS.slice(0, 3) : CAR_KINDS;
    var kind = pool[Math.floor(Math.random() * pool.length)];
    var z = near ? 468 + Math.random() * 22 : 552 + Math.random() * 22;
    return {
      kind: kind,
      z: z,
      dir: dir,
      x: -dir * (1.1 * z + kind.len),
      speed: 240 + Math.random() * 220
    };
  }

  function seedCrowd() {
    peds = [];
    cars = [];
    carTimer = 2.5;
    var d = cfg.diff;
    for (var i = 0; i < d.count; i++) {
      var p = spawnPed(WALK_Z + 260 + i * 340);
      /* start a couple of them already out on the pavement */
      if (i < 2) {
        p.stage = 'walk';
        p.z = p.turnZ;
        p.x = (Math.random() * 2 - 1) * 0.3 * p.z;
      }
      peds.push(p);
    }
  }

  function headWorld(p) {
    var bob = p.mode === 'flee' ? Math.sin(p.phase * 2.6) * 2.4 : Math.sin(p.phase * 2) * 1.3;
    var r = HEAD_R * p.k * (p.headScale || 1);
    /* chin stays put on the neck however big the dome gets */
    return {
      x: p.x,
      y: STREET_Y + (146 * p.k) + r + bob,
      z: p.z,
      r: r
    };
  }

  function hasBoss() {
    for (var i = 0; i < peds.length; i++) {
      if (peds[i].boss) return true;
    }
    return false;
  }

  function spawnPed(z, boss) {
    var d = cfg.diff;
    var fem = boss ? false : Math.random() < 0.45;
    var h = boss ? 176 : (fem ? 152 : 160) + Math.random() * 24;
    /* only smooth heads are landable, so that decides who is a target */
    var bald = boss ? true : (fem ? Math.random() < 0.4 : Math.random() < 0.62);

    return {
      id: ++pedSeq,
      boss: !!boss,
      fem: fem,
      headScale: boss ? 2.35 : 1,
      stage: 'approach',
      z: z,
      x: (Math.random() * 2 - 1) * PATH_HALF * 0.62,
      turnZ: WALK_Z - 55 + Math.random() * 110,
      dir: Math.random() > 0.5 ? 1 : -1,
      h: h,
      k: h / 168,
      build: boss ? 1.24 : (fem ? 0.78 : 0.9) + Math.random() * 0.3,
      speed: (d.speed[0] + Math.random() * (d.speed[1] - d.speed[0])) * (boss ? 0.62 : 1),
      phase: Math.random() * 6.28,
      skin: boss ? '#e08a5c' : pick(SKINS),
      coat: boss ? '#8d3f2c' : pick(GARMENTS),
      under: pick(UNDERS),
      pants: pick(PANTS),
      cut: boss ? 'plain' : pick(GARMENTS_CUT),
      scarf: Math.random() < 0.22,
      pack: Math.random() < 0.18,
      bald: bald,
      hair: pick(HAIR),
      mop: fem ? pick(MOPS_F) : pick(MOPS_M),
      hairColor: pick(HAIR_COLORS),
      facial: boss || fem ? 'none' : pick(['none', 'none', 'stache', 'goatee', 'beard']),
      brow: pick(['flat', 'raised', 'soft']),
      skirt: fem ? Math.random() < 0.5 : false,
      bag: Math.random() < 0.3,
      specs: boss ? false : Math.random() > 0.78,
      voice: boss ? 66 : (fem ? 170 + Math.random() * 70 : 92 + Math.random() * 70),
      mode: 'walk',
      timer: 0,
      darts: [],
      anger: 0
    };
  }

  /* a pedestrian already at street depth, walking on from past the frame */
  function spawnFromSide() {
    var p = spawnPed(WALK_Z - 55 + Math.random() * 110, false);
    p.stage = 'walk';
    p.z = Math.max(430, Math.min(940, p.z));
    p.dir = Math.random() > 0.5 ? 1 : -1;
    /* start just beyond the frustum edge on the side they enter from */
    p.x = -p.dir * (0.44 * p.z + 60 + Math.random() * 80);
    return p;
  }

  function limb(x, y, len, ang, w, color, lw) {
    var ex = x + Math.sin(ang) * len * 0.45;
    var ey = y + Math.cos(ang) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (lw > 0.35) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = w + lw * 2;
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    return { x: ex, y: ey };
  }

  function drawPed(p, time) {
    ctx.save();

    var k = p.k;
    var bw = p.build;
    var s = focal / p.z;
    var ks = k * s;
    var lw = Math.max(0.6, 2.4 * s);          /* ink weight, scaled by depth */
    var feet = proj(p.x, STREET_Y, p.z);
    var head = headWorld(p);
    var hp = proj(head.x, head.y, head.z);
    var hr = head.r * s;

    var run = p.mode === 'flee';
    var cyc = p.phase * (run ? 2.6 : 1.5);
    var swing = run ? 0.8 : 0.36;
    var lean = run ? p.dir * 0.16 : p.dir * 0.03;

    var hipY = feet.y - 88 * ks;
    var shoY = feet.y - 140 * ks;
    var halfSho = (p.fem ? 18 : 21) * bw * ks;
    var hipHalf = halfSho * 0.42;
    var legLen = 88 * ks;
    var legW = Math.max(1.6, (p.fem ? 9 : 11) * bw * ks);
    var armW = Math.max(1.3, (p.fem ? 7 : 8) * bw * ks);
    var armLen = 78 * ks;
    var armY = shoY + 8 * ks;

    /* contact shadow */
    ctx.beginPath();
    ctx.ellipse(feet.x, feet.y, 26 * bw * ks, 7 * ks, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fill();

    ctx.save();
    ctx.translate(feet.x, feet.y);
    ctx.rotate(lean);
    ctx.translate(-feet.x, -feet.y);

    /*
      Both legs go down BEFORE the torso. Drawing the near leg afterwards was
      what pushed a rounded hip cap up over the coat.
    */
    var legTop = hipY + legW * 0.35;
    var farA = Math.sin(cyc + Math.PI) * swing;
    var nearA = Math.sin(cyc) * swing;
    var farFoot = limb(feet.x - hipHalf, legTop, legLen, farA, legW, shade(p.pants, -0.22), lw);
    var nearFoot = limb(feet.x + hipHalf, legTop, legLen, nearA, legW, p.pants, lw);

    shoe(farFoot, ks, bw, p.dir, lw);
    shoe(nearFoot, ks, bw, p.dir, lw);

    /* skirt reads as one bold shape over the tops of the legs */
    if (p.skirt) {
      ctx.beginPath();
      ctx.moveTo(feet.x - halfSho * 0.86, hipY - 26 * ks);
      ctx.lineTo(feet.x + halfSho * 0.86, hipY - 26 * ks);
      ctx.lineTo(feet.x + halfSho * 1.24, hipY + 20 * ks);
      ctx.lineTo(feet.x - halfSho * 1.24, hipY + 20 * ks);
      ctx.closePath();
      inked(shade(p.pants, 0.06), lw);
    }

    /*
      Torso is filled, then the garment detail is drawn clipped inside it, then
      the outline goes on last. Clipping is what keeps stripes and quilting
      inside the silhouette instead of leaking past the shoulders.
    */
    function torsoPath() {
      ctx.beginPath();
      ctx.moveTo(feet.x - halfSho, shoY);
      ctx.quadraticCurveTo(feet.x - halfSho * 1.08, hipY, feet.x - halfSho * (p.fem ? 0.7 : 0.86), hipY + 14 * ks);
      ctx.lineTo(feet.x + halfSho * (p.fem ? 0.7 : 0.86), hipY + 14 * ks);
      ctx.quadraticCurveTo(feet.x + halfSho * 1.08, hipY, feet.x + halfSho, shoY);
      ctx.quadraticCurveTo(feet.x, shoY - 10 * ks, feet.x - halfSho, shoY);
      ctx.closePath();
    }

    torsoPath();
    ctx.fillStyle = p.coat;
    ctx.fill();

    ctx.save();
    torsoPath();
    ctx.clip();
    drawGarment(p, feet.x, shoY, hipY, halfSho, ks, lw);
    ctx.restore();

    torsoPath();
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* collar */
    ctx.beginPath();
    ctx.moveTo(feet.x - halfSho * 0.4, shoY - 1 * ks);
    ctx.lineTo(feet.x + halfSho * 0.4, shoY - 1 * ks);
    ctx.lineTo(feet.x, shoY + 30 * ks);
    ctx.closePath();
    inked(p.under, lw * 0.7);

    if (p.scarf) {
      ctx.beginPath();
      ctx.ellipse(feet.x, shoY + 5 * ks, halfSho * 0.6, 7 * ks, 0, 0, Math.PI * 2);
      inked('#c4453a', lw * 0.7);
    }

    /* arms hang off the shoulder line, drawn over the coat */
    var farAng = Math.sin(cyc) * swing * 0.55;
    var nearAng = Math.sin(cyc + Math.PI) * swing * 0.55;
    if (p.mode === 'cop') {
      var cw = (p === copA ? raiseL : raiseR);
      var cs2 = (p === copA ? swingL : swingR);
      if (cs2 > 0 || cw > 0) {
        /* right arm (far side) is the club arm and matches it exactly */
        farAng = copClubAngle(cw, cs2).ang;
        /* the left wags a slow disappointed finger the whole time */
        nearAng = -2.95 + Math.sin(time * 9 + p.phase) * 0.3;
      } else if (p.z <= 200) {
        /* arrived and looming: hands on hips */
        farAng = -0.85;
        nearAng = 0.85;
      }
    }
    var farHand = limb(feet.x - halfSho * 0.92, armY, armLen, farAng, armW, shade(p.coat, -0.28), lw);
    var nearHand = limb(feet.x + halfSho * 0.92, armY, armLen, nearAng, armW, shade(p.coat, 0.06), lw);

    ctx.beginPath();
    ctx.arc(farHand.x, farHand.y, armW * 0.5, 0, Math.PI * 2);
    inked(p.skin, lw * 0.7);
    ctx.beginPath();
    ctx.arc(nearHand.x, nearHand.y, armW * 0.5, 0, Math.PI * 2);
    inked(p.skin, lw * 0.7);

    if (p.bag && hr > 6) {
      ctx.beginPath();
      roundRect(ctx, nearHand.x - 9 * ks, nearHand.y, 18 * ks, 20 * ks, 3 * ks);
      inked(shade(p.under, -0.35), lw * 0.8);
    }

    /* neck */
    ctx.beginPath();
    ctx.rect(feet.x - 5 * ks, shoY - 13 * ks, 10 * ks, 17 * ks);
    inked(shade(p.skin, -0.22), lw * 0.7);

    ctx.restore();

    drawHead(p, hp, hr, time, lw);

    if (p.say) drawSpeech(p, hp, hr);

    for (var di = 0; di < p.darts.length; di++) {
      var pd = p.darts[di];
      drawWorldDart(
        { x: head.x + pd.ox, y: head.y + pd.oy, z: p.z - DART_LEN * 0.42 },
        { x: pd.tx, y: pd.ty, z: 0.97 },
        pd.color, pd.roll, false
      );
    }

    if (p.mode !== 'walk' && p.anger > 0.15) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.anger);
      ctx.strokeStyle = '#e0503f';
      ctx.lineWidth = Math.max(1.4, hr * 0.16);
      ctx.lineCap = 'round';
      var ax = hp.x + hr * 1.35;
      var ay = hp.y - hr * 1.15;
      for (var i = 0; i < 3; i++) {
        var aa = -0.55 + i * 0.5 + Math.sin(time * 8) * 0.08;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.cos(aa) * hr * 0.6, ay + Math.sin(aa) * hr * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /* the pattern layer that makes two people in the same coat colour differ */
  function drawGarment(p, x, shoY, hipY, halfSho, ks, lw) {
    var torso = hipY - shoY;
    var cut = p.cut;

    if (cut === 'stripes') {
      ctx.fillStyle = shade(p.coat, 0.34);
      for (var y = shoY + torso * 0.16; y < hipY + 16 * ks; y += torso * 0.22) {
        ctx.fillRect(x - halfSho * 1.2, y, halfSho * 2.4, torso * 0.1);
      }
    } else if (cut === 'puffer') {
      ctx.strokeStyle = shade(p.coat, -0.3);
      ctx.lineWidth = Math.max(0.8, 2.4 * ks);
      for (var q = 1; q < 5; q++) {
        var yy = shoY + (torso * q) / 5;
        ctx.beginPath();
        ctx.moveTo(x - halfSho * 1.2, yy);
        ctx.lineTo(x + halfSho * 1.2, yy);
        ctx.stroke();
      }
    } else if (cut === 'zip') {
      ctx.fillStyle = shade(p.coat, 0.3);
      ctx.fillRect(x - 2 * ks, shoY + torso * 0.12, 4 * ks, torso * 0.95);
    } else if (cut === 'vest') {
      ctx.fillStyle = shade(p.coat, -0.34);
      ctx.beginPath();
      ctx.moveTo(x - halfSho * 0.6, shoY + torso * 0.06);
      ctx.lineTo(x - halfSho * 0.2, shoY + torso * 0.06);
      ctx.lineTo(x, shoY + torso * 0.42);
      ctx.lineTo(x + halfSho * 0.2, shoY + torso * 0.06);
      ctx.lineTo(x + halfSho * 0.6, shoY + torso * 0.06);
      ctx.lineTo(x + halfSho * 0.6, hipY + 16 * ks);
      ctx.lineTo(x - halfSho * 0.6, hipY + 16 * ks);
      ctx.closePath();
      ctx.fill();
    } else if (cut === 'suit') {
      ctx.fillStyle = shade(p.coat, 0.2);
      ctx.beginPath();
      ctx.moveTo(x - halfSho * 0.42, shoY);
      ctx.lineTo(x - halfSho * 0.06, shoY + torso * 0.5);
      ctx.lineTo(x - halfSho * 0.5, shoY + torso * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + halfSho * 0.42, shoY);
      ctx.lineTo(x + halfSho * 0.06, shoY + torso * 0.5);
      ctx.lineTo(x + halfSho * 0.5, shoY + torso * 0.34);
      ctx.closePath();
      ctx.fill();
      /* tie */
      ctx.fillStyle = '#b8352f';
      ctx.beginPath();
      ctx.moveTo(x - 3 * ks, shoY + torso * 0.22);
      ctx.lineTo(x + 3 * ks, shoY + torso * 0.22);
      ctx.lineTo(x + 4.5 * ks, shoY + torso * 0.74);
      ctx.lineTo(x, shoY + torso * 0.84);
      ctx.lineTo(x - 4.5 * ks, shoY + torso * 0.74);
      ctx.closePath();
      ctx.fill();
    }

    /* backpack straps over whatever is underneath */
    if (p.pack) {
      ctx.strokeStyle = shade(p.pants, -0.25);
      ctx.lineWidth = Math.max(1, 5 * ks);
      ctx.beginPath();
      ctx.moveTo(x - halfSho * 0.55, shoY);
      ctx.lineTo(x - halfSho * 0.42, hipY - 4 * ks);
      ctx.moveTo(x + halfSho * 0.55, shoY);
      ctx.lineTo(x + halfSho * 0.42, hipY - 4 * ks);
      ctx.stroke();
    }
  }

  function shoe(at, ks, bw, dir, lw) {
    ctx.beginPath();
    ctx.ellipse(at.x + dir * 3 * ks, at.y + 1 * ks, 8 * bw * ks, 3.6 * ks, 0, 0, Math.PI * 2);
    inked(INK, lw * 0.6);
  }

  function drawHead(p, hp, hr, time, lw) {
    var mad = p.mode !== 'walk';

    ctx.save();
    if (mad) {
      ctx.translate(hp.x, hp.y);
      ctx.rotate(Math.sin(time * 42 + p.phase) * 0.06 * Math.max(0, p.anger));
      ctx.translate(-hp.x, -hp.y);
    }

    /* ears */
    ctx.beginPath();
    ctx.ellipse(hp.x - hr * 0.92, hp.y + hr * 0.12, hr * 0.18, hr * 0.26, 0, 0, Math.PI * 2);
    inked(shade(p.skin, -0.16), lw * 0.7);
    ctx.beginPath();
    ctx.ellipse(hp.x + hr * 0.92, hp.y + hr * 0.12, hr * 0.18, hr * 0.26, 0, 0, Math.PI * 2);
    inked(shade(p.skin, -0.16), lw * 0.7);

    /* skull */
    ctx.beginPath();
    ctx.ellipse(hp.x, hp.y, hr * 0.88, hr, 0, 0, Math.PI * 2);
    inked(p.skin, lw);

    if (!p.bald) drawMop(p, hp, hr, lw);
    else drawFringe(p, hp, hr, lw);

    if (p.bald) {
      /*
        A bald head is the only thing a suction cup grabs, so it has to read
        instantly. The highlight is a compact upright glint set off to one
        side, the way light catches a sphere. A wide streak across the crown
        read as the brim of a cap and hid the very thing being hunted for.
      */
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y, hr * 0.88, hr, 0, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = 'rgba(255,252,238,0.82)';
      ctx.beginPath();
      ctx.ellipse(hp.x - hr * 0.34, hp.y - hr * 0.3, hr * 0.15, hr * 0.27, -0.28, 0, Math.PI * 2);
      ctx.fill();

      /* a small sparkle above it, kept well clear of the silhouette edge */
      ctx.fillStyle = 'rgba(255,252,238,0.5)';
      ctx.beginPath();
      ctx.ellipse(hp.x - hr * 0.1, hp.y - hr * 0.55, hr * 0.09, hr * 0.12, -0.3, 0, Math.PI * 2);
      ctx.fill();

      /* bounce light down the far side, which reads as roundness not a brim */
      ctx.strokeStyle = 'rgba(255,238,196,0.3)';
      ctx.lineWidth = Math.max(0.8, hr * 0.09);
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y, hr * 0.78, hr * 0.9, 0, Math.PI * 0.1, Math.PI * 0.6);
      ctx.stroke();
      ctx.restore();
    }

    if (p.boss) drawVeins(hp, hr, time);

    if (hr > 7) {
      var browOut = -hr * 0.06, browIn = hr * 0.04;
      if (p.brow === 'raised') { browOut = -hr * 0.14; browIn = -hr * 0.02; }
      else if (p.brow === 'soft') { browOut = -hr * 0.02; browIn = -hr * 0.02; }
      if (mad) { browOut = hr * 0.02; browIn = hr * 0.22; }

      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(0.9, hr * 0.11);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hp.x - hr * 0.5, hp.y + browOut);
      ctx.lineTo(hp.x - hr * 0.16, hp.y + browIn);
      ctx.moveTo(hp.x + hr * 0.5, hp.y + browOut);
      ctx.lineTo(hp.x + hr * 0.16, hp.y + browIn);
      ctx.stroke();

      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.ellipse(hp.x - hr * 0.33, hp.y + hr * 0.24, hr * 0.085, hr * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hp.x + hr * 0.33, hp.y + hr * 0.24, hr * 0.085, hr * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();

      if (p.specs) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(0.7, hr * 0.07);
        ctx.beginPath();
        ctx.arc(hp.x - hr * 0.33, hp.y + hr * 0.24, hr * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hp.x + hr * 0.33, hp.y + hr * 0.24, hr * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hp.x - hr * 0.13, hp.y + hr * 0.24);
        ctx.lineTo(hp.x + hr * 0.13, hp.y + hr * 0.24);
        ctx.stroke();
      }

      ctx.strokeStyle = shade(p.skin, -0.34);
      ctx.lineWidth = Math.max(0.7, hr * 0.08);
      ctx.beginPath();
      ctx.moveTo(hp.x + hr * 0.02, hp.y + hr * 0.3);
      ctx.lineTo(hp.x + hr * 0.1, hp.y + hr * 0.5);
      ctx.stroke();

      ctx.fillStyle = p.hairColor;
      if (p.facial === 'stache') {
        ctx.beginPath();
        ctx.ellipse(hp.x, hp.y + hr * 0.6, hr * 0.3, hr * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.facial === 'goatee') {
        ctx.beginPath();
        ctx.ellipse(hp.x, hp.y + hr * 0.58, hr * 0.22, hr * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hp.x, hp.y + hr * 0.86, hr * 0.15, hr * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.facial === 'beard') {
        ctx.beginPath();
        ctx.ellipse(hp.x, hp.y + hr * 0.56, hr * 0.7, hr * 0.46, 0, 0, Math.PI);
        ctx.fill();
      }

      if (mad) {
        ctx.beginPath();
        ctx.ellipse(hp.x, hp.y + hr * 0.76, hr * 0.19, hr * 0.16, 0, 0, Math.PI * 2);
        inked('#5c2320', lw * 0.6);
      } else if (p.facial !== 'beard') {
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(0.7, hr * 0.08);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y + hr * 0.58, hr * 0.24, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
      }
    }

    if (mad && p.anger > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y, hr * 0.88, hr, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(224,80,63,' + (0.3 * Math.min(1, p.anger)).toFixed(3) + ')';
      ctx.fillRect(hp.x - hr, hp.y - hr, hr * 2, hr * 2);
      ctx.restore();
    }

    ctx.restore();
  }

  /* what is left around a bald head */
  function drawFringe(p, hp, hr, lw) {
    if (p.hair === 'bald') return;
    ctx.strokeStyle = p.hairColor;
    ctx.lineCap = 'round';
    if (p.hair === 'horseshoe' || p.hair === 'combover') {
      ctx.lineWidth = Math.max(1, hr * 0.2);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y + hr * 0.06, hr * 0.85, Math.PI * 0.14, Math.PI * 0.86);
      ctx.stroke();
    }
    if (p.hair === 'tufts') {
      ctx.lineWidth = Math.max(1, hr * 0.22);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, hr * 0.85, Math.PI * 0.14, Math.PI * 0.34);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, hr * 0.85, Math.PI * 0.66, Math.PI * 0.86);
      ctx.stroke();
    }
    if (p.hair === 'combover') {
      ctx.lineWidth = Math.max(0.8, hr * 0.1);
      ctx.beginPath();
      ctx.moveTo(hp.x - hr * 0.72, hp.y - hr * 0.42);
      ctx.quadraticCurveTo(hp.x, hp.y - hr * 1.0, hp.x + hr * 0.58, hp.y - hr * 0.58);
      ctx.stroke();
    }
  }

  /* a full head of hair: no landing surface, so these are the ones to avoid */
  function drawMop(p, hp, hr, lw) {
    var col = p.mop === 'cap' ? shade(p.coat, 0.22) : p.hairColor;

    if (p.mop === 'cophat') {
      var lift2 = 0;
      var tilt2 = 0;
      if (p.hatPop > 0) {
        /* the blow knocks it clean off the crown for a beat */
        var hb = Math.sin((p.hatPop / 0.3) * Math.PI);
        lift2 = hb * hr * 0.7;
        tilt2 = hb * 0.3;
      }
      ctx.save();
      ctx.translate(hp.x, hp.y - lift2);
      ctx.rotate(tilt2);
      /* crown */
      ctx.beginPath();
      ctx.ellipse(0, -hr * 0.52, hr * 0.82, hr * 0.5, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(hr * 0.92, -hr * 0.3);
      ctx.lineTo(-hr * 0.92, -hr * 0.3);
      ctx.closePath();
      inked('#1d2b4d', lw);
      /* band */
      ctx.beginPath();
      ctx.rect(-hr * 0.92, -hr * 0.42, hr * 1.84, hr * 0.14);
      inked('#17141b', lw * 0.6);
      /* visor */
      ctx.beginPath();
      ctx.ellipse(0, -hr * 0.28, hr * 0.95, hr * 0.2, 0, 0, Math.PI);
      inked('#17141b', lw * 0.6);
      /* badge */
      ctx.beginPath();
      ctx.arc(0, -hr * 0.66, hr * 0.14, 0, Math.PI * 2);
      inked(YELLOW, lw * 0.5);
      ctx.restore();
      return;
    }

    if (p.mop === 'cap') {
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y, hr * 0.95, hr * 1.05, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(hp.x + hr * 0.95, hp.y + hr * 0.1);
      ctx.lineTo(hp.x - hr * 0.95, hp.y + hr * 0.1);
      ctx.closePath();
      inked(col, lw);
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y + hr * 0.08, hr * 1.0, hr * 0.15, 0, 0, Math.PI * 2);
      inked(shade(col, -0.28), lw * 0.7);
      return;
    }

    if (p.mop === 'afro') {
      ctx.beginPath();
      ctx.ellipse(hp.x, hp.y - hr * 0.38, hr * 1.12, hr * 0.98, 0, 0, Math.PI * 2);
      inked(col, lw);
      return;
    }

    if (p.mop === 'flattop') {
      ctx.beginPath();
      ctx.moveTo(hp.x - hr * 0.92, hp.y - hr * 0.1);
      ctx.lineTo(hp.x - hr * 0.86, hp.y - hr * 1.28);
      ctx.lineTo(hp.x + hr * 0.86, hp.y - hr * 1.28);
      ctx.lineTo(hp.x + hr * 0.92, hp.y - hr * 0.1);
      ctx.closePath();
      inked(col, lw);
      return;
    }

    if (p.mop === 'braids') {
      for (var bi = -1; bi <= 1; bi += 2) {
        for (var bj = 0; bj < 3; bj++) {
          ctx.beginPath();
          ctx.arc(hp.x + bi * hr * 0.88, hp.y + hr * (0.1 + bj * 0.42), hr * 0.17, 0, Math.PI * 2);
          inked(col, lw * 0.6);
        }
      }
    }

    if (p.mop === 'pony' || p.mop === 'bun') {
      ctx.beginPath();
      if (p.mop === 'bun') {
        ctx.arc(hp.x, hp.y - hr * 1.12, hr * 0.34, 0, Math.PI * 2);
      } else {
        ctx.ellipse(hp.x - hr * 1.0, hp.y + hr * 0.3, hr * 0.24, hr * 0.6, 0.3, 0, Math.PI * 2);
      }
      inked(col, lw);
    }

    /* base cap that hugs the skull and stops above the brows */
    ctx.beginPath();
    ctx.ellipse(hp.x, hp.y, hr * 0.93, hr * 1.03, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(hp.x + hr * 0.93, hp.y - hr * 0.12);
    ctx.lineTo(hp.x - hr * 0.93, hp.y - hr * 0.12);
    ctx.closePath();
    inked(col, lw);

    if (p.mop === 'curly' || p.mop === 'curlyf') {
      for (var i = 0; i <= 6; i++) {
        var a2 = Math.PI * 1.04 + (i / 6) * Math.PI * 0.92;
        ctx.beginPath();
        ctx.arc(hp.x + Math.cos(a2) * hr * 0.76, hp.y + Math.sin(a2) * hr * 0.84, hr * 0.27, 0, Math.PI * 2);
        inked(col, lw * 0.6);
      }
    } else if (p.mop === 'longf' || p.mop === 'bob') {
      var drop = p.mop === 'bob' ? 0.5 : 1.0;
      ctx.beginPath();
      ctx.ellipse(hp.x - hr * 0.84, hp.y + hr * drop * 0.42, hr * 0.26, hr * (0.5 + drop * 0.3), 0, 0, Math.PI * 2);
      inked(col, lw * 0.8);
      ctx.beginPath();
      ctx.ellipse(hp.x + hr * 0.84, hp.y + hr * drop * 0.42, hr * 0.26, hr * (0.5 + drop * 0.3), 0, 0, Math.PI * 2);
      inked(col, lw * 0.8);
    } else if (p.mop === 'mop') {
      ctx.beginPath();
      ctx.moveTo(hp.x - hr * 0.93, hp.y - hr * 0.14);
      ctx.quadraticCurveTo(hp.x - hr * 0.1, hp.y + hr * 0.24, hp.x + hr * 0.88, hp.y - hr * 0.24);
      ctx.lineTo(hp.x + hr * 0.92, hp.y - hr * 0.5);
      ctx.lineTo(hp.x - hr * 0.92, hp.y - hr * 0.5);
      ctx.closePath();
      inked(col, lw * 0.7);
    }
  }

  /*
    The officer's club arm, drawn over the figure. The same shoulder math as
    drawPed, one arm that rises overhead on the wind-up and whips down at the
    camera on the strike, club lengthening as it comes at the lens.
  */
  /*
    The club hand. Regulation states the billy club is carried in the right
    hand, and the right hand only - which for a figure facing the camera is
    the viewer's left. The wind-up is a full windmill: the arm cranks two and
    a half accelerating circles like a pitcher who has seen too many
    cartoons, then the strike lunges at the lens.
  */
  function copClubAngle(wind, strike) {
    if (strike > 0) {
      var q = 1 - strike / 0.22;
      return { ang: -2.5 + q * 3.3, stretch: 1 + q * 0.7 };
    }
    var e = wind * wind;
    return { ang: 0.5 - e * 15.7, stretch: 1 + Math.sin(e * 15.7) * 0.06 };
  }

  function drawCopArm(p, wind, strike) {
    if (wind <= 0 && strike <= 0) return;
    var sfac = focal / p.z;
    var ks = p.k * sfac;
    var feet = proj(p.x, STREET_Y, p.z);
    var shoY = feet.y - 140 * ks;
    var halfSho = 21 * p.build * ks;
    var sx = feet.x - halfSho * 0.92;      /* his right, our left */
    var sy = shoY + 8 * ks;

    var swing = copClubAngle(wind, strike);
    var ang = swing.ang;
    var clubLen = 120 * ks * swing.stretch;

    var armLen = 66 * ks;
    var hx = sx + Math.sin(ang) * armLen;
    var hy = sy + Math.cos(ang) * armLen;

    ctx.save();
    ctx.lineCap = 'round';
    /* arm */
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9 * p.build * ks + Math.max(1.2, 2.4 * sfac);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = shade(p.coat, 0.08);
    ctx.lineWidth = 9 * p.build * ks;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    /* fist */
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5 * ks, 0, Math.PI * 2);
    ctx.fillStyle = p.skin;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, 1.6 * sfac);
    ctx.stroke();
    /* the club continues past the fist */
    var cx2 = hx + Math.sin(ang) * clubLen;
    var cy2 = hy + Math.cos(ang) * clubLen;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8 * ks + Math.max(1.2, 2.4 * sfac);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.strokeStyle = '#4a3020';
    ctx.lineWidth = 8 * ks;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCar(car) {
    var k = car.kind;
    var sc = focal / car.z;
    var g = proj(car.x, STREET_Y, car.z);
    var L = k.len * sc;
    var Hh = k.h * sc;

    ctx.save();

    /* shadow on the tarmac */
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, L * 0.52, Hh * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    var wheelR = Hh * 0.19;
    ctx.fillStyle = '#0b0b10';
    ctx.beginPath();
    ctx.arc(g.x - L * 0.31, g.y - wheelR * 0.75, wheelR, 0, Math.PI * 2);
    ctx.arc(g.x + L * 0.31, g.y - wheelR * 0.75, wheelR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a3a44';
    ctx.beginPath();
    ctx.arc(g.x - L * 0.31, g.y - wheelR * 0.75, wheelR * 0.42, 0, Math.PI * 2);
    ctx.arc(g.x + L * 0.31, g.y - wheelR * 0.75, wheelR * 0.42, 0, Math.PI * 2);
    ctx.fill();

    var bodyBottom = g.y - wheelR * 0.5;

    /*
      The body is drawn with its windshield raked toward -x, so a car heading
      right was being drawn facing backwards. Mirror it to face the way it
      travels; the front window then falls on the leading side for free.
    */
    ctx.save();
    if (car.dir > 0) {
      ctx.translate(g.x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-g.x, 0);
    }

    ctx.fillStyle = k.color;

    if (k.name === 'bus' || k.name === 'van') {
      roundRect(ctx, g.x - L * 0.5, bodyBottom - Hh, L, Hh, Hh * 0.12);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,200,225,0.4)';
      var wn = k.name === 'bus' ? 5 : 3;
      for (var i = 0; i < wn; i++) {
        ctx.fillRect(
          g.x - L * 0.42 + i * (L * 0.84 / wn),
          bodyBottom - Hh * 0.82,
          L * 0.84 / wn - L * 0.03, Hh * 0.36
        );
      }
    } else {
      roundRect(ctx, g.x - L * 0.5, bodyBottom - Hh * 0.62, L, Hh * 0.62, Hh * 0.14);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(g.x - L * 0.26, bodyBottom - Hh * 0.6);
      ctx.quadraticCurveTo(g.x - L * 0.16, bodyBottom - Hh, g.x + L * 0.04, bodyBottom - Hh);
      ctx.lineTo(g.x + L * 0.2, bodyBottom - Hh);
      ctx.quadraticCurveTo(g.x + L * 0.3, bodyBottom - Hh * 0.94, g.x + L * 0.33, bodyBottom - Hh * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(160,200,225,0.42)';
      ctx.beginPath();
      ctx.moveTo(g.x - L * 0.2, bodyBottom - Hh * 0.64);
      ctx.lineTo(g.x - L * 0.11, bodyBottom - Hh * 0.94);
      ctx.lineTo(g.x + L * 0.18, bodyBottom - Hh * 0.94);
      ctx.lineTo(g.x + L * 0.26, bodyBottom - Hh * 0.64);
      ctx.closePath();
      ctx.fill();
    }

    if (car.bird > 0) {
      /*
        The driver leans out of the FRONT window, on whichever end of the car
        is leading, and gives you the finger. Built as real shapes rather than
        strokes: a fist with knuckles and one finger standing proud of it, so
        it still reads at the size a car takes up on screen.
      */
      var boxy = k.name === 'bus' || k.name === 'van';
      var fx = g.x - L * 0.16;                           /* front window */
      var sill = bodyBottom - Hh * (boxy ? 0.48 : 0.62);
      var lwc = Math.max(0.8, 2 * sc);

      /* the glass rolled down: a dark opening with a bright sill under it */
      ctx.fillStyle = '#15131b';
      roundRect(ctx, fx - L * 0.07, sill - Hh * 0.24, L * 0.14, Hh * 0.24, Hh * 0.035);
      ctx.fill();
      ctx.fillStyle = shade(k.color, -0.3);
      ctx.fillRect(fx - L * 0.09, sill, L * 0.18, Hh * 0.045);

      var up = Math.min(1, (2.6 - car.bird) * 3.4);      /* shoots up, holds */
      var shake = Math.sin(car.bird * 22) * 0.10 * up;
      var hs = Hh * 0.46;                                /* hand size */
      var reach = Hh * 0.6 * up;

      ctx.save();
      ctx.translate(fx, sill - Hh * 0.02);
      ctx.rotate(shake);

      /* forearm out of the window */
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = hs * 0.3 + lwc * 2;
      ctx.beginPath();
      ctx.moveTo(0, hs * 0.1);
      ctx.lineTo(0, -reach);
      ctx.stroke();
      ctx.strokeStyle = '#c98d5f';
      ctx.lineWidth = hs * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, hs * 0.1);
      ctx.lineTo(0, -reach);
      ctx.stroke();

      if (up > 0.6) {
        ctx.translate(0, -reach);

        /* the finger, drawn first so the fist overlaps its base */
        ctx.beginPath();
        roundRect(ctx, -hs * 0.12, -hs * 1.06, hs * 0.24, hs * 0.86, hs * 0.12);
        inked('#e0aa78', lwc);

        /* the fist */
        ctx.beginPath();
        roundRect(ctx, -hs * 0.34, -hs * 0.32, hs * 0.68, hs * 0.56, hs * 0.2);
        inked('#dda06c', lwc);

        /* curled knuckles across the top of the fist */
        ctx.strokeStyle = 'rgba(23,20,27,0.55)';
        ctx.lineWidth = Math.max(0.6, lwc * 0.6);
        for (var kn = -1; kn <= 1; kn++) {
          ctx.beginPath();
          ctx.arc(kn * hs * 0.2, -hs * 0.24, hs * 0.09, Math.PI, Math.PI * 2);
          ctx.stroke();
        }

        /* thumb tucked across the front */
        ctx.beginPath();
        roundRect(ctx, hs * 0.2, -hs * 0.16, hs * 0.22, hs * 0.3, hs * 0.11);
        inked('#c98d5f', lwc * 0.8);
      }
      ctx.restore();
    }

    if (k.roof) {
      ctx.fillStyle = '#f2e28a';
      ctx.fillRect(g.x - L * 0.07, bodyBottom - Hh * 1.1, L * 0.14, Hh * 0.12);
      ctx.fillStyle = '#1b1b22';
      ctx.fillRect(g.x - L * 0.34, bodyBottom - Hh * 0.4, L * 0.2, Hh * 0.12);
    }

    ctx.restore();   /* end mirror */

    /* lights, pointing the way it is going */
    var front = car.dir > 0 ? 1 : -1;
    ctx.fillStyle = '#ffe9b0';
    ctx.fillRect(g.x + front * L * 0.46 - (front > 0 ? 0 : L * 0.05), bodyBottom - Hh * 0.44, L * 0.05, Hh * 0.1);
    ctx.fillStyle = '#e8503c';
    ctx.fillRect(g.x - front * L * 0.5, bodyBottom - Hh * 0.44, L * 0.04, Hh * 0.1);

    ctx.restore();
  }

  /* ---------------------------------------------------------- the dart */

  function dartPath(ctx2, L) {
    var u = function (v) { return v * L; };
    ctx2.beginPath();
    ctx2.moveTo(u(0.0), -u(0.19));
    ctx2.lineTo(u(0.022), -u(0.19));
    ctx2.bezierCurveTo(u(0.05), -u(0.105), u(0.075), -u(0.06), u(0.115), -u(0.048));
    ctx2.lineTo(u(0.235), -u(0.045));
    ctx2.quadraticCurveTo(u(0.244), -u(0.093), u(0.295), -u(0.093));
    ctx2.quadraticCurveTo(u(0.346), -u(0.093), u(0.358), -u(0.048));
    ctx2.lineTo(u(0.745), -u(0.04));
    ctx2.quadraticCurveTo(u(0.9), -u(0.058), u(1.0), -u(0.225));
    ctx2.lineTo(u(1.0), u(0.225));
    ctx2.quadraticCurveTo(u(0.9), u(0.058), u(0.745), u(0.04));
    ctx2.lineTo(u(0.358), u(0.048));
    ctx2.quadraticCurveTo(u(0.346), u(0.093), u(0.295), u(0.093));
    ctx2.quadraticCurveTo(u(0.244), u(0.093), u(0.235), u(0.045));
    ctx2.lineTo(u(0.115), u(0.048));
    ctx2.bezierCurveTo(u(0.075), u(0.06), u(0.05), u(0.105), u(0.022), u(0.19));
    ctx2.lineTo(u(0.0), u(0.19));
    ctx2.closePath();
  }

  /*
    Side profile of a real Tossit: suction cup at x=0, embossed collar,
    tapered shaft, flared fins at x=L.
  */
  function dartProfile(ctx2, L, color) {
    var u = function (v) { return v * L; };

    ctx2.save();
    ctx2.lineJoin = 'round';

    dartPath(ctx2, L);
    ctx2.fillStyle = color;
    ctx2.fill();

    ctx2.save();
    ctx2.clip();

    var vol = ctx2.createLinearGradient(0, -u(0.25), 0, u(0.25));
    vol.addColorStop(0, 'rgba(255,255,255,0.26)');
    vol.addColorStop(0.3, 'rgba(255,255,255,0.07)');
    vol.addColorStop(0.52, 'rgba(0,0,0,0)');
    vol.addColorStop(1, 'rgba(0,0,0,0.36)');
    ctx2.fillStyle = vol;
    ctx2.fillRect(-u(0.06), -u(0.3), u(1.14), u(0.6));

    ctx2.fillStyle = 'rgba(0,0,0,0.22)';
    ctx2.beginPath();
    ctx2.moveTo(u(0.75), -u(0.02));
    ctx2.quadraticCurveTo(u(0.9), -u(0.03), u(1.0), -u(0.088));
    ctx2.lineTo(u(1.0), u(0.088));
    ctx2.quadraticCurveTo(u(0.9), u(0.03), u(0.75), u(0.02));
    ctx2.closePath();
    ctx2.fill();

    ctx2.fillStyle = 'rgba(0,0,0,0.28)';
    ctx2.fillRect(u(0.252), -u(0.017), u(0.082), Math.max(0.7, u(0.031)));

    ctx2.fillStyle = 'rgba(255,255,255,0.22)';
    ctx2.fillRect(-u(0.004), -u(0.19), Math.max(0.9, u(0.028)), u(0.38));

    ctx2.restore();

    dartPath(ctx2, L);
    ctx2.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx2.lineWidth = Math.max(0.6, L * 0.006);
    ctx2.stroke();

    ctx2.restore();
  }

  /*
    Rear view: down the tail of a Tossit you see the round mouth of the fin
    flare with three ribs inside it.
  */
  function finRosette(ctx2, r, color, roll) {
    ctx2.fillStyle = shade(color, -0.02);
    ctx2.beginPath();
    ctx2.arc(0, 0, r, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.fillStyle = shade(color, -0.36);
    ctx2.beginPath();
    ctx2.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.strokeStyle = shade(color, -0.12);
    ctx2.lineWidth = Math.max(0.8, r * 0.17);
    ctx2.lineCap = 'butt';
    for (var i = 0; i < 3; i++) {
      var a = roll + i * (Math.PI * 2 / 3);
      ctx2.beginPath();
      ctx2.moveTo(0, 0);
      ctx2.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
      ctx2.stroke();
    }

    ctx2.fillStyle = shade(color, 0.1);
    ctx2.beginPath();
    ctx2.arc(0, 0, Math.max(0.8, r * 0.21), 0, Math.PI * 2);
    ctx2.fill();

    ctx2.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx2.lineWidth = Math.max(0.6, r * 0.12);
    ctx2.beginPath();
    ctx2.arc(0, 0, r * 0.91, Math.PI * 1.12, Math.PI * 1.92);
    ctx2.stroke();
  }

  function dartProfileScaled(ctx2, L, thick, color) {
    ctx2.save();
    ctx2.scale(L / thick, 1);
    dartProfile(ctx2, thick, color);
    ctx2.restore();
  }

  function drawWorldDart(pos, dir, color, roll, glow) {
    if (pos.z < 40) return;
    var half = DART_LEN * 0.5;
    var nose = proj(pos.x + dir.x * half, pos.y + dir.y * half, pos.z + dir.z * half);
    var tail = proj(pos.x - dir.x * half, pos.y - dir.y * half, pos.z - dir.z * half);
    var mid = proj(pos.x, pos.y, pos.z);

    var rawL = Math.sqrt(
      (tail.x - nose.x) * (tail.x - nose.x) + (tail.y - nose.y) * (tail.y - nose.y)
    );
    var angBack = Math.atan2(tail.y - nose.y, tail.x - nose.x);

    /*
      Straight perspective would make a dart a metre from your eye swallow the
      screen, so cap the drawn size while keeping the foreshortening intact.
    */
    var f = Math.min(1, rawL / Math.max(0.001, DART_LEN * mid.s));
    var scale = Math.min(mid.s, (H * 0.13) / DART_LEN);
    var thick = DART_LEN * scale;
    var L = f * thick;

    var hx = Math.cos(angBack) * L * 0.5;
    var hy = Math.sin(angBack) * L * 0.5;

    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
    }

    ctx.save();
    ctx.translate(mid.x + hx, mid.y + hy);
    finRosette(ctx, Math.max(1.2, thick * 0.235), color, roll);
    ctx.restore();

    if (L > thick * 0.16) {
      ctx.translate(mid.x - hx, mid.y - hy);
      ctx.rotate(angBack);
      dartProfileScaled(ctx, L, thick, color);
    }
    ctx.restore();
  }

  /*
    What the sight is pointing at. We cast into the scene and take the first
    thing the ray meets, so the marker sits on a real head, a car, or the road
    rather than floating in space.
  */
  function updateUfo(dt, time) {
    if (state === 'idle' || state === 'over' || state === 'cops') {
      ufo = null;
      return;
    }

    if (!ufo) {
      ufoTimer -= dt;
      if (ufoTimer <= 0) {
        /* rare: most windows pass quietly */
        if (Math.random() < 0.45) {
          var uz = 620 + Math.random() * 200;
          ufo = {
            z: uz,
            x: (Math.random() * 2 - 1) * 0.2 * uz,
            y: 150,
            hoverY: 400 + Math.random() * 60,
            vx: (Math.random() > 0.5 ? 1 : -1) * (26 + Math.random() * 30),
            state: 'rise',
            t: 0,
            spin: 0,
            vy: 0,
            beam: 0,
            smoke: 0
          };
          sfxUfoWarn();
        }
        ufoTimer = 30 + Math.random() * 34;
      }
      return;
    }

    var u = ufo;
    u.t += dt;

    if (u.state === 'rise') {
      u.y += (u.hoverY - u.y) * Math.min(1, dt * 2.6);
      if (u.hoverY - u.y < 8) { u.state = 'hover'; u.t = 0; }
    } else if (u.state === 'hover' || u.state === 'charge') {
      u.x += u.vx * dt;
      u.y = u.hoverY + Math.sin(u.t * 2.2) * 9;
      if (Math.abs(u.x) > 0.3 * u.z) u.vx = -Math.abs(u.vx) * Math.sign(u.x);
      if (u.state === 'hover' && u.t > 3.0) { u.state = 'charge'; u.t = 0; sfxUfoWarn(); }
      if (u.state === 'charge' && u.t > 1.6) {
        /* the beam fires: what gets abducted is your score */
        u.state = 'leave';
        u.t = 0;
        score = Math.max(0, score - UFO_ZAP);
        combo = 0;
        badFlash = 1;
        shake = 14;
        lastCall = 'ABDUCTED ' + UFO_ZAP + ' POINTS';
        callLife = 2.0;
        var zp = proj(u.x, u.y, u.z);
        pops.push({ x: zp.x, y: zp.y + 30, text: '-' + UFO_ZAP, color: '#e0503f', life: 1.6, vy: -30 });
        u.beam = 0.5;
        sfxZap();
      }
    } else if (u.state === 'leave') {
      if (u.beam > 0) u.beam = Math.max(0, u.beam - dt);
      u.y += dt * (260 + u.t * 500);
      u.x += u.vx * 2.5 * dt;
      if (u.t > 1.4) ufo = null;
    } else if (u.state === 'fall') {
      u.spin += dt * 9;
      u.vy += dt * 700;
      u.y -= u.vy * dt;
      u.x += u.vx * 0.4 * dt;
      u.smoke -= dt;
      if (u.smoke <= 0) {
        u.smoke = 0.09;
        var sp2 = proj(u.x + (Math.random() * 2 - 1) * UFO_R * 0.6, u.y + UFO_R * 0.5, u.z);
        puffs.push({ x: sp2.x, y: sp2.y, r: 6 + Math.random() * 8, life: 0.7, max: 0.7 });
      }
      if (u.y <= STREET_Y + 26) {
        var gp = proj(u.x, STREET_Y + 10, u.z);
        burst(gp.x, gp.y, '#e0503f', 34);
        burst(gp.x, gp.y, YELLOW, 22);
        shake = 16;
        flash = 0.4;
        sfxCrash();
        ufo = null;
      }
    }
  }

  function ufoHit(fl) {
    var u = ufo;
    combo++;
    var mult = Math.min(3, 1 + 0.5 * (combo - 1));
    var total = Math.round(UFO_SCORE * mult);
    score += total;
    sticks++;
    if (dartsLeft < DART_CAP) dartsLeft++;

    var sp = proj(u.x, u.y, u.z);
    pops.push({ x: sp.x, y: sp.y - 20, text: '+' + total, color: '#ffffff', life: 1.5, vy: -34 });
    pops.push({ x: sp.x, y: sp.y - 46, text: 'UFO DOWN', color: TEAL, life: 1.7, vy: -24 });
    burst(sp.x, sp.y, TEAL, 30);
    lastCall = 'CLOSE ENCOUNTER';
    callLife = 2.0;
    flash = 0.5;
    shake = 12;
    sfxChime([880, 1174, 1568, 2093], 0.2);

    u.state = 'fall';
    u.t = 0;
    u.vy = 40;
    u.vx = u.vx * 0.5;
    u.smoke = 0;
  }

  function sfxUfoWarn() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(880, t + 0.5);
    o.frequency.linearRampToValueAtTime(560, t + 1.0);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 1.05);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 1.1);
  }

  function sfxZap() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var o = a.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.4);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.42);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.46);
  }

  function sfxCrash() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var n = noise(a);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.55);
    n.connect(lp);
    lp.connect(g);
    g.connect(master);
    n.start(t);
    n.stop(t + 0.6);
  }

  function updateRat(dt) {
    if (state === 'idle') { rat = null; return; }
    if (!rat) {
      ratTimer -= dt;
      if (ratTimer <= 0) {
        if (Math.random() < 0.6) {
          var rz = 440 + Math.random() * 90;
          var rdir = Math.random() > 0.5 ? 1 : -1;
          rat = {
            z: rz,
            dir: rdir,
            x: -rdir * (0.44 * rz + 50),
            speed: 150 + Math.random() * 90,
            phase: Math.random() * 6.28
          };
        }
        ratTimer = 16 + Math.random() * 22;
      }
      return;
    }
    rat.x += rat.dir * rat.speed * dt;
    rat.phase += dt * 15;
    if (Math.abs(rat.x) > 0.44 * rat.z + 70) rat = null;
  }

  function drawRat(time) {
    if (!rat) return;
    var sc = focal / rat.z;
    var p = proj(rat.x, STREET_Y, rat.z);
    var bob = Math.abs(Math.sin(rat.phase)) * 2 * sc;
    var d = rat.dir;

    ctx.save();
    ctx.translate(p.x, p.y - bob);

    /* the slice comes first; the rat is merely logistics */
    ctx.beginPath();
    ctx.moveTo(d * 26 * sc, -20 * sc);
    ctx.lineTo(d * 54 * sc, -30 * sc);
    ctx.lineTo(d * 50 * sc, -4 * sc);
    ctx.closePath();
    inked('#e8a021', Math.max(0.8, 2 * sc));
    ctx.beginPath();
    ctx.moveTo(d * 54 * sc, -30 * sc);
    ctx.lineTo(d * 50 * sc, -4 * sc);
    ctx.strokeStyle = '#b8492f';
    ctx.lineWidth = Math.max(1, 4 * sc);
    ctx.stroke();

    /* body */
    ctx.beginPath();
    ctx.ellipse(0, -9 * sc, 20 * sc, 9 * sc, d * 0.08, 0, Math.PI * 2);
    inked('#6b6672', Math.max(0.8, 2 * sc));
    /* head + ear */
    ctx.beginPath();
    ctx.ellipse(d * 18 * sc, -12 * sc, 8 * sc, 6 * sc, 0, 0, Math.PI * 2);
    inked('#6b6672', Math.max(0.8, 1.6 * sc));
    ctx.beginPath();
    ctx.arc(d * 15 * sc, -18 * sc, 3.4 * sc, 0, Math.PI * 2);
    inked('#8a8494', Math.max(0.6, 1.2 * sc));
    /* tail trailing with a wave in it */
    ctx.beginPath();
    ctx.moveTo(-d * 18 * sc, -8 * sc);
    ctx.quadraticCurveTo(-d * 34 * sc, -14 * sc + Math.sin(time * 9) * 3 * sc, -d * 44 * sc, -6 * sc);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, 2.2 * sc);
    ctx.lineCap = 'round';
    ctx.stroke();
    /* legs scurrying */
    ctx.lineWidth = Math.max(0.8, 2 * sc);
    for (var l = -1; l <= 1; l += 2) {
      var la = Math.sin(rat.phase + l) * 0.7;
      ctx.beginPath();
      ctx.moveTo(l * 8 * sc, -4 * sc);
      ctx.lineTo(l * 8 * sc + Math.sin(la) * 5 * sc, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  function tryGust() {
    var pool = [];
    for (var i = 0; i < peds.length; i++) {
      var q = peds[i];
      if (!q.bald && q.mop === 'cap' && q.stage === 'walk' && q.mode === 'walk' &&
          Math.abs(q.x) < 0.36 * q.z) pool.push(q);
    }
    if (!pool.length) return false;
    var p = pool[Math.floor(Math.random() * pool.length)];
    var h = headWorld(p);

    /* the cap leaves; a fresh dome enters play */
    flyCaps.push({
      x: h.x, y: h.y + h.r * 0.6, z: p.z,
      vx: (Math.random() * 2 - 1) * 120,
      vy: 160 + Math.random() * 80,
      rot: Math.random() * 6.28,
      vr: (Math.random() > 0.5 ? 1 : -1) * 9,
      t: 0,
      color: shade(p.coat, 0.22)
    });
    p.bald = true;
    p.hair = 'horseshoe';
    p.mop = 'mop';
    var sp = proj(h.x, h.y, h.z);
    pops.push({ x: sp.x, y: sp.y - 24, text: 'GUST!', color: TEAL, life: 1.3, vy: -30 });
    saySomething(p, 'MY CAP!', 1.9, 'smug');
    sfxWhoosh(0.5);
    return true;
  }

  function updateGongs(dt) {
    for (var i = gongs.length - 1; i >= 0; i--) {
      gongs[i].t += dt;
      if (gongs[i].t > 0.8) gongs.splice(i, 1);
    }
  }

  function drawGongs() {
    for (var i = 0; i < gongs.length; i++) {
      var gg = gongs[i];
      var head = headWorld(gg.p);
      var hp = proj(head.x, head.y, head.z);
      var hr = head.r * (focal / gg.p.z);
      var u = gg.t / 0.8;
      ctx.save();
      ctx.globalAlpha = (1 - u) * 0.9;
      for (var ring = 0; ring < 3; ring++) {
        var rr = hr * (1.15 + u * 2.6 + ring * 0.42);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, rr, 0, Math.PI * 2);
        ctx.strokeStyle = ring === 1 ? YELLOW : INK;
        ctx.lineWidth = Math.max(1, (ring === 1 ? 3 : 2) * (1 - u) * (focal / gg.p.z));
        ctx.stroke();
      }
      /* the head shivers a wobble mark either side */
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 2 * (focal / gg.p.z));
      ctx.lineCap = 'round';
      var wob = Math.sin(gg.t * 40) * hr * 0.14;
      ctx.beginPath();
      ctx.moveTo(hp.x - hr * 1.5, hp.y - hr * 0.3 + wob);
      ctx.quadraticCurveTo(hp.x - hr * 1.75, hp.y, hp.x - hr * 1.5, hp.y + hr * 0.3 - wob);
      ctx.moveTo(hp.x + hr * 1.5, hp.y - hr * 0.3 - wob);
      ctx.quadraticCurveTo(hp.x + hr * 1.75, hp.y, hp.x + hr * 1.5, hp.y + hr * 0.3 + wob);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* two detuned sines with a slow decay: a small municipal temple bell */
  function sfxGong() {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    [196, 294.5, 392.8].forEach(function (hz, i) {
      var o = a.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(hz * (1 + (Math.random() - 0.5) * 0.004), t);
      var g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 / (i + 1), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 1.1 - i * 0.2);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 1.2);
    });
  }

  function updateGust(dt) {
    if (state !== 'idle' && state !== 'over') {
      gustTimer -= dt;
      if (gustTimer <= 0) {
        if (Math.random() < 0.6) tryGust();
        gustTimer = 18 + Math.random() * 20;
      }
    }
    for (var i = flyCaps.length - 1; i >= 0; i--) {
      var c = flyCaps[i];
      c.t += dt;
      c.vy -= 420 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      if (c.t > 1.6 || c.y < STREET_Y) flyCaps.splice(i, 1);
    }
  }

  function drawFlyCaps() {
    for (var i = 0; i < flyCaps.length; i++) {
      var c = flyCaps[i];
      var sc = focal / c.z;
      var p = proj(c.x, c.y, c.z);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(c.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, 13 * sc, 7 * sc, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(16 * sc, 2 * sc);
      ctx.lineTo(-13 * sc, 2 * sc);
      ctx.closePath();
      inked(c.color, Math.max(0.8, 2 * sc));
      ctx.restore();
    }
  }

  function pickTarget(sx, sy) {
    var dx = (sx - cx) / focal;
    var dy = -(sy - cy) / focal;
    var n = Math.sqrt(dx * dx + dy * dy + 1);
    var dir = { x: dx / n, y: dy / n, z: 1 / n };
    var REACH = 2600;
    var seg = { x: dir.x * REACH, y: dir.y * REACH, z: dir.z * REACH };
    var o = { x: 0, y: 0, z: 0 };

    var bestT = null, lockPed = null, lockUfo = false;

    if (ufo && (ufo.state === 'rise' || ufo.state === 'hover' || ufo.state === 'charge')) {
      var tu = raySphere(o, seg, { x: ufo.x, y: ufo.y, z: ufo.z }, UFO_R * 1.7);
      if (tu !== null) {
        bestT = tu;
        lockUfo = true;
      }
    }

    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      var head = headWorld(p);
      var th = raySphere(o, seg, head, head.r * (p.bald ? 1.4 : 1));
      if (th !== null && (bestT === null || th < bestT)) {
        bestT = th;
        lockPed = p;
      }
      var halfW = 24 * p.build * p.k;
      var tb = rayBox(
        o, seg,
        { x: p.x - halfW, y: STREET_Y, z: p.z - 15 * p.k },
        { x: p.x + halfW, y: STREET_Y + 146 * p.k, z: p.z + 15 * p.k }
      );
      if (tb !== null && (bestT === null || tb < bestT)) {
        bestT = tb;
        lockPed = null;
      }
    }

    for (var c = 0; c < cars.length; c++) {
      var car = cars[c];
      var tc = rayBox(
        o, seg,
        { x: car.x - car.kind.len * 0.5, y: STREET_Y, z: car.z - 55 },
        { x: car.x + car.kind.len * 0.5, y: STREET_Y + car.kind.h, z: car.z + 55 }
      );
      if (tc !== null && (bestT === null || tc < bestT)) {
        bestT = tc;
        lockPed = null;
      }
    }

    /* nothing in the way, so fall through to the road surface */
    if (bestT === null && dir.y < -0.0001) {
      var tg = (STREET_Y / dir.y) / REACH;
      if (tg > 0 && tg <= 1) bestT = tg;
    }
    if (bestT === null) bestT = 1400 / REACH;

    var out = {
      x: seg.x * bestT,
      y: seg.y * bestT,
      z: seg.z * bestT,
      ped: lockPed,
      ufo: lockUfo
    };

    if (lockUfo) {
      out.x = ufo.x;
      out.y = ufo.y;
      out.z = ufo.z;
      out.ped = null;
      return out;
    }

    /* locked on a head: aim at its centre rather than wherever the ray
       clipped the sphere, so the toss is centred on the dome */
    if (lockPed) {
      var lh = headWorld(lockPed);
      out.x = lh.x;
      out.y = lh.y;
      out.z = lh.z;
    }
    return out;
  }

  /* ---------------------------------------------------------- game flow */

  function newThrow() {
    /* darts already in the air stay in the air */
    state = 'ready';
  }

  function startGame() {
    clearTimeout(turnTimer);
    turnTimer = null;
    ufo = null;
    ufoTimer = 26 + Math.random() * 26;
    rat = null;
    ratTimer = 12 + Math.random() * 16;
    gustTimer = 14 + Math.random() * 16;
    flyCaps.length = 0;
    gongs.length = 0;
    flights.length = 0;
    score = 0;
    sticks = 0;
    combo = 0;
    wrongHits = 0;
    copsT = 0;
    copsShots = 0;
    bangFlash = 0;
    beatRed = 0;
    copsOut = false;
    copA = null;
    copB = null;
    copsHereT = 0;
    swingL = 0;
    swingR = 0;
    raiseL = 0;
    raiseR = 0;
    if (copCar) {
      var ix = cars.indexOf(copCar);
      if (ix !== -1) cars.splice(ix, 1);
      copCar = null;
    }
    dartsLeft = cfg.darts;
    pops.length = 0;
    sparks.length = 0;
    puffs.length = 0;
    lastCall = null;
    callLife = 0;
    badFlash = 0;
    tauntTimer = 2.5;
    startScreen.hidden = true;
    endScreen.hidden = true;
    audio();
    musicStart();
    seedCrowd();
    newThrow();
  }

  function launch() {
    var T = target || pickTarget(aimX, aimY);

    /*
      A locked target keeps moving for the whole flight, so the sight would
      otherwise promise a spot they have already left. Lead them by however
      they happen to be travelling: strolling the pavement, sprinting off
      after a hit, or still walking up out of the park. Solved iteratively
      because the flight time depends on the distance.
    */
    if (T.ufo && ufo) {
      var baseUX = T.x;
      for (var uit = 0; uit < 3; uit++) {
        var udd = Math.sqrt(T.x * T.x + T.y * T.y + T.z * T.z);
        var uft = Math.max(0.55, Math.min(1.45, udd / 640));
        T.x = baseUX + ufo.vx * uft;
      }
    }

    if (T.ped) {
      var lp = T.ped;
      var baseX = T.x, baseZ = T.z;
      var vx = 0, vz = 0;
      if (lp.mode === 'flee') {
        vx = lp.dir * lp.speed * 3.6;
      } else if (lp.mode === 'walk') {
        if (lp.stage === 'approach') vz = -lp.speed * 2.6;
        else vx = lp.dir * lp.speed;
      }

      for (var it = 0; it < 3; it++) {
        var dd = Math.sqrt(T.x * T.x + T.y * T.y + T.z * T.z);
        var ft = Math.max(0.55, Math.min(1.45, dd / 640));

        if (lp.mode === 'mad') {
          /*
            Stunned now, but he bolts once his timer runs out, which can
            happen while this dart is still in the air. Lead only the part of
            the flight he spends running.
          */
          var running = Math.max(0, ft - lp.timer);
          var bolt = lp.x >= 0 ? 1 : -1;
          T.x = baseX + bolt * lp.speed * 3.6 * running;
        } else {
          T.x = baseX + vx * ft;
          T.z = Math.max(120, baseZ + vz * ft);
        }
      }
    }

    var dist = Math.sqrt(T.x * T.x + T.y * T.y + T.z * T.z);
    var flight = Math.max(0.55, Math.min(1.45, dist / 640));

    /*
      The exact arc onto the sight. Scaling all three components by f leaves
      the landing point laterally identical and only shifts it up or down,
      so a mistimed release lands short or long of the marker, never wide.
    */
    var vx = T.x / flight;
    var vz = T.z / flight;
    var vy = (T.y + 0.5 * G * flight * flight) / flight;

    var f = 1 + (charge - PERFECT) * 0.46;

    flights.push({
      aimId: T.ped ? T.ped.id : null,
      x: 0, y: 0, z: 0,
      vx: vx * f,
      vy: vy * f,
      vz: vz * f,
      roll: Math.random() * 6.28,
      spin: (Math.random() * 2 - 1) * 9,
      color: DART_COLORS[(cfg.darts - dartsLeft) % DART_COLORS.length],
      t: 0,
      trail: []
    });
    dartsLeft--;
    /* the hand is free the moment the dart leaves it */
    state = 'ready';
    throwAnim = 0.12;
    sfxWhoosh(charge);
  }

  function scoreHit(fl, p, hx, hy, speed) {
    var head = headWorld(p);
    var d = Math.sqrt(hx * hx + hy * hy) / head.r;

    var pts, label;
    if (d <= 0.34) {
      pts = 100;
      label = 'RIGHT ON THE DOME';
      gongs.push({ p: p, t: 0 });
      sfxGong();
    }
    else if (d <= 0.68) { pts = 50; label = 'CLEAN STICK'; }
    else { pts = 25; label = 'GRAZED HIM'; }

    /*
      A dome across the avenue is a far harder shot than one at your feet, so
      range pays: level at the near kerb, double out at the back of the block.
    */
    var feet = head.z / 30.48;
    var far = Math.max(0, Math.min(1, (head.z - 430) / 470));
    pts = Math.round(pts * (1 + far));
    if (far > 0.55) label = 'LONG RANGE';

    if (p.boss) {
      pts *= 3;
      label = 'MEGA DOME';
    }

    /* every extra dart on the same head is worth more than the last */
    var onHim = p.darts.length + 1;
    if (onHim > 1) {
      pts = Math.round(pts * (1 + 0.5 * (onHim - 1)));
      label = onHim === 2 ? 'DOUBLE UP' : (onHim === 3 ? 'HAT TRICK' : 'PINCUSHION');
    }

    combo++;
    var mult = Math.min(3, 1 + 0.5 * (combo - 1));
    var total = Math.round(pts * mult);
    score += total;
    sticks++;

    /* landing it earns the dart back: keep sticking and you keep throwing */
    var earned = dartsLeft < DART_CAP;
    if (earned) dartsLeft++;

    p.darts.push({
      ox: hx,
      oy: hy,
      tx: (Math.random() * 2 - 1) * 0.18,
      ty: -0.1 + Math.random() * 0.2,
      roll: fl.roll,
      color: fl.color
    });
    p.mode = 'mad';
    /*
      He stands there stunned for longer than a dart takes to arrive, which
      is what makes stacking a second and third one on the same head possible.
    */
    p.timer = 1.5 + p.darts.length * 0.25;
    p.anger = 1;

    var sp = proj(head.x + hx, head.y + hy, head.z);
    pops.push({ x: sp.x, y: sp.y - 16, text: '+' + total, color: pts >= 100 ? '#ffffff' : YELLOW, life: 1.15, vy: -34 });
    if (mult > 1) {
      pops.push({ x: sp.x, y: sp.y - 40, text: 'x' + mult, color: TEAL, life: 1.3, vy: -26 });
    }
    if (earned) {
      pops.push({ x: sp.x, y: sp.y - (mult > 1 ? 62 : 38), text: '+1 DART', color: '#7dff9e', life: 1.5, vy: -22 });
      sfxChime([1046, 1568], 0.1);
    }
    if (far > 0.35) {
      pops.push({ x: sp.x, y: sp.y + 16, text: Math.round(feet) + ' FT', color: TEAL, life: 1.4, vy: -18 });
    }
    burst(sp.x, sp.y, pts >= 100 ? '#ffffff' : YELLOW, p.boss ? 40 : (pts >= 100 ? 26 : 14));

    lastCall = label;
    callLife = 1.5;
    saySomething(p, pickOne(HIT_LINES), 1.9, 'hit');

    sfxSlap(Math.min(1, speed / SPD_MAX));
    sfxYell(p.voice);
    if (pts >= 50) {
      sfxChime(pts >= 100 ? [880, 1174, 1568, 2093] : [659, 880, 1174], 0.18);
      shake = pts >= 100 ? 12 : 6;
      flash = pts >= 100 ? 0.5 : 0.25;
    }
    if (p.boss) {
      shake = 16;
      flash = 0.6;
    }
  }

  /* a suction cup has nothing to hold onto up there */
  /*
    A suction cup has nothing to grab up there. This is the one thing the
    player is punished for, so it gets the loudest feedback in the game:
    a red flash, a shake, a big call-out and points off.
  */
  function hairHit(p) {
    combo = 0;
    wrongHits++;
    var lost = Math.min(25, score);
    score = Math.max(0, score - 25);

    p.mode = 'mad';
    p.timer = 0.5;
    p.anger = 1;

    var h = headWorld(p);
    var sp = proj(h.x, h.y, h.z);
    pops.push({ x: sp.x, y: sp.y - 18, text: '-25', color: '#e0503f', life: 1.5, vy: -34 });
    burst(sp.x, sp.y, '#e0503f', 20);

    lastCall = 'WRONG HEAD';
    callLife = 1.8;
    badFlash = 0.75;
    shake = 10;

    saySomething(p, pickOne(SMUG_LINES), 2.2, 'smug');
    sfxFlop();
    sfxYell(p.voice * 1.06);
    sfxBuzz();
    return lost;
  }

  /*
    Off the roof of a passing car. The driver has opinions: the window drops,
    the bird comes out, and the car crawls in protest before moving on.
  */
  function carHit(car, hit) {
    combo = 0;
    var sp = proj(hit.x, hit.y, hit.z);
    burst(sp.x, sp.y, '#9aa2b4', 12);
    pops.push({ x: sp.x, y: sp.y - 14, text: 'HEY!', color: '#8b93a7', life: 1, vy: -26 });
    lastCall = 'BLOCKED BY TRAFFIC';
    callLife = 1.3;
    if (car && !car.bird) {
      car.bird = 2.6;
      car.baseSpeed = car.speed;
      car.speed = car.baseSpeed * 0.1;
    }
    sfxClang();
    sfxHonk();
  }

  function bodyHit(p) {
    combo = 0;
    p.mode = 'mad';
    p.timer = 0.4;
    p.anger = 1;
    var chest = proj(p.x, STREET_Y + 118 * p.k, p.z);
    pops.push({ x: chest.x, y: chest.y, text: 'NO STICK', color: '#8b93a7', life: 1, vy: -24 });
    lastCall = 'WOOL DOES NOT STICK';
    callLife = 1.3;
    sfxFlop();
    sfxYell(p.voice * 0.92);
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 40 + Math.random() * 190;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        color: color
      });
    }
  }

  var POLICE_KIND = { name: 'police', len: 252, h: 86, color: '#f6efdd', roof: false };

  /* the two officers who take baldness enforcement seriously */
  function spawnCop(x, z) {
    var c = spawnPed(z, false);
    c.mode = 'cop';
    c.stage = 'walk';
    c.x = x;
    c.z = z;
    c.fem = false;
    c.bald = false;
    /* the uniform is the uniform: same coat, same shirt, same hat, same
       shoulders. Only the face underneath differs. */
    c.mop = 'cophat';
    c.coat = '#28365a';
    c.under = '#8fa6c4';
    c.hairColor = '#17141b';
    c.facial = 'stache';
    c.specs = false;
    c.bag = false;
    c.skirt = false;
    c.build = 1.14;
    c.h = 174;
    c.k = 174 / 168;
    c.hatPop = 0;
    c.darts = [];
    c.anger = 0;
    return c;
  }

  function copsStart() {
    clearTimeout(turnTimer);
    /* any other darts still in the air drop out of the story here */
    flights.length = 0;
    state = 'cops';
    copsT = 0;
    copsShots = 0;
    copsOut = false;
    copA = null;
    copB = null;
    copsHereT = 0;
    swingL = 0;
    swingR = 0;
    raiseL = 0;
    raiseR = 0;
    soloSide = Math.random() > 0.5 ? 1 : -1;
    musicStop();
    chargeStop();
    lastCall = 'NYPD! FREEZE!';
    callLife = 2.4;
    shake = 8;
    var cdir = Math.random() > 0.5 ? 1 : -1;
    copCar = {
      kind: POLICE_KIND,
      z: 474,
      dir: cdir,
      x: -cdir * (1.1 * 474 + POLICE_KIND.len),
      speed: 680
    };
    cars.push(copCar);
    sfxSiren();
  }

  function copsUpdate(dt) {
    copsT += dt;
    /* the cruiser brakes hard once it reaches the middle of the frame */
    if (copCar && (copCar.dir > 0 ? copCar.x > -140 : copCar.x < 140)) {
      copCar.speed = Math.max(0, copCar.speed - 2600 * dt);
    }

    /*
      Doors open once the cruiser has actually stopped, not on a stopwatch.
      On a phone that drops frames during the siren shake, the old 1.4s gate
      fired while the car was still mid-street, and the pair appeared out of
      thin air. The time check is only a failsafe if the car never makes it.
    */
    if (!copsOut && copCar && (copCar.speed <= 1 || copsT >= 3.2)) {
      copsOut = true;
      copA = spawnCop(copCar.x - 70, copCar.z - 30);
      copB = spawnCop(copCar.x + 70, copCar.z - 30);
      peds.push(copA);
      peds.push(copB);
    }

    /* they walk straight at the camera, close enough to loom */
    var arrived = 0;
    [copA, copB].forEach(function (c, idx) {
      if (!c) return;
      if (c.hatPop > 0) c.hatPop = Math.max(0, c.hatPop - dt);
      if (c.z > 168) {
        c.z -= 310 * dt;
        c.x += ((idx === 0 ? -46 : 46) - c.x) * 1.6 * dt;
        c.phase += dt * 9;
      } else {
        arrived++;
      }
    });

    if (arrived === 2) {
      if (!copsHereT) copsHereT = copsT;
      var tt = copsT - copsHereT;
      /*
        Blow one is a single club: a warning you cannot heed. Then both
        officers swing together, faster each time, until the screen is red.
      */
      var swingDue = [0.55, 1.15, 1.55, 1.88];
      /* arms wind up overhead in the beats before each blow lands */
      if (copsShots < swingDue.length) {
        var lead = (tt - (swingDue[copsShots] - 0.42)) / 0.34;
        var wind = Math.max(0, Math.min(1, lead));
        var solo = copsShots === 0;
        raiseL = (!solo || soloSide < 0) ? wind : 0;
        raiseR = (!solo || soloSide > 0) ? wind : 0;
      } else {
        raiseL = Math.max(0, raiseL - dt * 3);
        raiseR = Math.max(0, raiseR - dt * 3);
      }
      if (copsShots < swingDue.length && tt >= swingDue[copsShots]) {
        copsShots++;
        var both = copsShots > 1;
        if (both) {
          swingL = 0.22;
          swingR = 0.22;
          if (copA) copA.hatPop = 0.3;
          if (copB) copB.hatPop = 0.3;
        } else if (soloSide > 0) {
          swingR = 0.22;
          if (copB) copB.hatPop = 0.3;
        } else {
          swingL = 0.22;
          if (copA) copA.hatPop = 0.3;
        }
        /* the world goes redder with every blow and stays that way */
        beatRed = Math.min(0.85, beatRed + (both ? 0.24 : 0.16));
        bangFlash = both ? 0.75 : 0.55;
        shake = both ? 17 : 13;
        pops.push({
          x: cx + (both ? 0 : (swingR > 0 ? W * 0.12 : -W * 0.12)),
          y: H * 0.4,
          text: both ? 'THWACK! THWACK!' : 'THWACK!',
          color: '#f6efdd', life: 0.7, vy: -40
        });
        sfxThwack();
        if (both) setTimeout(sfxThwack, 70);
      }
      if (copsShots >= swingDue.length && tt >= swingDue[swingDue.length - 1] + 0.55) copsEnd();
    }

    if (swingL > 0) swingL = Math.max(0, swingL - dt);
    if (swingR > 0) swingR = Math.max(0, swingR - dt);
    /* safety: never wedge the state machine if the walk stalls */
    if (copsT >= 8) copsEnd();
  }

  /*
    The one ending where the score does not get top billing. Same end screen,
    recast: you are dead, and the rank chip explains the felony.
  */
  function copsEnd() {
    state = 'over';
    if (score > best) {
      best = score;
      try { localStorage.setItem(STORE_KEY, String(best)); } catch (e) {}
    }
    root.querySelector('[data-final]').textContent = "YOU'RE DEAD";
    root.querySelector('[data-sticks]').textContent = sticks;
    var bests = root.querySelectorAll('[data-best]');
    for (var i = 0; i < bests.length; i++) bests[i].textContent = best;
    root.querySelector('[data-end-rank]').textContent = 'BUSTED — YOU HIT A HAIRED HEAD';
    endScreen.hidden = false;
  }

  function afterLanding() {
    if (dartsLeft > 0 || flights.length > 0 || state !== 'ready') return;
    clearTimeout(turnTimer);
    {
      turnTimer = setTimeout(function () {
        if (state !== 'ready' || dartsLeft > 0 || flights.length > 0) return;
        state = 'over';
        musicStop();
        if (score > best) {
          best = score;
          try { localStorage.setItem(STORE_KEY, String(best)); } catch (e) {}
        }
        root.querySelector('[data-final]').textContent = score;
        root.querySelector('[data-sticks]').textContent = sticks;
        var bests = root.querySelectorAll('[data-best]');
        for (var i = 0; i < bests.length; i++) bests[i].textContent = best;
        var rank = 'Keep Tossing';
        if (score >= cfg.darts * 70) rank = 'Tossit Legend';
        else if (score >= cfg.darts * 42) rank = 'Sharp Shooter';
        else if (score >= cfg.darts * 20) rank = 'Solid Arm';
        root.querySelector('[data-end-rank]').textContent = rank;
        endScreen.hidden = false;
      }, 950);
    }
  }

  function missToStreet(x, y, z) {
    var p = proj(x, Math.max(y, STREET_Y), z);
    burst(p.x, p.y, '#6b7488', 8);
    puffs.push({ x: p.x, y: p.y, r: 4, life: 0.6, max: 0.6 });
    pops.push({ x: p.x, y: p.y - 12, text: 'MISS', color: '#7d879b', life: 1, vy: -22 });
    combo = 0;
    lastCall = 'MISSED HIM';
    callLife = 1.2;
    saySomething(heckler(true), pickOne(TAUNTS), 2.4);
    sfxThud();
  }

  /* ---------------------------------------------------------- update */

  function update(dt, time) {
    tickCharge(dt);

    /* the crowd keeps crossing whatever you do */
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (p.mode === 'cop') continue;
      p.phase += dt * (p.mode === 'flee' ? 11 : 4.2);

      if (p.mode === 'mad') {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.mode = 'flee';
          p.stage = 'walk';
          p.dir = p.x >= 0 ? 1 : -1;
        }
      } else if (p.mode === 'flee') {
        p.anger = Math.max(0, p.anger - dt * 0.35);
        p.x += p.dir * p.speed * 3.6 * dt;
      } else if (p.stage === 'approach') {
        p.z -= p.speed * 2.6 * dt;
        if (p.z <= p.turnZ) {
          p.z = p.turnZ;
          p.stage = 'walk';
        }
      } else {
        p.x += p.dir * p.speed * dt;
      }

      if (p.say) {
        p.say.life -= dt;
        if (p.say.life <= 0) p.say = null;
      }

      /*
        No fading, no bouncing: they keep walking until they are completely
        past the frame, and only then are they swapped for someone new who
        walks on from beyond the opposite kind of edge - either strolling in
        from off-screen or coming up out of the park.
      */
      var gone = 0.44 * p.z + 120;
      if (p.stage === 'walk' && (p.x > gone || p.x < -gone)) {
        var boss = !hasBoss() && Math.random() < 0.24;
        if (boss || Math.random() < 0.5) {
          peds[i] = spawnPed(WALK_Z + 320 + Math.random() * 900, boss);
        } else {
          peds[i] = spawnFromSide();
        }
      }
    }

    /* the crowd is not shy */
    if (state !== 'over') {
      tauntTimer -= dt;
      if (tauntTimer <= 0) {
        tauntTimer = 4 + Math.random() * 4;
        saySomething(heckler(true), pickOne(TAUNTS), 2.4);
      }
    }

    /* traffic keeps rolling past between you and the park */
    updateUfo(dt, time);
    updateRat(dt);
    updateGust(dt);
    updateGongs(dt);

    carTimer -= dt;
    if (carTimer <= 0 && cars.length < 2) {
      var nc = spawnCar();
      cars.push(nc);
      if (state !== 'idle') sfxCarPass(nc);
      carTimer = 3.6 + Math.random() * 5.4;
    }
    for (var ci = cars.length - 1; ci >= 0; ci--) {
      var car = cars[ci];
      if (car.bird) {
        car.bird -= dt;
        if (car.bird <= 0) {
          car.bird = 0;
        } else if (car.bird < 0.9) {
          /* window back up, foot back down */
          car.speed = Math.min(car.baseSpeed, car.speed + car.baseSpeed * 2.2 * dt);
        }
      }
      car.x += car.dir * car.speed * dt;
      if (Math.abs(car.x) > 1.1 * car.z + car.kind.len * 1.2) cars.splice(ci, 1);
    }

    if (state === 'cops') copsUpdate(dt);

    for (var fi = flights.length - 1; fi >= 0; fi--) {
      var fl = flights[fi];
      var landed = false;
      var steps = 3;
      var h = dt / steps;
      for (var s = 0; s < steps; s++) {
        var from = { x: fl.x, y: fl.y, z: fl.z };
        fl.vy -= G * h;
        var k = 1 - DRAG_AIR * h;
        fl.vx *= k; fl.vy *= k; fl.vz *= k;
        fl.x += fl.vx * h;
        fl.y += fl.vy * h;
        fl.z += fl.vz * h;
        fl.roll += fl.spin * h;
        fl.t += h;

        if (checkImpact(fl, from)) { landed = true; break; }

        if (fl.y <= STREET_Y + 3) {
          missToStreet(fl.x, STREET_Y, fl.z);
          landed = true;
          break;
        }
        if (fl.z > 1500) {
          missToStreet(fl.x, fl.y, 1500);
          landed = true;
          break;
        }
      }

      if (landed) {
        flights.splice(fi, 1);
        afterLanding();
      } else {
        fl.trail.push({ x: fl.x, y: fl.y, z: fl.z, a: 1 });
        if (fl.trail.length > 26) fl.trail.shift();
      }
    }

    for (var fi2 = 0; fi2 < flights.length; fi2++) {
      var tr = flights[fi2].trail;
      for (var t = tr.length - 1; t >= 0; t--) {
        tr[t].a -= dt * 1.6;
        if (tr[t].a <= 0) tr.splice(t, 1);
      }
    }

    for (var j = pops.length - 1; j >= 0; j--) {
      pops[j].life -= dt;
      pops[j].y += pops[j].vy * dt;
      if (pops[j].life <= 0) pops.splice(j, 1);
    }

    for (var q = sparks.length - 1; q >= 0; q--) {
      var sp2 = sparks[q];
      sp2.life -= dt;
      sp2.x += sp2.vx * dt;
      sp2.y += sp2.vy * dt;
      sp2.vy += 260 * dt;
      if (sp2.life <= 0) sparks.splice(q, 1);
    }

    for (var u = puffs.length - 1; u >= 0; u--) {
      puffs[u].life -= dt;
      puffs[u].r += dt * 40;
      if (puffs[u].life <= 0) puffs.splice(u, 1);
    }

    if (state === 'ready') target = pickTarget(aimX, aimY);

    if (shake > 0) shake = Math.max(0, shake - dt * 34);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (badFlash > 0) badFlash = Math.max(0, badFlash - dt * 1.9);
    if (bangFlash > 0) bangFlash = Math.max(0, bangFlash - dt * 3.2);
    if (beatRed > 0 && state !== 'cops') beatRed = Math.max(0, beatRed - dt * 0.5);
    if (callLife > 0) callLife -= dt;
    if (throwAnim > 0) throwAnim = Math.max(0, throwAnim - dt);
  }

  /* did this substep pass through anybody? nearest one wins */
  /*
    Everyone on the street is a solid volume, not a flat cut-out: a head is a
    sphere and a body is a box with real depth. We sweep the dart's segment
    against all of them and take whichever it reaches FIRST, so a dart can
    never punch through the man in front to reach the one behind him.
  */
  function raySphere(o, d, c, r) {
    var ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    var a = d.x * d.x + d.y * d.y + d.z * d.z;
    if (a < 1e-9) return null;
    var b = 2 * (ox * d.x + oy * d.y + oz * d.z);
    var cc = ox * ox + oy * oy + oz * oz - r * r;
    var disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t1 = (-b - sq) / (2 * a);
    var t2 = (-b + sq) / (2 * a);
    if (t1 >= 0 && t1 <= 1) return t1;
    if (t2 >= 0 && t2 <= 1) return t2;
    return null;
  }

  function rayBox(o, d, min, max) {
    var t0 = 0, t1 = 1;
    var axes = ['x', 'y', 'z'];
    for (var i = 0; i < 3; i++) {
      var k = axes[i];
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < min[k] || o[k] > max[k]) return null;
        continue;
      }
      var ta = (min[k] - o[k]) / d[k];
      var tb = (max[k] - o[k]) / d[k];
      if (ta > tb) { var tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    return t0;
  }

  function checkImpact(fl, from) {
    var d = { x: fl.x - from.x, y: fl.y - from.y, z: fl.z - from.z };
    var best = null;

    if (ufo && (ufo.state === 'rise' || ufo.state === 'hover' || ufo.state === 'charge')) {
      var tu = raySphere(from, d, { x: ufo.x, y: ufo.y, z: ufo.z }, UFO_R * 1.4);
      if (tu !== null) best = { t: tu, kind: 'ufo' };
    }

    for (var ci = 0; ci < cars.length; ci++) {
      var car = cars[ci];
      var tc = rayBox(
        from, d,
        { x: car.x - car.kind.len * 0.5, y: STREET_Y, z: car.z - 55 },
        { x: car.x + car.kind.len * 0.5, y: STREET_Y + car.kind.h, z: car.z + 55 }
      );
      if (tc !== null && (!best || tc < best.t)) {
        best = { t: tc, kind: 'car', car: car };
      }
    }

    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      var head = headWorld(p);

      var th = raySphere(from, d, head, head.r * (p.bald ? 1.4 : 1));
      if (th !== null && (!best || th < best.t)) {
        best = { t: th, ped: p, kind: 'head', head: head };
      }

      var halfW = 24 * p.build * p.k;
      var halfD = 15 * p.k;
      var tb = rayBox(
        from, d,
        { x: p.x - halfW, y: STREET_Y, z: p.z - halfD },
        { x: p.x + halfW, y: STREET_Y + 146 * p.k, z: p.z + halfD }
      );
      if (tb !== null && (!best || tb < best.t)) {
        best = { t: tb, ped: p, kind: 'body' };
      }
    }

    if (!best) return false;

    var hit = {
      x: from.x + d.x * best.t,
      y: from.y + d.y * best.t,
      z: from.z + d.z * best.t
    };
    var speed = Math.sqrt(fl.vx * fl.vx + fl.vy * fl.vy + fl.vz * fl.vz);

    /* park the dart exactly where it made contact */
    fl.x = hit.x;
    fl.y = hit.y;
    fl.z = hit.z;

    if (best.kind === 'ufo') {
      ufoHit(fl);
    } else if (best.kind === 'car') {
      carHit(best.car, hit);
    } else if (best.kind === 'head') {
      if (best.ped.bald) {
        scoreHit(fl, best.ped, hit.x - best.head.x, hit.y - best.head.y, speed);
      } else {
        /*
          The law only cares about intent. A dart that clips a haired head on
          the way to somewhere else is a -25 accident; the sight sitting on
          that head when you let go is a felony.
        */
        var meant = fl.aimId !== null && fl.aimId === best.ped.id;
        hairHit(best.ped);
        if (meant) {
          copsStart();
          return true;
        }
      }
    } else {
      bodyHit(best.ped);
    }

    return true;
  }

  /* ---------------------------------------------------------- draw */

  function drawFlying() {
    for (var f = 0; f < flights.length; f++) {
      var fl = flights[f];
      var trail = fl.trail;
      ctx.save();
      ctx.lineCap = 'round';
      for (var i = 1; i < trail.length; i++) {
        var a = proj(trail[i - 1].x, trail[i - 1].y, trail[i - 1].z);
        var b = proj(trail[i].x, trail[i].y, trail[i].z);
        ctx.strokeStyle = 'rgba(237,189,0,' + (trail[i].a * 0.3).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, 2.6 * trail[i].a);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();

      var sp = Math.sqrt(fl.vx * fl.vx + fl.vy * fl.vy + fl.vz * fl.vz) || 1;
      drawWorldDart(fl, { x: fl.vx / sp, y: fl.vy / sp, z: fl.vz / sp }, fl.color, fl.roll, true);
    }
  }

  function drawHeldDart() {
    if (state !== 'ready' && throwAnim <= 0) return;
    var tall = H > W;
    /* on a tall crop the scoreboard owns the bottom of the frame, so the dart
       sits above it rather than behind it */
    var L = Math.min(W, H) * (tall ? 0.4 : 0.36);
    var hx = W * (tall ? 0.84 : 0.83);
    var hy = H * (tall ? 0.86 : 1.12);

    var pullX = 0, pullY = 0, tilt = 0;
    if (dragging) {
      pullX = 26 * charge;
      pullY = 34 * charge;
      tilt = -(aimX - cx) / W * 0.5;
    }
    if (throwAnim > 0) {
      var k = throwAnim / 0.12;
      pullX = -60 * (1 - k);
      pullY = -90 * (1 - k);
    }

    /*
      Held by the fins down in the corner, suction cup aimed up-range. The
      profile draws cup-at-origin, so anchor the tail and push the body out.
    */
    ctx.save();
    ctx.globalAlpha = throwAnim > 0 ? throwAnim / 0.12 : 1;
    ctx.translate(hx + pullX, hy + pullY);
    ctx.rotate(-Math.PI * 0.62 + tilt + Math.PI);
    ctx.translate(-L, 0);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    dartProfile(ctx, L, DART_COLORS[(cfg.darts - dartsLeft) % DART_COLORS.length]);
    ctx.restore();
  }

  function drawAim() {
    if (state !== 'ready') return;

    var locked = !!(target && ((target.ped && target.ped.bald) || target.ufo));
    var overHair = !!(target && target.ped && !target.ped.bald);
    var rx = aimX, ry = aimY;
    if (locked) {
      /* snap the ring to whatever is locked: a head, or the saucer hull */
      var lp;
      if (target.ped) {
        var lh = headWorld(target.ped);
        lp = proj(lh.x, lh.y, lh.z);
      } else {
        lp = proj(target.x, target.y, target.z);
      }
      rx = lp.x;
      ry = lp.y;
    }
    var r = Math.max(16, Math.min(W, H) * 0.04);
    var pulse = 1 + Math.sin(Date.now() / 300) * (locked ? 0.09 : 0.04);
    var tint = locked ? '#7dff9e' : (overHair ? '#e0503f' : YELLOW);

    /* drop line to the road so the marker reads at the right depth */
    if (target) {
      var foot = proj(target.x, STREET_Y, target.z);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(237,189,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, r * 0.5, r * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    var rr = r * pulse;
    for (var pass = 0; pass < 2; pass++) {
      var dark = pass === 0;
      ctx.save();
      ctx.strokeStyle = dark ? 'rgba(0,0,0,0.6)' : tint;
      ctx.lineWidth = dark ? 5 : 2.6;
      ctx.lineCap = 'round';
      if (!dark) {
        ctx.shadowColor = tint;
        ctx.shadowBlur = locked ? 16 : 9;
      }
      for (var q = 0; q < 4; q++) {
        var a0 = q * Math.PI / 2 + 0.46;
        ctx.beginPath();
        ctx.arc(rx, ry, rr, a0, a0 + Math.PI / 2 - 0.92);
        ctx.stroke();
      }
      var tick = rr * 0.4;
      ctx.beginPath();
      ctx.moveTo(rx - rr - tick * 0.5, ry); ctx.lineTo(rx - rr + tick * 0.25, ry);
      ctx.moveTo(rx + rr + tick * 0.5, ry); ctx.lineTo(rx + rr - tick * 0.25, ry);
      ctx.moveTo(rx, ry - rr - tick * 0.5); ctx.lineTo(rx, ry - rr + tick * 0.25);
      ctx.moveTo(rx, ry + rr + tick * 0.5); ctx.lineTo(rx, ry + rr - tick * 0.25);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(rx, ry, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = locked ? '#ffffff' : tint;
    ctx.beginPath();
    ctx.arc(rx, ry, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (locked || overHair) {
      ctx.save();
      ctx.font = '800 ' + Math.max(9, Math.round(W * 0.013)) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = tint;
      ctx.textAlign = 'center';
      ctx.fillText(locked ? 'LOCKED' : 'FELONY', rx, ry - rr - 10);
      ctx.restore();
    }
  }

  /* Bowman's angle + power gauge, parked on the left rail out of the way */
  function drawAimGauge() {
    if (state !== 'ready') return;
    var pad = Math.max(12, W * 0.022);
    var fs = Math.max(9, Math.round(W * 0.0145));

    var barH = Math.max(90, H * 0.34);
    var barW = Math.max(10, W * 0.016);
    var barX = pad;
    var barY = H * 0.5 - barH * 0.5;

    ctx.save();
    ctx.globalAlpha = dragging ? 1 : 0.55;
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(8,10,20,0.75)';
    roundRect(ctx, barX, barY, barW, barH, barW / 2);
    ctx.fill();

    /* the band where the toss lands on the sight */
    var goodLo = PERFECT - 0.15, goodHi = PERFECT + 0.2;
    ctx.fillStyle = 'rgba(125,255,158,0.22)';
    ctx.fillRect(barX, barY + barH * (1 - goodHi), barW, barH * (goodHi - goodLo));
    ctx.fillStyle = 'rgba(125,255,158,0.85)';
    ctx.fillRect(barX - 4, barY + barH * (1 - PERFECT) - 1, barW + 8, 2.4);

    ctx.strokeStyle = 'rgba(237,189,0,0.45)';
    ctx.lineWidth = 1;
    roundRect(ctx, barX, barY, barW, barH, barW / 2);
    ctx.stroke();

    /* the needle you are trying to release on */
    var ny = barY + barH * (1 - charge);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX - 7, ny - 3, barW + 14, 6);
    ctx.fillStyle = (charge > PERFECT - 0.15 && charge < PERFECT + 0.2) ? '#7dff9e' : YELLOW;
    ctx.fillRect(barX - 6, ny - 2, barW + 12, 4);

    var lx = barX + barW + 12;
    ctx.textAlign = 'left';
    ctx.font = '700 ' + Math.round(fs * 0.78) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(150,160,182,0.9)';
    ctx.fillText('TIMING', lx, barY - fs * 0.6);

    /* on a short canvas this caption lands on top of the sound pill, and the
       hint line under the card already says the same thing */
    if (H > 300) {
      ctx.font = '700 ' + Math.round(fs * 0.72) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(150,160,182,0.7)';
      ctx.fillText(dragging ? 'RELEASE ON GREEN' : 'HOLD TO CHARGE', lx, barY + barH + fs * 0.9);
    }

    if (target) {
      var dist = Math.sqrt(target.x * target.x + target.y * target.y + target.z * target.z);
      ctx.font = '800 ' + Math.round(fs * 1.15) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = TEAL;
      ctx.fillText((dist / 30.48).toFixed(0) + ' FT', lx, barY + barH * 0.5);
    }

    ctx.restore();
  }

  /*
    On a tall portrait canvas the street scene lives in the top half, which
    left the bottom of the screen dead. The HUD moves down there as a chunky
    arcade scoreboard; wide canvases keep the corner HUD.
  */
  function drawScoreboard() {
    var w = Math.min(W * 0.88, 430);
    var h = Math.max(96, w * 0.3);
    var x = cx - w / 2;
    var y = H - h - Math.max(76, H * 0.06);
    var big = Math.max(26, Math.round(w * 0.115));
    var small = Math.max(10, Math.round(w * 0.038));

    ctx.save();

    /* the cabinet: ink panel, accent edge, hard offset like the site cards */
    ctx.fillStyle = 'rgba(23,20,27,0.6)';
    roundRect(ctx, x + 5, y + 7, w, h, 14);
    ctx.fill();
    ctx.fillStyle = '#17141b';
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    ctx.textBaseline = 'top';

    /* left: running score */
    ctx.font = '700 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(150,160,182,0.9)';
    ctx.fillText('SCORE', x + w * 0.07, y + h * 0.14);
    ctx.font = '800 ' + big + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = YELLOW;
    ctx.shadowColor = 'rgba(237,189,0,0.45)';
    ctx.shadowBlur = 10;
    ctx.fillText(String(score), x + w * 0.07, y + h * 0.14 + small + 4);
    ctx.shadowBlur = 0;

    /* right: the best to beat */
    ctx.textAlign = 'right';
    ctx.font = '700 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(150,160,182,0.9)';
    ctx.fillText('BEST', x + w * 0.93, y + h * 0.14);
    ctx.font = '800 ' + Math.round(big * 0.72) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = TEAL;
    ctx.fillText(String(Math.max(best, score)), x + w * 0.93, y + h * 0.14 + small + 4);
    ctx.textAlign = 'left';

    /* combo sits between the two numbers */
    if (combo > 1) {
      ctx.textAlign = 'center';
      ctx.font = '800 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = TEAL;
      ctx.fillText('COMBO x' + Math.min(3, 1 + 0.5 * (combo - 1)), x + w / 2, y + h * 0.16);
      ctx.textAlign = 'left';
    }

    /* the rack: one dart icon per throw, spent ones ghosted */
    var rackMax = Math.max(cfg.darts, dartsLeft);
    var iconSize = Math.max(11, w * 0.042);
    var gap = (w * 0.86) / rackMax;
    var rackY = y + h - iconSize * 1.5;
    for (var i = 0; i < rackMax; i++) {
      ctx.save();
      ctx.translate(x + w * 0.07 + i * gap + gap * 0.5, rackY);
      ctx.globalAlpha = i < dartsLeft ? 1 : 0.16;
      ctx.rotate(-0.42);
      ctx.translate(-iconSize * 1.05, 0);
      dartProfile(ctx, iconSize * 2.1, DART_COLORS[i % DART_COLORS.length]);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawHUD() {
    var pad = Math.max(12, W * 0.022);
    var big = Math.max(15, Math.round(W * 0.03));
    var small = Math.max(9, Math.round(W * 0.014));
    var tall = H > W * 1.15;

    ctx.save();
    ctx.textBaseline = 'top';

    if (tall) {
      drawScoreboard();
    } else {
      ctx.font = '700 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(150,160,182,0.9)';
      ctx.fillText('SCORE', pad, pad);
      ctx.font = '800 ' + big + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = YELLOW;
      ctx.shadowColor = 'rgba(237,189,0,0.45)';
      ctx.shadowBlur = 8;
      ctx.fillText(String(score), pad, pad + small + 4);
      ctx.shadowBlur = 0;

      if (combo > 1) {
        ctx.font = '800 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = TEAL;
        ctx.fillText('COMBO x' + Math.min(3, 1 + 0.5 * (combo - 1)), pad, pad + small + big + 6);
      }

      ctx.textAlign = 'right';
      ctx.font = '700 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(150,160,182,0.9)';
      ctx.fillText('DARTS', W - pad, pad);
      ctx.textAlign = 'left';
      var rackMax = Math.max(cfg.darts, dartsLeft);
      var iconSize = Math.max(9, W * 0.017);
      var gap = Math.min(iconSize * 1.75, (W * 0.4) / rackMax);
      for (var i = 0; i < rackMax; i++) {
        ctx.save();
        ctx.translate(W - pad - (rackMax - i) * gap, pad + small + iconSize * 0.9);
        ctx.globalAlpha = i < dartsLeft ? 1 : 0.18;
        ctx.rotate(-0.42);
        ctx.translate(-iconSize * 1.05, 0);
        dartProfile(ctx, iconSize * 2.1, DART_COLORS[i % DART_COLORS.length]);
        ctx.restore();
      }

      ctx.textAlign = 'center';
      ctx.font = '700 ' + small + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(140,150,172,0.8)';
      ctx.fillText(cfg.diff.label + '  //  5TH AVE', cx, H - pad - small);
    }

    if (callLife > 0 && lastCall) {
      var bad = lastCall === 'WRONG HEAD';
      var dull = lastCall === 'MISSED HIM' || lastCall === 'WOOL DOES NOT STICK';
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, callLife / 0.4);
      ctx.font = '800 ' + Math.round(big * 0.95) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = bad ? '#e0503f' : (dull ? '#8b93a7' : YELLOW);
      ctx.shadowColor = bad ? 'rgba(224,80,63,0.8)' : (dull ? 'rgba(0,0,0,0)' : 'rgba(237,189,0,0.7)');
      ctx.shadowBlur = 18;
      ctx.textBaseline = 'middle';
      ctx.fillText(lastCall, cx, H * 0.17);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawPops() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      ctx.globalAlpha = Math.min(1, p.life / 0.35);
      ctx.font = '800 ' + Math.max(13, Math.round(W * 0.024)) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      ctx.globalAlpha = Math.max(0, s.life / s.max);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, 2.2, 2.2);
    }
    for (var j = 0; j < puffs.length; j++) {
      var p = puffs[j];
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.35;
      ctx.fillStyle = '#9aa2b4';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCRT() {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000';
    for (var y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = 'rgba(237,189,0,' + (flash * 0.2).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (badFlash > 0) {
      ctx.fillStyle = 'rgba(224,80,63,' + (badFlash * 0.3).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (state === 'cops') {
      /* alternating red and blue wash off the lightbar */
      var copBlue = Math.floor(copsT * 7) % 2 === 0;
      ctx.fillStyle = copBlue ? 'rgba(60,95,150,0.17)' : 'rgba(224,80,63,0.17)';
      ctx.fillRect(0, 0, W, H);
      if (copCar) {
        var bar = proj(copCar.x, STREET_Y + POLICE_KIND.h + 12, copCar.z);
        var bs = (focal / copCar.z) * 30;
        ctx.save();
        ctx.shadowColor = copBlue ? '#5b8fdd' : '#e0503f';
        ctx.shadowBlur = 26;
        ctx.fillStyle = copBlue ? '#5b8fdd' : '#e0503f';
        ctx.fillRect(bar.x - bs, bar.y - bs * 0.28, bs * 2, bs * 0.56);
        ctx.restore();
      }

      /* every blow leaves the screen redder than the last */
      if (copsShots > 0) {
        ctx.fillStyle = 'rgba(170,26,22,' + (0.14 * copsShots).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }


    }
    if (beatRed > 0) {
      ctx.fillStyle = 'rgba(140,12,20,' + (beatRed * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (bangFlash > 0) {
      /* the hit itself: a hard red pulse, not a muzzle flash */
      ctx.fillStyle = 'rgba(200,40,32,' + (bangFlash * 1.1).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------------------------------------------------- loop */

  function drawUfo(time) {
    if (!ufo) return;
    var u = ufo;
    var p = proj(u.x, u.y, u.z);
    var sc = focal / u.z;
    var r = UFO_R * sc;

    ctx.save();
    ctx.translate(p.x, p.y);
    if (u.state === 'fall') ctx.rotate(Math.sin(u.spin) * 0.5);

    /* charge telegraph: the whole ship glows hotter as the beam winds up */
    if (u.state === 'charge') {
      var chg = Math.min(1, u.t / 1.6);
      ctx.shadowColor = 'rgba(224,80,63,' + (0.4 + chg * 0.6).toFixed(2) + ')';
      ctx.shadowBlur = r * (0.5 + chg * 1.4);
    }

    /* hull */
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.34, 0, 0, Math.PI * 2);
    inked('#c9d6d4', Math.max(1, 2.4 * sc));

    /* dome */
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.26, r * 0.44, r * 0.34, 0, Math.PI, Math.PI * 2);
    inked('#7fd8cf', Math.max(1, 2 * sc));

    /* running lights blink in sequence */
    for (var i = -2; i <= 2; i++) {
      var on = ((Math.floor(time * 6) + i) % 5 + 5) % 5 === 0;
      ctx.beginPath();
      ctx.arc(i * r * 0.38, r * 0.1, Math.max(1.2, r * 0.07), 0, Math.PI * 2);
      ctx.fillStyle = on ? YELLOW : 'rgba(23,20,27,0.85)';
      ctx.fill();
    }

    ctx.restore();
  }

  function drawUfoBeam() {
    if (!ufo || !ufo.beam || ufo.beam <= 0) return;
    var u = ufo;
    var p = proj(u.x, u.y, u.z);
    var a = Math.min(1, u.beam / 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    var grad = ctx.createLinearGradient(p.x, p.y, cx, H);
    grad.addColorStop(0, 'rgba(224,80,63,0.9)');
    grad.addColorStop(1, 'rgba(224,80,63,0.15)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y);
    ctx.lineTo(p.x + 4, p.y);
    ctx.lineTo(cx + W * 0.3, H + 20);
    ctx.lineTo(cx - W * 0.3, H + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!W || !H) { resize(); return; }
    if (!t0) t0 = ts;
    var time = (ts - t0) / 1000;
    var dt = Math.min(0.045, (ts - (frame.last || ts)) / 1000);
    frame.last = ts;

    update(dt, time);

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * shake * 0.4, (Math.random() * 2 - 1) * shake * 0.4);
    }

    if (scene) ctx.drawImage(scene, 0, 0, W, H);

    drawUfo(time);

    /* one depth-sorted pass so traffic, crowd and rat overlap correctly */
    var order = [];
    for (var pi = 0; pi < peds.length; pi++) order.push({ z: peds[pi].z, ped: peds[pi] });
    for (var ci2 = 0; ci2 < cars.length; ci2++) order.push({ z: cars[ci2].z, car: cars[ci2] });
    if (rat) order.push({ z: rat.z, rat: true });
    order.sort(function (a, b) { return b.z - a.z; });
    for (var oi = 0; oi < order.length; oi++) {
      if (order[oi].ped) {
        drawPed(order[oi].ped, time);
        var op = order[oi].ped;
        if (op.mode === 'cop') {
          drawCopArm(op, op === copA ? raiseL : raiseR, op === copA ? swingL : swingR);
        }
      } else if (order[oi].rat) {
        drawRat(time);
      } else {
        drawCar(order[oi].car);
      }
    }

    drawFlyCaps();
    drawGongs();
    drawFlying();
    drawSparks();
    drawUfoBeam();
    drawAim();
    drawHeldDart();
    drawPops();
    ctx.restore();

    drawAimGauge();
    drawHUD();
    drawCRT();
  }

  /* ---------------------------------------------------------- input */

  function localPoint(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /*
    A fingertip is opaque and the reticle marks the exact landing spot, so on
    touch the aim floats a bit above the finger where it can actually be seen.
    You aim by putting the reticle on the head, not the finger. A mouse hides
    nothing and stays 1:1.
  */
  function aimPoint(e) {
    var p = localPoint(e);
    if (e.pointerType === 'touch') {
      p.y -= Math.max(54, Math.min(96, H * 0.11));
    }
    return p;
  }

  var anchor = null;
  /* which finger owns the current throw, so a second one cannot hijack it */
  var activePointer = null;

  function samePointer(e) {
    if (!e || e.pointerId === undefined || activePointer === null) return true;
    return e.pointerId === activePointer;
  }

  function onDown(e) {
    if (state !== 'ready') return;
    if (dartsLeft <= 0) return;
    if (e.isPrimary === false) return;
    if (activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId !== undefined ? e.pointerId : 'mouse';
    var p = aimPoint(e);
    aimX = p.x;
    aimY = p.y;
    target = pickTarget(aimX, aimY);
    dragging = true;
    chargeT = 0;
    charge = 0;
    audio();
    chargeStart();
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }

  function onMove(e) {
    if (state !== 'ready') return;
    if (dragging && !samePointer(e)) return;
    var p = aimPoint(e);
    aimX = p.x;
    aimY = p.y;
    target = pickTarget(aimX, aimY);
    if (dragging) e.preventDefault();
  }

  function onUp(e) {
    if (!dragging || !samePointer(e)) return;
    dragging = false;
    activePointer = null;
    chargeStop();
    if (state === 'ready') launch();
  }

  /*
    A cancelled touch must not throw. iOS raises pointercancel for system
    gestures, notifications and stray palm contact, and wiring that to onUp
    meant the dart flew on its own at whatever the meter happened to read.
  */
  function onCancel(e) {
    if (!dragging || !samePointer(e)) return;
    dragging = false;
    activePointer = null;
    charge = 0;
    chargeT = 0;
    chargeStop();
  }

  /* the meter sweeps up and back down for as long as you hold */
  function tickCharge(dt) {
    if (!dragging) return;
    chargeT += dt;
    var u = (chargeT / CHARGE_SWEEP) % 2;
    charge = u <= 1 ? u : 2 - u;
    chargeUpdate(charge);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  window.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var startBtns = root.querySelectorAll('[data-action="start"]');
  for (var b = 0; b < startBtns.length; b++) {
    startBtns[b].addEventListener('click', startGame);
  }

  var SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>' +
    '<path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19.5 5.8a9 9 0 0 1 0 12.4"/></svg>';
  var SPEAKER_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>' +
    '<path d="M17 9.5l4.5 4.5M21.5 9.5L17 14"/></svg>';

  var soundLabel = root.querySelector('[data-sound-label]');
  var soundWrap = root.querySelector('.ta-sound-wrap');

  function paintSoundBtn() {
    soundBtn.setAttribute('data-muted', muted ? 'true' : 'false');
    if (soundWrap) soundWrap.setAttribute('data-muted', muted ? 'true' : 'false');
    if (soundLabel) soundLabel.textContent = muted ? 'Sound On' : 'Sound Off';
    soundBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    soundBtn.setAttribute('title', muted ? 'Sound off' : 'Sound on');
    soundIcon.innerHTML = muted ? SPEAKER_OFF : SPEAKER;
  }

  /*
    The iPhone ring/silent switch mutes Web Audio outright: WebKit runs the
    page in the 'ambient' audio session, and ambient obeys the switch. An
    HTMLMediaElement actually playing moves the session to 'playback', which
    does not - so a looping, silent, inline WAV is kept playing underneath.
    It must be started inside a user gesture, same as everything else.
  */
  var sessionEl = null;

  function kickSession() {
    if (muted) return;
    if (!sessionEl) {
      sessionEl = document.createElement('audio');
      sessionEl.loop = true;
      sessionEl.preload = 'auto';
      sessionEl.setAttribute('playsinline', '');
      sessionEl.setAttribute('aria-hidden', 'true');
      sessionEl.style.display = 'none';
      root.appendChild(sessionEl);
      sessionEl.src = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    }
    var pr = sessionEl.play();
    if (pr && pr.catch) pr.catch(function () {});
  }

  function wakeAudio() {
    if (muted) return;
    if (AC && AC.state === 'suspended') AC.resume();
    kickSession();
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) wakeAudio();
  });
  canvas.addEventListener('pointerdown', wakeAudio);

  soundBtn.addEventListener('click', function () {
    muted = !muted;
    if (muted) {
      chargeStop();
      musicStop();
      if (sessionEl) sessionEl.pause();
      if (master) master.gain.value = 0;
    } else {
      kickSession();
      audio();
      if (master) master.gain.value = 0.55;
      if (state !== 'idle' && state !== 'over') musicStart();
    }
    paintSoundBtn();
  });
  paintSoundBtn();

  /* ---------------------------------------------------------- helpers */

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function shade(hex, amt) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) {
      r = Math.round(r + (255 - r) * amt);
      g = Math.round(g + (255 - g) * amt);
      b = Math.round(b + (255 - b) * amt);
    } else {
      r = Math.round(r * (1 + amt));
      g = Math.round(g * (1 + amt));
      b = Math.round(b * (1 + amt));
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------------------------------------------------------- boot */

  var bestEls = root.querySelectorAll('[data-best]');
  for (var m = 0; m < bestEls.length; m++) bestEls[m].textContent = best;

  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }
  resize();
  seedCrowd();
  state = 'idle';
  raf = requestAnimationFrame(frame);

  document.addEventListener('shopify:section:unload', function (evt) {
    if (evt.target && evt.target.contains(root)) {
      cancelAnimationFrame(raf);
      clearTimeout(turnTimer);
      musicStop();
      chargeStop();
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    }
  });
};
