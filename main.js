/**
 * Missile Command v2 — main.js
 * Entry point: canvas setup, starfield, terrain, state machine, game loop.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const CANVAS_WIDTH  = 800;
const CANVAS_HEIGHT = 600;

const GROUND_HEIGHT  = 60;   // px from bottom
const STAR_COUNT     = 150;

// ─── Game State Machine ───────────────────────────────────────────────────────

/**
 * All valid states.
 * Transitions: TITLE → PLAYING → LEVEL_END → PLAYING (next level)
 *                                           → GAME_OVER → TITLE
 */
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
  }

  /** Register enter/update/exit handlers for a state. */
  register(state, { onEnter = null, onUpdate = null, onExit = null } = {}) {
    this._handlers[state] = { onEnter, onUpdate, onExit };
    return this;
  }

  get current() {
    return this._state;
  }

  /** Transition to a new state, calling exit/enter hooks. */
  transition(next) {
    if (next === this._state) return;
    const h = this._handlers[this._state];
    if (h?.onExit) h.onExit();
    this._state = next;
    const nh = this._handlers[next];
    if (nh?.onEnter) nh.onEnter();
  }

  /** Fire onEnter for the initial state. Call once after all states are registered. */
  start() {
    const h = this._handlers[this._state];
    if (h?.onEnter) h.onEnter();
  }

  /** Delegate update to the current state's handler. */
  update(dt) {
    const h = this._handlers[this._state];
    if (h?.onUpdate) h.onUpdate(dt);
  }
}

// ─── Starfield ────────────────────────────────────────────────────────────────

