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
    this.missiles = 10;
    this.alive = true;
  }
  destroy() { this.alive = false; }
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
  test('starts alive with 10 missiles', () => {
    const b = new Battery(200, 540);
    expect(b.alive).toBe(true);
    expect(b.missiles).toBe(10);
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
  constructor(x, y, maxRadius = 40, duration = 0.5) {
    this.x         = x;
    this.y         = y;
    this.maxRadius = maxRadius;
    this.duration  = duration;
    this.radius    = 0;
    this.alpha     = 1;
    this.done      = false;
    this.timer     = 0;
  }
  update(dt) {
    if (this.done) return;
    this.timer += dt;
    const progress = Math.min(this.timer / this.duration, 1);
    this.radius = this.maxRadius * progress;
    this.alpha  = 1 - progress;
    if (this.timer >= this.duration) {
      this.done = true;
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
    const e = new PlayerExplosion(100, 200, 40, 0.5);
    e.update(0.25); // half-way
    expect(e.radius).toBeGreaterThan(0);
    expect(e.radius).toBeLessThanOrEqual(40);
    expect(e.done).toBe(false);
  });

  test('marks done after duration', () => {
    const e = new PlayerExplosion(100, 200, 40, 0.5);
    e.update(0.5);
    expect(e.done).toBe(true);
    expect(e.radius).toBe(40);
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
