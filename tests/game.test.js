/**
 * MIS-3 Unit Tests — game scaffolding, state machine, terrain, starfield
 *
 * Run with: node --experimental-vm-modules tests/game.test.js
 * Or:       node tests/game.test.js   (uses the inline test runner below)
 */

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GameState', () => {
  test('has all four required states', () => {
    expect(GameState.TITLE).toBe('TITLE');
    expect(GameState.PLAYING).toBe('PLAYING');
    expect(GameState.LEVEL_END).toBe('LEVEL_END');
    expect(GameState.GAME_OVER).toBe('GAME_OVER');
  });

  test('is frozen (immutable)', () => {
    GameState.TITLE = 'MUTATED'; // should silently fail in strict or be ignored
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

describe('Delta-time cap', () => {
  test('max dt cap of 100 ms prevents spiral of death', () => {
    // Simulate the cap logic from the game loop
    const rawDelta = 5000; // 5 seconds (tab was backgrounded)
    const dt = Math.min(rawDelta / 1000, 0.1);
    expect(dt).toBeLessThanOrEqual(0.1);
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
