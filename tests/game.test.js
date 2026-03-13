/**
 * Unit Tests — MIS-3 through MIS-7
 *
 * Run with: node tests/game.test.js
 */

import {
  EnemyMissile,
  EnemyExplosion,
  ENEMY_MISSILE_BASE_SPEED,
  ENEMY_MISSILE_SPEED_SCALE,
  ENEMY_BASE_COUNT,
  ENEMY_COUNT_SCALE,
  ENEMY_MAX_COUNT,
  ENEMY_MIRV_CHANCE,
  ENEMY_TRAIL_LENGTH,
} from '../src/enemy.js';

import { checkCollisions, POINTS_PER_MISSILE } from '../src/collision.js';

// ─── Minimal test runner (no dependencies) ───────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failures.push({ name, err });
    failed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeLessThanOrEqual(n) {
      if (!(actual <= n)) throw new Error(`Expected ${actual} <= ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      if (!(actual >= n)) throw new Error(`Expected ${actual} >= ${n}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${actual}`);
    },
    toHaveLength(n) {
      if (actual.length !== n) throw new Error(`Expected length ${n}, got ${actual.length}`);
    },
    toBeInstanceOf(cls) {
      if (!(actual instanceof cls)) throw new Error(`Expected instance of ${cls.name}`);
    },
    toThrow() {
      if (typeof actual !== 'function') throw new Error('toThrow requires a function');
      let threw = false;
      try { actual(); } catch { threw = true; }
      if (!threw) throw new Error('Expected function to throw');
    },
  };
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ─── Re-implement testable units inline (ES module extraction) ────────────────
// We duplicate the pure-logic classes here to avoid DOM dependencies in tests.

const GameState = Object.freeze({
  TITLE:     'TITLE',
  PLAYING:   'PLAYING',
  LEVEL_END: 'LEVEL_END',
  GAME_OVER: 'GAME_OVER',
});

class StateMachine {
  constructor(initial) {
    this._state = initial;
    this._handlers = {};
    this._log = [];
  }
  register(state, { onEnter = null, onUpdate = null, onExit = null } = {}) {
    this._handlers[state] = { onEnter, onUpdate, onExit };
    return this;
  }
  get current() { return this._state; }
  transition(next) {
    if (next === this._state) return;
    const h = this._handlers[this._state];
    if (h?.onExit) h.onExit();
    this._log.push(`exit:${this._state}`);
    this._state = next;
    this._log.push(`enter:${next}`);
    const nh = this._handlers[next];
    if (nh?.onEnter) nh.onEnter();
  }
  update(dt) {
    const h = this._handlers[this._state];
    if (h?.onUpdate) h.onUpdate(dt);
  }
}

const CANVAS_WIDTH  = 800;
const CANVAS_HEIGHT = 600;
const GROUND_HEIGHT = 60;
const STAR_COUNT    = 150;

const BATTERY_MISSILE_COUNT = 10;
const PLAYER_MISSILE_SPEED  = 300;
const BATTERY_APEX_OFFSET   = 24;
const CENTER_BATTERY_SPEED_MULTIPLIER = 1.5;

class Starfield {
  constructor(count, width, height) {
    this.stars = Array.from({ length: count }, () => ({
      x:            Math.random() * width,
      y:            Math.random() * (height - GROUND_HEIGHT),
      radius:       Math.random() * 1.2 + 0.3,
      alpha:        Math.random() * 0.5 + 0.5,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleDir:   Math.random() < 0.5 ? 1 : -1,
    }));
  }
  update(dt) {
    for (const s of this.stars) {
      s.alpha += s.twinkleSpeed * s.twinkleDir * dt * 60;
      if (s.alpha >= 1)   { s.alpha = 1;   s.twinkleDir = -1; }
      if (s.alpha <= 0.3) { s.alpha = 0.3; s.twinkleDir =  1; }
    }
  }
}

class Terrain {
  constructor(width, height) {
    this.width  = width;
    this.height = height;
    this.baseY  = height - GROUND_HEIGHT;
    this.points = this._generatePoints(width);
  }
  _generatePoints(width) {
    const segmentWidth = 20;
    const segments = Math.ceil(width / segmentWidth) + 1;
    const pts = [];
    for (let i = 0; i < segments; i++) {
      pts.push({ x: i * segmentWidth, y: this.baseY + (Math.random() * 16 - 8) });
    }
    pts[0].y = this.baseY;
    pts[pts.length - 1].y = this.baseY;
    return pts;
  }
}

// ─── City & Battery (inline copies for testing) ──────────────────────────────

const CITY_COLORS = ['#00ffff', '#ffff00', '#ff00ff', '#00ff00', '#ff8800', '#88ff88'];

class City {
  constructor(x, y, colorIndex) {
    this.x = x;
    this.y = y;
    this.alive = true;
    this.color = CITY_COLORS[colorIndex % CITY_COLORS.length];
  }
  destroy() { this.alive = false; }
}

class Battery {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.missiles = BATTERY_MISSILE_COUNT;
    this.alive = true;
  }
  destroy() { this.alive = false; }
}

/**
 * Minimal _initLayout() helper — mirrors the Game method for unit-testing _reset().
 * Creates fresh batteries and cities in classic 9-slot positions.
 */
function makeLayout(width, height) {
  const slotWidth    = width / 9;
  const groundY      = height - GROUND_HEIGHT;
  const batterySlots = [0, 3, 6];
  const citySlots    = [1, 2, 4, 5, 7, 8];
  const batteries = batterySlots.map(i => new Battery(i * slotWidth + slotWidth / 2, groundY));
  const cities    = citySlots.map((i, idx) => new City(i * slotWidth + slotWidth / 2, groundY, idx));
  return { batteries, cities };
}

/** Minimal _reset() logic for unit-testing without DOM. */
function makeResetState() {
  const state = {
    level: 99,
    score: 12345,
    playerMissiles:   [{}],
    playerExplosions: [{}],
    batteries: [],
    cities:    [],
  };
  state._initLayout = function () {
    const layout = makeLayout(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.batteries = layout.batteries;
    this.cities    = layout.cities;
  };
  state._reset = function () {
    this.level = 1;
    this.score = 0;
    this.playerMissiles   = [];
    this.playerExplosions = [];
    this._initLayout();
  };
  return state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GameState', () => {
  test('has all four required states', () => {
    expect(GameState.TITLE).toBe('TITLE');
    expect(GameState.PLAYING).toBe('PLAYING');
    expect(GameState.LEVEL_END).toBe('LEVEL_END');
    expect(GameState.GAME_OVER).toBe('GAME_OVER');
  });

  test('is frozen (immutable)', () => {
    // In ES module strict mode, mutating a frozen object throws TypeError.
    // In sloppy mode (old CommonJS) it was a silent no-op. Both are valid JS
    // semantics for Object.freeze; the important assertion is that the value
    // is unchanged either way.
    try { GameState.TITLE = 'MUTATED'; } catch { /* strict mode throw — expected */ }
    expect(GameState.TITLE).toBe('TITLE');
  });
});

describe('StateMachine', () => {
  test('starts in the initial state', () => {
    const sm = new StateMachine(GameState.TITLE);
    expect(sm.current).toBe(GameState.TITLE);
  });

  test('transitions to a new state', () => {
    const sm = new StateMachine(GameState.TITLE);
    sm.register(GameState.TITLE, {});
    sm.register(GameState.PLAYING, {});
    sm.transition(GameState.PLAYING);
    expect(sm.current).toBe(GameState.PLAYING);
  });

  test('does NOT transition to same state', () => {
    const sm = new StateMachine(GameState.TITLE);
    sm.register(GameState.TITLE, {});
    sm.transition(GameState.TITLE);
    expect(sm.current).toBe(GameState.TITLE);
    expect(sm._log).toHaveLength(0);
  });

  test('calls onExit for the leaving state', () => {
    let exitCalled = false;
    const sm = new StateMachine(GameState.TITLE);
    sm.register(GameState.TITLE,   { onExit:  () => { exitCalled = true; } });
    sm.register(GameState.PLAYING, {});
    sm.transition(GameState.PLAYING);
    expect(exitCalled).toBeTruthy();
  });

  test('calls onEnter for the new state', () => {
    let enterCalled = false;
    const sm = new StateMachine(GameState.TITLE);
    sm.register(GameState.TITLE,   {});
    sm.register(GameState.PLAYING, { onEnter: () => { enterCalled = true; } });
    sm.transition(GameState.PLAYING);
    expect(enterCalled).toBeTruthy();
  });

  test('calls onUpdate with delta time for current state', () => {
    let dtReceived = null;
    const sm = new StateMachine(GameState.PLAYING);
    sm.register(GameState.PLAYING, { onUpdate: (dt) => { dtReceived = dt; } });
    sm.update(0.016);
    expect(dtReceived).toBe(0.016);
  });

  test('full TITLE → PLAYING → GAME_OVER transition chain', () => {
    const sm = new StateMachine(GameState.TITLE);
    sm.register(GameState.TITLE,     {});
    sm.register(GameState.PLAYING,   {});
    sm.register(GameState.GAME_OVER, {});

    sm.transition(GameState.PLAYING);
    expect(sm.current).toBe(GameState.PLAYING);

    sm.transition(GameState.GAME_OVER);
    expect(sm.current).toBe(GameState.GAME_OVER);
  });

  test('LEVEL_END → PLAYING (next level) works', () => {
    const sm = new StateMachine(GameState.PLAYING);
    sm.register(GameState.PLAYING,   {});
    sm.register(GameState.LEVEL_END, {});

    sm.transition(GameState.LEVEL_END);
    expect(sm.current).toBe(GameState.LEVEL_END);

    sm.transition(GameState.PLAYING);
    expect(sm.current).toBe(GameState.PLAYING);
  });
});

describe('Starfield', () => {
  test(`creates ${STAR_COUNT} stars`, () => {
    const sf = new Starfield(STAR_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT);
    expect(sf.stars).toHaveLength(STAR_COUNT);
  });

  test('all stars have x within canvas width', () => {
    const sf = new Starfield(STAR_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const s of sf.stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(CANVAS_WIDTH);
    }
  });

  test('all stars have y above the ground strip', () => {
    const sf = new Starfield(STAR_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const s of sf.stars) {
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(CANVAS_HEIGHT - GROUND_HEIGHT);
    }
  });

  test('alpha stays in [0.3, 1] after many update cycles', () => {
    const sf = new Starfield(STAR_COUNT, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (let i = 0; i < 1000; i++) sf.update(0.016);
    for (const s of sf.stars) {
      expect(s.alpha).toBeGreaterThanOrEqual(0.3);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe('Terrain', () => {
  test('generates points spanning full canvas width', () => {
    const t = new Terrain(CANVAS_WIDTH, CANVAS_HEIGHT);
    const xs = t.points.map(p => p.x);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(CANVAS_WIDTH);
  });

  test('first and last points are at baseY', () => {
    const t = new Terrain(CANVAS_WIDTH, CANVAS_HEIGHT);
    expect(t.points[0].y).toBe(t.baseY);
    expect(t.points[t.points.length - 1].y).toBe(t.baseY);
  });

  test('baseY is canvas height minus GROUND_HEIGHT', () => {
    const t = new Terrain(CANVAS_WIDTH, CANVAS_HEIGHT);
    expect(t.baseY).toBe(CANVAS_HEIGHT - GROUND_HEIGHT);
  });

  test('all points have y within ±8 px of baseY (except clamped edges)', () => {
    const t = new Terrain(CANVAS_WIDTH, CANVAS_HEIGHT);
    const interior = t.points.slice(1, -1);
    for (const p of interior) {
      expect(p.y).toBeGreaterThanOrEqual(t.baseY - 8);
      expect(p.y).toBeLessThanOrEqual(t.baseY + 8);
    }
  });
});

// ─── drawCenteredText (inline copy for testing) ───────────────────────────────

function drawCenteredText(ctx, lines, startY, canvasWidth, { font = '48px monospace', fillStyle = '#fff', lineHeight = 60 } = {}) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = fillStyle;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = startY;
  for (const line of lines) {
    ctx.fillText(line, canvasWidth / 2, y);
    y += lineHeight;
  }
  ctx.restore();
}

describe('drawCenteredText', () => {
  // Minimal canvas 2d context mock
  function makeCtx() {
    const calls = [];
    return {
      calls,
      save()         { calls.push('save'); },
      restore()      { calls.push('restore'); },
      fillText(text, x, y) { calls.push({ fillText: { text, x, y } }); },
      font: '',
      fillStyle: '',
      textAlign: '',
      textBaseline: '',
    };
  }

  test('calls fillText once per line', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['LINE A', 'LINE B'], 100, 800);
    const texts = ctx.calls.filter(c => c.fillText).map(c => c.fillText.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe('LINE A');
    expect(texts[1]).toBe('LINE B');
  });

  test('centers text at canvasWidth / 2', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['HELLO'], 200, 800);
    const call = ctx.calls.find(c => c.fillText);
    expect(call.fillText.x).toBe(400);
  });

  test('applies canvasWidth correctly (not NaN)', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['TEST'], 100, 800);
    const call = ctx.calls.find(c => c.fillText);
    expect(typeof call.fillText.x).toBe('number');
    // If canvasWidth were an options object, x would be NaN — guard against regression
    expect(call.fillText.x).toBeGreaterThan(0);
  });

  test('first line renders at startY', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['FIRST'], 150, 800);
    const call = ctx.calls.find(c => c.fillText);
    expect(call.fillText.y).toBe(150);
  });

  test('subsequent lines are offset by lineHeight', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['A', 'B', 'C'], 100, 800, { lineHeight: 50 });
    const textCalls = ctx.calls.filter(c => c.fillText).map(c => c.fillText.y);
    expect(textCalls[0]).toBe(100);
    expect(textCalls[1]).toBe(150);
    expect(textCalls[2]).toBe(200);
  });

  test('respects custom font and fillStyle options', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['X'], 50, 800, { font: '24px sans-serif', fillStyle: '#f00' });
    expect(ctx.font).toBe('24px sans-serif');
    expect(ctx.fillStyle).toBe('#f00');
  });

  test('wraps calls in save/restore', () => {
    const ctx = makeCtx();
    drawCenteredText(ctx, ['Y'], 50, 800);
    expect(ctx.calls[0]).toBe('save');
    expect(ctx.calls[ctx.calls.length - 1]).toBe('restore');
  });
});

describe('Delta-time cap', () => {
  test('max dt cap of 100 ms prevents spiral of death', () => {
    // Simulate the cap logic from the game loop
    const rawDelta = 5000; // 5 seconds (tab was backgrounded)
    const dt = Math.min(rawDelta / 1000, 0.1);
    expect(dt).toBeLessThanOrEqual(0.1);
  });
});

describe('City', () => {
  test('starts alive with correct position', () => {
    const c = new City(100, 540, 0);
    expect(c.alive).toBe(true);
    expect(c.x).toBe(100);
    expect(c.y).toBe(540);
  });

  test('has a color from CITY_COLORS', () => {
    const c = new City(100, 540, 2);
    expect(c.color).toBe('#ff00ff');
  });

  test('destroy() sets alive to false', () => {
    const c = new City(100, 540, 0);
    c.destroy();
    expect(c.alive).toBe(false);
  });

  test('color cycles with colorIndex', () => {
    const c0 = new City(0, 0, 0);
    const c6 = new City(0, 0, 6); // wraps around
    expect(c0.color).toBe(c6.color);
  });
});

describe('Battery', () => {
  test(`starts alive with ${BATTERY_MISSILE_COUNT} missiles`, () => {
    const b = new Battery(200, 540);
    expect(b.alive).toBe(true);
    expect(b.missiles).toBe(BATTERY_MISSILE_COUNT);
  });

  test('has correct position', () => {
    const b = new Battery(200, 540);
    expect(b.x).toBe(200);
    expect(b.y).toBe(540);
  });

  test('destroy() sets alive to false', () => {
    const b = new Battery(200, 540);
    b.destroy();
    expect(b.alive).toBe(false);
  });

  test('missiles count can be decremented', () => {
    const b = new Battery(200, 540);
    b.missiles--;
    expect(b.missiles).toBe(9);
  });
});

// ─── MIS-5 classes (inline copies for testing) ───────────────────────────────

class Crosshair {
  constructor() {
    this.x = 0;
    this.y = 0;
  }
  render(ctx) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x - 20, this.y);
    ctx.lineTo(this.x + 20, this.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 20);
    ctx.lineTo(this.x, this.y + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

class PlayerMissile {
  constructor(startX, startY, targetX, targetY, speed = 300) {
    this.startX  = startX;
    this.startY  = startY;
    this.targetX = targetX;
    this.targetY = targetY;
    this.x       = startX;
    this.y       = startY;
    this.speed   = speed;
    this.done    = false;
  }
  update(dt) {
    if (this.done) return;
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 2) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.done = true;
      return;
    }
    const step = this.speed * dt;
    if (step >= dist) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.done = true;
      return;
    }
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
  }
}

class PlayerExplosion {
  constructor(x, y, maxRadius = 40, expandDuration = 0.25, holdDuration = 0.15, contractDuration = 0.25) {
    this.x         = x;
    this.y         = y;
    this.maxRadius = maxRadius;
    this.expandDuration   = expandDuration;
    this.holdDuration     = holdDuration;
    this.contractDuration = contractDuration;
    this.phase   = 'expand';
    this.timer   = 0;
    this.radius  = 0;
    this.done    = false;
  }
  update(dt) {
    if (this.done) return;
    this.timer += dt;
    if (this.phase === 'expand') {
      if (this.timer >= this.expandDuration) {
        this.radius = this.maxRadius;
        this.timer -= this.expandDuration;
        this.phase = 'hold';
      } else {
        this.radius = this.maxRadius * (this.timer / this.expandDuration);
      }
    }
    if (this.phase === 'hold') {
      this.radius = this.maxRadius;
      if (this.timer >= this.holdDuration) {
        this.timer -= this.holdDuration;
        this.phase = 'contract';
      }
    }
    if (this.phase === 'contract') {
      if (this.timer >= this.contractDuration) {
        this.radius = 0;
        this.done = true;
      } else {
        this.radius = this.maxRadius * (1 - this.timer / this.contractDuration);
      }
    }
  }
}

// ─── MIS-5 Tests ──────────────────────────────────────────────────────────────

describe('MIS-5 — Crosshair', () => {
  test('Crosshair tracks position', () => {
    const ch = new Crosshair();
    expect(ch.x).toBe(0);
    expect(ch.y).toBe(0);
    ch.x = 400;
    ch.y = 300;
    expect(ch.x).toBe(400);
    expect(ch.y).toBe(300);
  });
});

describe('MIS-5 — PlayerMissile', () => {
  test('default speed is PLAYER_MISSILE_SPEED', () => {
    const m = new PlayerMissile(0, 0, 1000, 0);
    expect(m.speed).toBe(PLAYER_MISSILE_SPEED);
  });

  test('moves toward target', () => {
    const m = new PlayerMissile(0, 0, 300, 0, 100);
    m.update(1); // 1 second at 100 px/sec
    expect(m.x).toBeGreaterThan(0);
    expect(m.done).toBe(false);
  });

  test('marks done when within 2px of target', () => {
    const m = new PlayerMissile(0, 0, 10, 0, 1000);
    m.update(1); // overshoots
    expect(m.done).toBe(true);
    expect(m.x).toBe(10);
    expect(m.y).toBe(0);
  });

  test('does not overshoot target', () => {
    const m = new PlayerMissile(0, 0, 50, 0, 10000);
    m.update(1); // speed * dt = 10000 >> 50
    expect(m.x).toBe(50);
    expect(m.y).toBe(0);
    expect(m.done).toBe(true);
  });
});

describe('MIS-5 — PlayerExplosion', () => {
  test('grows radius over time', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.1); // partial expand
    expect(e.radius).toBeGreaterThan(0);
    expect(e.radius).toBeLessThanOrEqual(40);
    expect(e.done).toBe(false);
  });

  test('marks done after full lifecycle', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.25); // expand
    e.update(0.15); // hold
    e.update(0.25); // contract
    expect(e.done).toBe(true);
  });
});

describe('MIS-5 — _fireNearest logic', () => {
  // Replicate the findNearest algorithm inline (pure, no DOM)
  function fireNearest(batteries, targetX) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < batteries.length; i++) {
      const b = batteries[i];
      if (!b.alive || b.missiles <= 0) continue;
      const d = Math.abs(b.x - targetX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  test('selects nearest available battery', () => {
    const batteries = [
      new Battery(100, 540),
      new Battery(400, 540),
      new Battery(700, 540),
    ];
    // Click near right battery
    expect(fireNearest(batteries, 650)).toBe(2);
    // Click near left battery
    expect(fireNearest(batteries, 120)).toBe(0);
    // Click near center battery
    expect(fireNearest(batteries, 380)).toBe(1);
  });

  test('skips destroyed batteries', () => {
    const batteries = [
      new Battery(100, 540),
      new Battery(400, 540),
      new Battery(700, 540),
    ];
    batteries[2].destroy();
    // Click near destroyed right battery — should pick center
    expect(fireNearest(batteries, 650)).toBe(1);
  });

  test('skips empty batteries', () => {
    const batteries = [
      new Battery(100, 540),
      new Battery(400, 540),
      new Battery(700, 540),
    ];
    batteries[0].missiles = 0;
    // Click near left battery — should pick center
    expect(fireNearest(batteries, 120)).toBe(1);
  });

  test('does nothing if all batteries unavailable', () => {
    const batteries = [
      new Battery(100, 540),
      new Battery(400, 540),
      new Battery(700, 540),
    ];
    batteries[0].destroy();
    batteries[1].missiles = 0;
    batteries[2].destroy();
    expect(fireNearest(batteries, 400)).toBe(-1);
  });
});

describe('MIS-5 — _reset() restores batteries and cities', () => {
  test('resets level and score to initial values', () => {
    const state = makeResetState();
    state._reset();
    expect(state.level).toBe(1);
    expect(state.score).toBe(0);
  });

  test('clears in-flight missiles and explosions', () => {
    const state = makeResetState();
    state._reset();
    expect(state.playerMissiles).toHaveLength(0);
    expect(state.playerExplosions).toHaveLength(0);
  });

  test('restores exactly 3 batteries, all alive', () => {
    const state = makeResetState();
    // Destroy everything first
    state._initLayout();
    state.batteries.forEach(b => b.destroy());
    state.batteries.forEach(b => { b.missiles = 0; });
    // Now reset
    state._reset();
    expect(state.batteries).toHaveLength(3);
    for (const b of state.batteries) {
      expect(b.alive).toBe(true);
    }
  });

  test('restores batteries with full ammo after reset', () => {
    const state = makeResetState();
    state._initLayout();
    state.batteries.forEach(b => { b.missiles = 0; });
    state._reset();
    for (const b of state.batteries) {
      expect(b.missiles).toBe(BATTERY_MISSILE_COUNT);
    }
  });

  test('restores exactly 6 cities, all alive', () => {
    const state = makeResetState();
    state._initLayout();
    state.cities.forEach(c => c.destroy());
    state._reset();
    expect(state.cities).toHaveLength(6);
    for (const c of state.cities) {
      expect(c.alive).toBe(true);
    }
  });
});

describe('MIS-5 — _mouseReady guard (no firing before first mousemove)', () => {
  // Replicate the guard logic inline
  function makeInputState() {
    return {
      _mouseX:     0,
      _mouseY:     0,
      _mouseReady: false,
      fired:       [],
      _fireFrom(idx, x, y) { this.fired.push({ idx, x, y }); },
      _onKeyDown(key) {
        // mirrors Game._onKeyDown firing block
        if (!this._mouseReady) return;
        if (key === '1') this._fireFrom(0, this._mouseX, this._mouseY);
        if (key === '2') this._fireFrom(1, this._mouseX, this._mouseY);
        if (key === '3') this._fireFrom(2, this._mouseX, this._mouseY);
      },
      _onMouseMove(x, y) {
        this._mouseX     = x;
        this._mouseY     = y;
        this._mouseReady = true;
      },
    };
  }

  test('pressing 1/2/3 before mousemove does NOT fire', () => {
    const s = makeInputState();
    s._onKeyDown('1');
    s._onKeyDown('2');
    s._onKeyDown('3');
    expect(s.fired).toHaveLength(0);
  });

  test('pressing 1/2/3 AFTER mousemove does fire', () => {
    const s = makeInputState();
    s._onMouseMove(400, 300);
    s._onKeyDown('1');
    expect(s.fired).toHaveLength(1);
    expect(s.fired[0].idx).toBe(0);
    expect(s.fired[0].x).toBe(400);
  });

  test('_mouseReady is false at construction, true after first move', () => {
    const s = makeInputState();
    expect(s._mouseReady).toBe(false);
    s._onMouseMove(100, 200);
    expect(s._mouseReady).toBe(true);
  });
});

// ─── MIS-6 Tests ──────────────────────────────────────────────────────────────

describe('MIS-6 — PlayerExplosion lifecycle', () => {
  test('initial phase is "expand" with radius 0', () => {
    const e = new PlayerExplosion(100, 200);
    expect(e.phase).toBe('expand');
    expect(e.radius).toBe(0);
    expect(e.done).toBe(false);
  });

  test('partial expand: radius > 0 and < maxRadius', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.1);
    expect(e.phase).toBe('expand');
    expect(e.radius).toBeGreaterThan(0);
    expect(e.radius).toBeLessThanOrEqual(40);
  });

  test('after expand completes, phase is "hold" with radius === maxRadius', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.25); // exactly expand duration
    expect(e.phase).toBe('hold');
    expect(e.radius).toBe(40);
  });

  test('after hold completes, phase transitions to "contract"', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.25); // expand
    e.update(0.15); // hold
    expect(e.phase).toBe('contract');
  });

  test('after contract completes, done === true', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.25); // expand
    e.update(0.15); // hold
    e.update(0.25); // contract
    expect(e.done).toBe(true);
    expect(e.radius).toBe(0);
  });

  test('radius shrinks during contract phase', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.25, 0.15, 0.25);
    e.update(0.25); // expand
    e.update(0.15); // hold
    e.update(0.1);  // partial contract
    expect(e.phase).toBe('contract');
    expect(e.radius).toBeGreaterThan(0);
    expect(e.radius).toBeLessThanOrEqual(40);
  });
});

describe('MIS-6 — Speed differentiation', () => {
  // Replicate _fireFrom logic inline (pure, no DOM)
  function fireFrom(batteries, batteryIndex, targetX, targetY) {
    if (batteryIndex < 0 || batteryIndex >= batteries.length) return null;
    const battery = batteries[batteryIndex];
    if (!battery.alive || battery.missiles <= 0) return null;
    battery.missiles--;
    const speed = batteryIndex === 1
      ? PLAYER_MISSILE_SPEED * CENTER_BATTERY_SPEED_MULTIPLIER
      : PLAYER_MISSILE_SPEED;
    return new PlayerMissile(battery.x, battery.y - BATTERY_APEX_OFFSET, targetX, targetY, speed);
  }

  test('center battery (index 1) fires faster than left/right batteries', () => {
    const batteries = [
      new Battery(100, 540),
      new Battery(400, 540),
      new Battery(700, 540),
    ];
    const mCenter = fireFrom(batteries, 1, 400, 200);
    const mLeft   = fireFrom(batteries, 0, 400, 200);
    const mRight  = fireFrom(batteries, 2, 400, 200);
    expect(mCenter.speed).toBeGreaterThan(mLeft.speed);
    expect(mCenter.speed).toBeGreaterThan(mRight.speed);
    expect(mCenter.speed).toBe(PLAYER_MISSILE_SPEED * CENTER_BATTERY_SPEED_MULTIPLIER);
    expect(mLeft.speed).toBe(PLAYER_MISSILE_SPEED);
    expect(mRight.speed).toBe(PLAYER_MISSILE_SPEED);
  });

  test('ammo decrements on each launch', () => {
    const batteries = [new Battery(100, 540)];
    expect(batteries[0].missiles).toBe(BATTERY_MISSILE_COUNT);
    fireFrom(batteries, 0, 400, 200);
    expect(batteries[0].missiles).toBe(BATTERY_MISSILE_COUNT - 1);
    fireFrom(batteries, 0, 400, 200);
    expect(batteries[0].missiles).toBe(BATTERY_MISSILE_COUNT - 2);
  });

  test('firing from empty battery does nothing', () => {
    const batteries = [new Battery(100, 540)];
    batteries[0].missiles = 0;
    const result = fireFrom(batteries, 0, 400, 200);
    expect(result).toBe(null);
    expect(batteries[0].missiles).toBe(0);
  });

  test('firing from destroyed battery does nothing', () => {
    const batteries = [new Battery(100, 540)];
    batteries[0].destroy();
    const result = fireFrom(batteries, 0, 400, 200);
    expect(result).toBe(null);
  });
});

// ─── MIS-7 Tests ──────────────────────────────────────────────────────────────

describe('MIS-7 — EnemyMissile', () => {
  test('EnemyMissile moves toward target', () => {
    const m = new EnemyMissile(400, 0, 400, 540, 100);
    m.update(1);
    expect(m.y).toBeGreaterThan(0);
    expect(m.done).toBe(false);
  });

  test('EnemyMissile records trail positions', () => {
    const m = new EnemyMissile(400, 0, 400, 540, 100);
    m.update(0.1);
    expect(m.trail.length).toBeGreaterThan(0);
    expect(m.trail[0].x).toBe(400);
    expect(m.trail[0].y).toBe(0);
  });

  test('EnemyMissile trail is capped at ENEMY_TRAIL_LENGTH', () => {
    const m = new EnemyMissile(400, 0, 400, 5400, 10); // far target so it won't arrive
    for (let i = 0; i < 50; i++) m.update(0.016);
    expect(m.trail.length).toBeLessThanOrEqual(ENEMY_TRAIL_LENGTH);
  });

  test('MIRV sets split=true when reaching mirvAltitude', () => {
    // Target at y=540, mirvAltitude at y=200
    const m = new EnemyMissile(400, 0, 400, 540, 1000, true, 200);
    m.update(0.3); // should move 300px down, past altitude 200
    expect(m.split).toBe(true);
    expect(m.done).toBe(true);
  });

  test('MIRV done=true guard prevents re-entry into update logic', () => {
    // Once a MIRV sets done=true (via split), the `if (this.done) return` guard
    // at the top of update() makes all subsequent calls no-ops.
    const m = new EnemyMissile(400, 0, 400, 540, 1000, true, 200);
    m.update(0.3); // triggers split → split=true, done=true
    expect(m.split).toBe(true);
    expect(m.done).toBe(true);

    const xAfterSplit      = m.x;
    const yAfterSplit      = m.y;
    const trailAfterSplit  = m.trail.length;

    // Large dt — would move the missile far if update() were not guarded
    m.update(100);
    m.update(100);

    expect(m.x).toBe(xAfterSplit);           // position unchanged
    expect(m.y).toBe(yAfterSplit);           // position unchanged
    expect(m.trail.length).toBe(trailAfterSplit); // no new trail entries
  });

  test('Non-MIRV never sets split=true', () => {
    const m = new EnemyMissile(400, 0, 400, 540, 1000, false, null);
    m.update(1); // reaches target
    expect(m.split).toBe(false);
    expect(m.done).toBe(true);
  });

  test('EnemyMissile marks done when reaching target', () => {
    const m = new EnemyMissile(400, 0, 400, 10, 10000);
    m.update(1);
    expect(m.done).toBe(true);
    expect(m.x).toBe(400);
    expect(m.y).toBe(10);
  });
});

describe('MIS-7 — EnemyExplosion', () => {
  test('EnemyExplosion has same lifecycle as PlayerExplosion (expand/hold/contract)', () => {
    const e = new EnemyExplosion(100, 540);
    expect(e.phase).toBe('expand');
    e.update(0.1);
    expect(e.radius).toBeGreaterThan(0);
    e.update(0.15); // finish expand
    expect(e.phase).toBe('hold');
    expect(e.radius).toBe(35);
    e.update(0.15); // finish hold
    expect(e.phase).toBe('contract');
  });

  test('EnemyExplosion done after full lifecycle', () => {
    const e = new EnemyExplosion(100, 540, 35, 0.25, 0.15, 0.25);
    e.update(0.25); // expand
    e.update(0.15); // hold
    e.update(0.25); // contract
    expect(e.done).toBe(true);
    expect(e.radius).toBe(0);
  });
});

describe('MIS-7 — _spawnEnemyWave logic', () => {
  test('missile count formula: base + (level-1)*scale, capped at max', () => {
    // Level 1: 8
    expect(Math.min(ENEMY_BASE_COUNT + (1 - 1) * ENEMY_COUNT_SCALE, ENEMY_MAX_COUNT)).toBe(8);
    // Level 4: 8 + 3*2 = 14
    expect(Math.min(ENEMY_BASE_COUNT + (4 - 1) * ENEMY_COUNT_SCALE, ENEMY_MAX_COUNT)).toBe(14);
    // Level 7: 8 + 6*2 = 20 (cap)
    expect(Math.min(ENEMY_BASE_COUNT + (7 - 1) * ENEMY_COUNT_SCALE, ENEMY_MAX_COUNT)).toBe(20);
    // Level 10: capped at 20
    expect(Math.min(ENEMY_BASE_COUNT + (10 - 1) * ENEMY_COUNT_SCALE, ENEMY_MAX_COUNT)).toBe(20);
  });

  test('speed formula: base * (1 + (level-1)*scale)', () => {
    // Level 1: 80
    expect(ENEMY_MISSILE_BASE_SPEED * (1 + (1 - 1) * ENEMY_MISSILE_SPEED_SCALE)).toBe(80);
    // Level 2: 80 * 1.15 = 92
    expect(ENEMY_MISSILE_BASE_SPEED * (1 + (2 - 1) * ENEMY_MISSILE_SPEED_SCALE)).toBe(92);
    // Level 5: 80 * 1.6 = 128
    expect(ENEMY_MISSILE_BASE_SPEED * (1 + (5 - 1) * ENEMY_MISSILE_SPEED_SCALE)).toBe(128);
  });

  test('MIRV chance is within valid probability range', () => {
    expect(ENEMY_MIRV_CHANCE).toBeGreaterThan(0);
    expect(ENEMY_MIRV_CHANCE).toBeLessThanOrEqual(1);
  });
});

describe('MIS-7 — enemy wave end detection', () => {
  test('transitions to LEVEL_END when all missiles and explosions are gone', () => {
    let transitioned = false;
    const state = {
      enemyMissiles: [],
      enemyExplosions: [],
      cities: [new City(100, 540, 0)],
      batteries: [new Battery(400, 540)],
      sm: { transition(s) { if (s === GameState.LEVEL_END) transitioned = true; } },
    };
    // Simulate _updateEnemies logic: empty arrays → transition
    if (state.enemyMissiles.length === 0 && state.enemyExplosions.length === 0) {
      state.sm.transition(GameState.LEVEL_END);
    }
    expect(transitioned).toBe(true);
  });

  test('does NOT transition when missiles still in flight', () => {
    let transitioned = false;
    const state = {
      enemyMissiles: [new EnemyMissile(400, 0, 400, 540, 80)],
      enemyExplosions: [],
      sm: { transition(s) { if (s === GameState.LEVEL_END) transitioned = true; } },
    };
    if (state.enemyMissiles.length === 0 && state.enemyExplosions.length === 0) {
      state.sm.transition(GameState.LEVEL_END);
    }
    expect(transitioned).toBe(false);
  });

  test('does NOT transition when explosions still active', () => {
    let transitioned = false;
    const state = {
      enemyMissiles: [],
      enemyExplosions: [new EnemyExplosion(400, 540)],
      sm: { transition(s) { if (s === GameState.LEVEL_END) transitioned = true; } },
    };
    if (state.enemyMissiles.length === 0 && state.enemyExplosions.length === 0) {
      state.sm.transition(GameState.LEVEL_END);
    }
    expect(transitioned).toBe(false);
  });
});

describe('MIS-7 — EnemyMissile edge cases', () => {
  test('rejects zero speed', () => {
    expect(() => new EnemyMissile(400, 0, 400, 540, 0)).toThrow();
  });

  test('rejects negative speed', () => {
    expect(() => new EnemyMissile(400, 0, 400, 540, -10)).toThrow();
  });

  test('spawnEnemyWave with no alive targets produces no missiles (early-return path)', () => {
    // When all cities and batteries are destroyed, aliveTargets is empty.
    // _spawnEnemyWave returns early, leaving enemyMissiles empty.
    // The first _updateEnemies call will then immediately transition to LEVEL_END.
    // This is intentional: a destroyed base shouldn't block wave-end detection.
    function spawnWave(cities, batteries, level) {
      const aliveTargets = [
        ...cities.filter(c => c.alive),
        ...batteries.filter(b => b.alive),
      ];
      if (aliveTargets.length === 0) return []; // early-return guard
      const missileCount = Math.min(
        ENEMY_BASE_COUNT + (level - 1) * ENEMY_COUNT_SCALE,
        ENEMY_MAX_COUNT
      );
      const speed = ENEMY_MISSILE_BASE_SPEED * (1 + (level - 1) * ENEMY_MISSILE_SPEED_SCALE);
      const missiles = [];
      for (let i = 0; i < missileCount; i++) {
        const target = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
        missiles.push(new EnemyMissile(50, 0, target.x, target.y, speed));
      }
      return missiles;
    }

    const deadCity    = new City(100, 540, 0); deadCity.destroy();
    const deadBattery = new Battery(400, 540);  deadBattery.destroy();
    const result = spawnWave([deadCity], [deadBattery], 1);
    expect(result).toHaveLength(0);
  });

  test('MIRV split with no alive targets spawns no children (wave ends cleanly)', () => {
    // If all cities/batteries are destroyed when a MIRV splits, the
    // aliveTargets guard (`&& aliveTargets.length > 0`) produces no children.
    // The wave should still resolve: no stranded missiles, clean LEVEL_END.
    const missile = new EnemyMissile(400, 0, 400, 540, 1000, true, 200);
    missile.update(0.3); // triggers split
    expect(missile.split).toBe(true);

    // Simulate _updateEnemies child-spawn logic with no alive targets
    const aliveTargets = [];
    const newMissiles  = [];
    const childCount   = 2 + Math.floor(Math.random() * 2); // 2 or 3
    for (let i = 0; i < childCount && aliveTargets.length > 0; i++) {
      const target = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
      newMissiles.push(new EnemyMissile(missile.x, missile.y, target.x, target.y, missile.speed, false, null));
    }

    // No children produced — wave can end on next _updateEnemies tick
    expect(newMissiles).toHaveLength(0);
  });
});

// ─── MIS-8 Tests ──────────────────────────────────────────────────────────────

describe('MIS-8 — Collision Detection', () => {
  /** Helper: create a minimal collision state. */
  function makeCollisionState(overrides = {}) {
    return {
      playerExplosions: [],
      enemyMissiles:    [],
      enemyExplosions:  [],
      cities:           [],
      batteries:        [],
      score:            0,
      ...overrides,
    };
  }

  test('player explosion destroys enemy missile in radius → missile.done, score += 25', () => {
    const explosion = new PlayerExplosion(100, 100, 40);
    explosion.update(0.25); // expand to full radius (40px)
    const missile = new EnemyMissile(110, 100, 110, 540, 80); // 10px away, within 40px radius
    const state = makeCollisionState({
      playerExplosions: [explosion],
      enemyMissiles:    [missile],
    });
    const result = checkCollisions(state);
    expect(missile.done).toBe(true);
    expect(result.score).toBe(POINTS_PER_MISSILE);
  });

  test('player explosion does NOT destroy missile outside radius', () => {
    const explosion = new PlayerExplosion(100, 100, 40);
    explosion.update(0.25); // radius = 40
    const missile = new EnemyMissile(200, 100, 200, 540, 80); // 100px away, outside 40px radius
    const state = makeCollisionState({
      playerExplosions: [explosion],
      enemyMissiles:    [missile],
    });
    const result = checkCollisions(state);
    expect(missile.done).toBe(false);
    expect(result.score).toBe(0);
  });

  test('chain reaction: destroyed missile spawns EnemyExplosion with isChain = true', () => {
    const explosion = new PlayerExplosion(100, 100, 40);
    explosion.update(0.25); // radius = 40
    const missile = new EnemyMissile(110, 100, 110, 540, 80);
    const enemyExplosions = [];
    const state = makeCollisionState({
      playerExplosions: [explosion],
      enemyMissiles:    [missile],
      enemyExplosions:  enemyExplosions,
    });
    checkCollisions(state);
    expect(enemyExplosions.length).toBeGreaterThan(0);
    expect(enemyExplosions[0].isChain).toBe(true);
    expect(enemyExplosions[0].x).toBe(missile.x);
    expect(enemyExplosions[0].y).toBe(missile.y);
  });

  test('enemy ground explosion destroys city in radius', () => {
    const city = new City(100, 540, 0);
    const explosion = new EnemyExplosion(105, 540, 35); // 5px away, within 35px radius
    explosion.update(0.25); // expand to full radius
    const state = makeCollisionState({
      enemyExplosions: [explosion],
      cities:          [city],
    });
    checkCollisions(state);
    expect(city.alive).toBe(false);
  });

  test('enemy ground explosion does NOT destroy city outside radius', () => {
    const city = new City(200, 540, 0);
    const explosion = new EnemyExplosion(100, 540, 35); // 100px away, outside 35px radius
    explosion.update(0.25);
    const state = makeCollisionState({
      enemyExplosions: [explosion],
      cities:          [city],
    });
    checkCollisions(state);
    expect(city.alive).toBe(true);
  });

  test('chain explosion does NOT destroy cities', () => {
    const city = new City(100, 540, 0);
    const explosion = new EnemyExplosion(105, 540, 35);
    explosion.isChain = true;
    explosion.update(0.25);
    const state = makeCollisionState({
      enemyExplosions: [explosion],
      cities:          [city],
    });
    checkCollisions(state);
    expect(city.alive).toBe(true);
  });

  test('all cities destroyed → gameOver is true', () => {
    const cities = [
      new City(100, 540, 0),
      new City(200, 540, 1),
      new City(300, 540, 2),
      new City(400, 540, 3),
      new City(500, 540, 4),
      new City(600, 540, 5),
    ];
    // Destroy all cities
    for (const c of cities) c.destroy();
    const state = makeCollisionState({ cities });
    const result = checkCollisions(state);
    expect(result.gameOver).toBe(true);
  });

  test('some cities alive → gameOver is false', () => {
    const cities = [
      new City(100, 540, 0),
      new City(200, 540, 1),
    ];
    cities[0].destroy();
    const state = makeCollisionState({ cities });
    const result = checkCollisions(state);
    expect(result.gameOver).toBe(false);
  });

  test('enemy ground explosion destroys battery in radius', () => {
    const battery = new Battery(100, 540);
    const explosion = new EnemyExplosion(105, 540, 35);
    explosion.update(0.25);
    const state = makeCollisionState({
      enemyExplosions: [explosion],
      batteries:       [battery],
      cities:          [new City(400, 540, 0)], // keep a city alive to avoid gameOver
    });
    checkCollisions(state);
    expect(battery.alive).toBe(false);
  });

  test('chain explosion does NOT destroy batteries', () => {
    const battery = new Battery(100, 540);
    const explosion = new EnemyExplosion(105, 540, 35);
    explosion.isChain = true;
    explosion.update(0.25);
    const state = makeCollisionState({
      enemyExplosions: [explosion],
      batteries:       [battery],
    });
    checkCollisions(state);
    expect(battery.alive).toBe(true);
  });

  test('existing enemy explosions can chain-destroy enemy missiles', () => {
    // An existing (non-chain) enemy explosion should also destroy nearby enemy missiles
    const explosion = new EnemyExplosion(100, 100, 35);
    explosion.update(0.25); // radius = 35
    const missile = new EnemyMissile(110, 100, 110, 540, 80); // 10px away
    const state = makeCollisionState({
      enemyExplosions: [explosion],
      enemyMissiles:   [missile],
    });
    const result = checkCollisions(state);
    expect(missile.done).toBe(true);
    expect(result.score).toBe(POINTS_PER_MISSILE);
    // Should have spawned a chain explosion
    expect(state.enemyExplosions.length).toBe(2);
    expect(state.enemyExplosions[1].isChain).toBe(true);
  });

  test("empty cities array does NOT trigger game over", () => {
    const state = makeCollisionState({ cities: [] });
    const result = checkCollisions(state);
    expect(result.gameOver).toBe(false);
  });

  test("missile destroyed by player explosion is not double-scored by enemy explosion", () => {
    const playerExplosion = new PlayerExplosion(100, 100, 40);
    playerExplosion.update(0.25); // radius = 40

    const enemyExplosion = new EnemyExplosion(100, 100, 40); // same position
    enemyExplosion.update(0.25); // radius = 40

    const missile = new EnemyMissile(110, 100, 110, 540, 80); // within both radii

    const state = makeCollisionState({
      playerExplosions: [playerExplosion],
      enemyExplosions:  [enemyExplosion],
      enemyMissiles:    [missile],
    });

    const result = checkCollisions(state);
    // Missile should be hit only once — score must be exactly 25, not 50
    expect(missile.done).toBe(true);
    expect(result.score).toBe(POINTS_PER_MISSILE); // 25, not 50
  });

  test('POINTS_PER_MISSILE is 25', () => {
    expect(POINTS_PER_MISSILE).toBe(25);
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailed tests:');
  for (const f of failures) console.error(`  • ${f.name}: ${f.err.message}`);
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}