class Starfield {
  constructor(count, width, height) {
    this.stars = Array.from({ length: count }, () => ({
      x:         Math.random() * width,
      y:         Math.random() * (height - GROUND_HEIGHT),
      radius:    Math.random() * 1.2 + 0.3,
      alpha:     Math.random() * 0.5 + 0.5,
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

  render(ctx) {
    for (const s of this.stars) {
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ─── Terrain ──────────────────────────────────────────────────────────────────

class Terrain {
  /**
   * Build a jagged ground strip along the bottom of the canvas.
   * The strip starts at y = (height - GROUND_HEIGHT) and has small
   * irregular bumps for visual interest.
   */
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
      const x = i * segmentWidth;
      // Small bumps: ±8 px from baseY
      const y = this.baseY + (Math.random() * 16 - 8);
      pts.push({ x, y });
    }
    // Ensure start and end are exactly at baseY for clean edges
    pts[0].y = this.baseY;
    pts[pts.length - 1].y = this.baseY;
    return pts;
  }

  render(ctx) {
    ctx.save();
    ctx.fillStyle = '#1a3a1a';   // dark green
    ctx.strokeStyle = '#2d6e2d';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(0, this.height);  // bottom-left
    for (const p of this.points) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(this.width, this.height);  // bottom-right
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ─── City ────────────────────────────────────────────────────────────────────

const CITY_COLORS = ['#00ffff', '#ffff00', '#ff00ff', '#00ff00', '#ff8800', '#88ff88'];

class City {
  constructor(x, y, colorIndex) {
    this.x = x;
    this.y = y;
    this.alive = true;
    this.color = CITY_COLORS[colorIndex % CITY_COLORS.length];
  }

  destroy() {
    this.alive = false;
  }

  render(ctx) {
    if (this.alive) {
      this._renderAlive(ctx);
    } else {
      this._renderDestroyed(ctx);
    }
  }

  _renderAlive(ctx) {
    ctx.save();
    ctx.fillStyle = this.color;
    // Three buildings of varying height, sitting on the ground (base at this.y)
    ctx.fillRect(this.x - 15, this.y - 28, 8, 28);
    ctx.fillRect(this.x - 5,  this.y - 38, 10, 38);
    ctx.fillRect(this.x + 7,  this.y - 22, 8, 22);
    // Window dots
    ctx.fillStyle = '#000';
    ctx.fillRect(this.x - 12, this.y - 22, 2, 2);
    ctx.fillRect(this.x - 12, this.y - 16, 2, 2);
    ctx.fillRect(this.x - 1,  this.y - 30, 2, 2);
    ctx.fillRect(this.x - 1,  this.y - 22, 2, 2);
    ctx.fillRect(this.x + 10, this.y - 16, 2, 2);
    ctx.restore();
  }

  _renderDestroyed(ctx) {
    ctx.save();
    ctx.fillStyle = '#444';
    // Rubble: small irregular shapes
    ctx.fillRect(this.x - 14, this.y - 4, 6, 4);
    ctx.fillRect(this.x - 6,  this.y - 6, 8, 6);
    ctx.fillRect(this.x + 4,  this.y - 3, 7, 3);
    ctx.fillRect(this.x - 2,  this.y - 2, 3, 2);
    ctx.restore();
  }
}

// ─── Battery ─────────────────────────────────────────────────────────────────

class Battery {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.missiles = 10;
    this.alive = true;
  }

  destroy() {
    this.alive = false;
  }

  render(ctx) {
    if (this.alive) {
      this._renderAlive(ctx);
    } else {
      this._renderDestroyed(ctx);
    }
  }

  _renderAlive(ctx) {
    ctx.save();
    // Dome / triangle pointing up
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 24);      // apex
    ctx.lineTo(this.x - 18, this.y);       // bottom-left
    ctx.lineTo(this.x + 18, this.y);       // bottom-right
    ctx.closePath();
    ctx.fill();
    // Missile count text below
    ctx.font = '12px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(this.missiles), this.x, this.y + 4);
    ctx.restore();
  }

  _renderDestroyed(ctx) {
    ctx.save();
    ctx.fillStyle = '#555';
    ctx.fillRect(this.x - 16, this.y - 4, 32, 4);
    ctx.restore();
  }
}

// ─── Crosshair ───────────────────────────────────────────────────────────────

class Crosshair {
  constructor() {
    this.x = 0;
    this.y = 0;
  }

  /** Draw a crosshair: two crossed lines + a small center circle. */
  render(ctx) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(this.x - 20, this.y);
    ctx.lineTo(this.x + 20, this.y);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 20);
    ctx.lineTo(this.x, this.y + 20);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}

// ─── PlayerMissile ───────────────────────────────────────────────────────────

class PlayerMissile {
  /**
   * @param {number} startX
   * @param {number} startY
   * @param {number} targetX
   * @param {number} targetY
   * @param {number} speed  px/sec
   */
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

  render(ctx) {
    ctx.save();
    ctx.strokeStyle = '#88ff88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.startX, this.startY);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── PlayerExplosion ─────────────────────────────────────────────────────────

class PlayerExplosion {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} maxRadius
   * @param {number} duration  seconds
   */
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

  render(ctx) {
    if (this.done) return;
    ctx.save();
    ctx.strokeStyle = `rgba(255,200,100,${this.alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Overlay helpers ──────────────────────────────────────────────────────────

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

// ─── Game ─────────────────────────────────────────────────────────────────────

class Game {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.width   = CANVAS_WIDTH;
    this.height  = CANVAS_HEIGHT;

    this.starfield = new Starfield(STAR_COUNT, this.width, this.height);
    this.terrain   = new Terrain(this.width, this.height);

    // Classic layout: 9 slots across the bottom
    // Batteries at slots 0, 3, 6 — Cities at slots 1, 2, 4, 5, 7, 8
    const slotWidth = this.width / 9;
    const groundY = CANVAS_HEIGHT - GROUND_HEIGHT;
    const batterySlots = [0, 3, 6];
    const citySlots    = [1, 2, 4, 5, 7, 8];

    this.batteries = batterySlots.map(i =>
      new Battery(i * slotWidth + slotWidth / 2, groundY)
    );
    this.cities = citySlots.map((i, idx) =>
      new City(i * slotWidth + slotWidth / 2, groundY, idx)
    );

    this.level     = 1;
    this.score     = 0;

    // Player missiles & explosions
    this.playerMissiles   = [];
    this.playerExplosions = [];

    // Crosshair
    this.crosshair = new Crosshair();
    this._mouseX = 0;
    this._mouseY = 0;
    canvas.style.cursor = 'none';

    // Timing
    this._lastTime = null;

    // Input
    this._boundKeyDown = this._onKeyDown.bind(this);
    window.addEventListener('keydown', this._boundKeyDown);
    this._boundClick = this._onClick.bind(this);
    canvas.addEventListener('click', this._boundClick);
    this._boundMouseMove = this._onMouseMove.bind(this);
    canvas.addEventListener('mousemove', this._boundMouseMove);

    // State machine
    this.sm = new StateMachine(GameState.TITLE);
    this._registerStates();
    this.sm.start();
  }

  _registerStates() {
    this.sm
      .register(GameState.TITLE, {
        onEnter:  () => { /* nothing extra */ },
        onUpdate: (dt) => { this.starfield.update(dt); },
      })
      .register(GameState.PLAYING, {
        onEnter:  () => { /* spawn enemies etc. in future stories */ },
        onUpdate: (dt) => {
          this.starfield.update(dt);

          // Update player missiles
          for (const m of this.playerMissiles) {
            m.update(dt);
            if (m.done) {
              this.playerExplosions.push(new PlayerExplosion(m.targetX, m.targetY));
            }
          }
          this.playerMissiles = this.playerMissiles.filter(m => !m.done);

          // Update player explosions
          for (const e of this.playerExplosions) e.update(dt);
          this.playerExplosions = this.playerExplosions.filter(e => !e.done);
        },
      })
      .register(GameState.LEVEL_END, {
        onEnter:  () => { this._levelEndTimer = 3; },
        onUpdate: (dt) => {
          this.starfield.update(dt);
          this._levelEndTimer -= dt;
          if (this._levelEndTimer <= 0) {
            this.level++;
            this.sm.transition(GameState.PLAYING);
          }
        },
      })
      .register(GameState.GAME_OVER, {
        onEnter:  () => { /* show score, wait for input */ },
        onUpdate: (dt) => { this.starfield.update(dt); },
      });
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    const state = this.sm.current;
    if (e.key === 'Enter' || e.key === ' ') {
      if (state === GameState.TITLE)     this.sm.transition(GameState.PLAYING);
      if (state === GameState.GAME_OVER) { this._reset(); this.sm.transition(GameState.TITLE); }
    }
    if (state === GameState.PLAYING) {
      if (e.key === '1') this._fireFrom(0, this._mouseX, this._mouseY);
      if (e.key === '2') this._fireFrom(1, this._mouseX, this._mouseY);
      if (e.key === '3') this._fireFrom(2, this._mouseX, this._mouseY);
    }
  }

  _onClick(e) {
    const state = this.sm.current;
    if (state === GameState.TITLE)     this.sm.transition(GameState.PLAYING);
    if (state === GameState.GAME_OVER) { this._reset(); this.sm.transition(GameState.TITLE); }
    if (state === GameState.PLAYING) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      this._fireNearest(canvasX, canvasY);
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this._mouseX = (e.clientX - rect.left) * scaleX;
    this._mouseY = (e.clientY - rect.top) * scaleY;
  }

  // ── Firing ────────────────────────────────────────────────────────────────

  /** Fire from a specific battery toward (targetX, targetY). */
  _fireFrom(batteryIndex, targetX, targetY) {
    if (batteryIndex < 0 || batteryIndex >= this.batteries.length) return;
    const battery = this.batteries[batteryIndex];
    if (!battery.alive || battery.missiles <= 0) return;
    battery.missiles--;
    this.playerMissiles.push(
      new PlayerMissile(battery.x, battery.y - 24, targetX, targetY)
    );
  }

  /** Fire from the nearest available battery toward (targetX, targetY). */
  _fireNearest(targetX, targetY) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.batteries.length; i++) {
      const b = this.batteries[i];
      if (!b.alive || b.missiles <= 0) continue;
      const d = Math.abs(b.x - targetX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best === -1) return;
    this._fireFrom(best, targetX, targetY);
  }

  _reset() {
    this.level = 1;
    this.score = 0;
    this.playerMissiles   = [];
    this.playerExplosions = [];
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt) {
    this.sm.update(dt);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    const ctx = this.ctx;

    // Black sky
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);

    // Stars
    this.starfield.render(ctx);

    // Terrain
    this.terrain.render(ctx);

    // Cities and batteries
    for (const city of this.cities)       city.render(ctx);
    for (const battery of this.batteries) battery.render(ctx);

    // Player missiles and explosions
    for (const m of this.playerMissiles)   m.render(ctx);
    for (const e of this.playerExplosions) e.render(ctx);

    // HUD (score / level) when playing or level end
    const state = this.sm.current;
    if (state === GameState.PLAYING || state === GameState.LEVEL_END) {
      this._renderHUD(ctx);
    }

    // Overlay screens
    if (state === GameState.TITLE)     this._renderTitle(ctx);
    if (state === GameState.LEVEL_END) this._renderLevelEnd(ctx);
    if (state === GameState.GAME_OVER) this._renderGameOver(ctx);

    // Crosshair (drawn last, on top of everything)
    if (state === GameState.PLAYING) {
      this.crosshair.x = this._mouseX;
      this.crosshair.y = this._mouseY;
      this.crosshair.render(ctx);
    }
  }

  _renderHUD(ctx) {
    ctx.save();
    ctx.font = '18px monospace';
    ctx.fillStyle = '#0f0';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${this.score}`, 16, 24);
    ctx.textAlign = 'right';
    ctx.fillText(`LEVEL: ${this.level}`, this.width - 16, 24);
    ctx.restore();
  }

  _renderTitle(ctx) {
    // Semi-transparent backdrop
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();

    drawCenteredText(ctx,
      ['MISSILE COMMAND'],
      this.height / 2 - 60,
      this.width,
      { font: '56px monospace', fillStyle: '#ff4444', lineHeight: 70 }
    );
    drawCenteredText(ctx,
      ['PRESS ENTER OR CLICK TO START'],
      this.height / 2 + 30,
      this.width,
      { font: '20px monospace', fillStyle: '#aaa', lineHeight: 30 }
    );
  }

  _renderLevelEnd(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();

    drawCenteredText(ctx,
      [`LEVEL ${this.level} COMPLETE`, `SCORE: ${this.score}`],
      this.height / 2 - 40,
      this.width,
      { font: '36px monospace', fillStyle: '#ff0', lineHeight: 50 }
    );
  }

  _renderGameOver(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();

    drawCenteredText(ctx,
      ['GAME OVER', `FINAL SCORE: ${this.score}`, 'PRESS ENTER / SPACE OR CLICK TO RESTART'],
      this.height / 2 - 60,
      this.width,
      { font: '40px monospace', fillStyle: '#ff4444', lineHeight: 56 }
    );
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  /** Remove event listeners and cancel the animation loop. */
  destroy() {
    window.removeEventListener('keydown', this._boundKeyDown);
    this.canvas.removeEventListener('click', this._boundClick);
    this.canvas.removeEventListener('mousemove', this._boundMouseMove);
    this.canvas.style.cursor = '';
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  /** Start the requestAnimationFrame loop. */
  start() {
    const loop = (timestamp) => {
      if (this._lastTime === null) this._lastTime = timestamp;
      // Delta-time in seconds, capped at 100 ms to avoid spiral of death
      const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1);
      this._lastTime = timestamp;

      this.update(dt);
      this.render();

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const game   = new Game(canvas);
game.start();
