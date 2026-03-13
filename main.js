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

    this.level     = 1;
    this.score     = 0;

    // Timing
    this._lastTime = null;

    // Input
    this._boundKeyDown = this._onKeyDown.bind(this);
    window.addEventListener('keydown', this._boundKeyDown);
    this._boundClick = this._onClick.bind(this);
    canvas.addEventListener('click', this._boundClick);

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
          // Future: update missiles, explosions, cities…
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
  }

  _onClick() {
    const state = this.sm.current;
    if (state === GameState.TITLE)     this.sm.transition(GameState.PLAYING);
    if (state === GameState.GAME_OVER) { this._reset(); this.sm.transition(GameState.TITLE); }
  }

  _reset() {
    this.level = 1;
    this.score = 0;
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

    // HUD (score / level) when playing or level end
    const state = this.sm.current;
    if (state === GameState.PLAYING || state === GameState.LEVEL_END) {
      this._renderHUD(ctx);
    }

    // Overlay screens
    if (state === GameState.TITLE)     this._renderTitle(ctx);
    if (state === GameState.LEVEL_END) this._renderLevelEnd(ctx);
    if (state === GameState.GAME_OVER) this._renderGameOver(ctx);
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
      { font: '56px monospace', fillStyle: '#ff4444', lineHeight: 70 }
    );
    drawCenteredText(ctx,
      ['PRESS ENTER OR CLICK TO START'],
      this.height / 2 + 30,
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
      { font: '40px monospace', fillStyle: '#ff4444', lineHeight: 56 }
    );
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

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const game   = new Game(canvas);
game.start();
