/**
 * Missile Command v2 — main.js
 * Entry point: canvas setup, starfield, terrain, state machine, game loop.
 */

import {
  EnemyMissile,
  EnemyExplosion,
  ENEMY_MISSILE_BASE_SPEED,
  ENEMY_MISSILE_SPEED_SCALE,
  ENEMY_BASE_COUNT,
  ENEMY_COUNT_SCALE,
  ENEMY_MAX_COUNT,
  ENEMY_TRAIL_LENGTH,
  getMirvChance,
} from './src/enemy.js';

import { checkCollisions } from './src/collision.js';

import {
  getScoreMultiplier,
  getBonusCitiesEarned,
  getMissileBonus,
  getCityBonus,
  BONUS_MISSILE_POINTS,
  BONUS_CITY_POINTS,
} from './src/scoring.js';

import { AudioEngine } from './src/audio.js';
import { ScreenShake } from './src/screenshake.js';
import { lerpExplosionColor } from './src/explosion-color.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CANVAS_WIDTH  = 800;
const CANVAS_HEIGHT = 600;

const GROUND_HEIGHT  = 60;   // px from bottom
const STAR_COUNT     = 150;

const BATTERY_MISSILE_COUNT = 10;   // starting missiles per battery
const PLAYER_MISSILE_SPEED  = 300;  // px/sec
const CENTER_BATTERY_SPEED_MULTIPLIER = 1.5;  // center battery fires faster
/**
 * Vertical distance from battery base-y to the apex of the triangle
 * (used both in Battery._renderAlive and Game._fireFrom to keep them in sync).
 */
const BATTERY_APEX_OFFSET = 24;

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
    this.missiles = BATTERY_MISSILE_COUNT;
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
    ctx.moveTo(this.x, this.y - BATTERY_APEX_OFFSET);  // apex
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
  constructor(startX, startY, targetX, targetY, speed = PLAYER_MISSILE_SPEED) {
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
   * Expand → hold → contract fireball lifecycle.
   * @param {number} x
   * @param {number} y
   * @param {number} maxRadius       px — max blast radius (default: 40)
   * @param {number} expandDuration  seconds — expand phase (default: 0.25)
   * @param {number} holdDuration    seconds — hold phase (default: 0.15)
   * @param {number} contractDuration seconds — contract phase (default: 0.25)
   */
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

  render(ctx) {
    if (this.done || this.radius <= 0) return;
    ctx.save();

    // Alpha: full during expand/hold, fades during contract
    const alpha = this.phase === 'contract'
      ? 1 - Math.min(this.timer / this.contractDuration, 1)
      : 1;

    // Compute lifetime progress for color interpolation
    const totalDuration = this.expandDuration + this.holdDuration + this.contractDuration;
    let elapsed = this.timer;
    if (this.phase === 'hold') elapsed += this.expandDuration;
    else if (this.phase === 'contract') elapsed += this.expandDuration + this.holdDuration;
    const t = Math.min(elapsed / totalDuration, 1);

    // Color transitions: white → yellow → orange → red over lifetime
    const coreColor = lerpExplosionColor(t * 0.5);        // core stays brighter
    const midColor  = lerpExplosionColor(t);               // mid follows full progression
    const edgeColor = lerpExplosionColor(Math.min(t + 0.3, 1)); // edge is ahead

    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
    grad.addColorStop(0,   `rgba(${coreColor.r}, ${coreColor.g}, ${coreColor.b}, ${alpha})`);
    grad.addColorStop(0.3, `rgba(${midColor.r}, ${midColor.g}, ${midColor.b}, ${alpha})`);
    grad.addColorStop(0.6, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, ${alpha})`);
    grad.addColorStop(1.0, `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Thin outer ring in edge color
    ctx.strokeStyle = `rgba(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b}, ${alpha})`;
    ctx.lineWidth = 1.5;
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

    this.level = 1;
    this.score = 0;
    this.bonusCitiesReserve = 0;   // bonus cities waiting to be deployed
    this.bonusCitiesAwarded = 0;   // how many bonus city thresholds have been crossed
    this._bonusCityFlashTimer = 0; // countdown for "BONUS CITY!" notification
    this._initLayout();

    // Player missiles & explosions
    this.playerMissiles   = [];
    this.playerExplosions = [];

    // Enemy missiles & explosions
    this.enemyMissiles   = [];
    this.enemyExplosions = [];

    // Crosshair
    this.crosshair  = new Crosshair();
    this._mouseX     = 0;
    this._mouseY     = 0;
    this._mouseReady = false;  // true once the player has moved the mouse over the canvas
    canvas.style.cursor = 'none';

    // Audio & screen shake
    this.audio = new AudioEngine();
    this.screenShake = new ScreenShake();

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

  /** (Re-)create batteries and cities in their classic slot positions. */
  _initLayout() {
    // Classic layout: 9 slots across the bottom
    // Batteries at slots 0, 3, 6 — Cities at slots 1, 2, 4, 5, 7, 8
    const slotWidth    = this.width / 9;
    const groundY      = CANVAS_HEIGHT - GROUND_HEIGHT;
    const batterySlots = [0, 3, 6];
    const citySlots    = [1, 2, 4, 5, 7, 8];

    this.batteries = batterySlots.map(i =>
      new Battery(i * slotWidth + slotWidth / 2, groundY)
    );
    this.cities = citySlots.map((i, idx) =>
      new City(i * slotWidth + slotWidth / 2, groundY, idx)
    );
  }

  _registerStates() {
    this.sm
      .register(GameState.TITLE, {
        onEnter:  () => { /* nothing extra */ },
        onUpdate: (dt) => { this.starfield.update(dt); },
      })
      .register(GameState.PLAYING, {
        onEnter:  () => {
          this._spawnEnemyWave();
          this.audio.startAmbient();
        },
        onUpdate: (dt) => {
          this.starfield.update(dt);
          this.screenShake.update(dt);

          // Update player missiles
          for (const m of this.playerMissiles) {
            m.update(dt);
            if (m.done) {
              this.playerExplosions.push(new PlayerExplosion(m.targetX, m.targetY));
              this.audio.playExplosion();
            }
          }
          this.playerMissiles = this.playerMissiles.filter(m => !m.done);

          // Update player explosions
          for (const e of this.playerExplosions) e.update(dt);
          this.playerExplosions = this.playerExplosions.filter(e => !e.done);

          // Update enemies
          this._updateEnemies(dt);

          // Bonus city flash timer
          if (this._bonusCityFlashTimer > 0) this._bonusCityFlashTimer -= dt;
        },
      })
      .register(GameState.LEVEL_END, {
        onEnter:  () => {
          this.audio.stopAmbient();
          const multiplier = getScoreMultiplier(this.level);
          const remainingMissiles = this.batteries.reduce((sum, b) => sum + (b.alive ? b.missiles : 0), 0);
          const survivingCities = this.cities.filter(c => c.alive).length;
          this._tallyMissileTotal = getMissileBonus(remainingMissiles, multiplier);
          this._tallyCityTotal = getCityBonus(survivingCities, multiplier);
          this._tallyMissileCounted = 0;
          this._tallyCityCounted = 0;
          this._tallyTimer = 0;
          this._tallyDuration = 2;  // ~2 seconds for animation
          this._tallyDone = false;
          this._levelEndPause = 0;  // 1s pause after tally before transition
        },
        onUpdate: (dt) => {
          this.starfield.update(dt);
          if (!this._tallyDone) {
            this._tallyTimer += dt;
            const progress = Math.min(this._tallyTimer / this._tallyDuration, 1);
            this._tallyMissileCounted = Math.floor(this._tallyMissileTotal * progress);
            this._tallyCityCounted = Math.floor(this._tallyCityTotal * progress);
            if (progress >= 1) {
              this._tallyMissileCounted = this._tallyMissileTotal;
              this._tallyCityCounted = this._tallyCityTotal;
              this.score += this._tallyMissileTotal + this._tallyCityTotal;
              this._checkBonusCityAward();
              this._tallyDone = true;
            }
          } else {
            this._levelEndPause += dt;
            if (this._levelEndPause >= 1) {
              this.level++;
              this._startNewLevel();
              this.sm.transition(GameState.PLAYING);
            }
          }
        },
      })
      .register(GameState.GAME_OVER, {
        onEnter:  () => { this.audio.stopAmbient(); },
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
    if (e.key === 'm' || e.key === 'M') {
      if (this.audio.isMuted) {
        this.audio.unmute();
        if (state === GameState.PLAYING) this.audio.startAmbient();
      } else {
        this.audio.mute();
      }
    }
    if (state === GameState.PLAYING && this._mouseReady) {
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
    this._mouseX     = (e.clientX - rect.left) * scaleX;
    this._mouseY     = (e.clientY - rect.top) * scaleY;
    this._mouseReady = true;
  }

  // ── Firing ────────────────────────────────────────────────────────────────

  /** Fire from a specific battery toward (targetX, targetY). */
  _fireFrom(batteryIndex, targetX, targetY) {
    if (batteryIndex < 0 || batteryIndex >= this.batteries.length) return;
    const battery = this.batteries[batteryIndex];
    if (!battery.alive || battery.missiles <= 0) return;
    battery.missiles--;
    const speed = batteryIndex === 1
      ? PLAYER_MISSILE_SPEED * CENTER_BATTERY_SPEED_MULTIPLIER
      : PLAYER_MISSILE_SPEED;
    this.playerMissiles.push(
      new PlayerMissile(battery.x, battery.y - BATTERY_APEX_OFFSET, targetX, targetY, speed)
    );
    this.audio.playLaunch();
  }

  /** Fire from the nearest available battery toward (targetX, targetY). */
  _fireNearest(targetX, targetY) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.batteries.length; i++) {
      const b = this.batteries[i];
      if (!b.alive || b.missiles <= 0) continue;
      // Horizontal-only distance is correct here: all three batteries share the
      // same Y (the ground strip), so horizontal proximity is a perfect proxy
      // for Euclidean distance between batteries.
      const d = Math.abs(b.x - targetX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best === -1) return;
    this._fireFrom(best, targetX, targetY);
  }

  // ── Enemy spawning & update ───────────────────────────────────────────────

  _spawnEnemyWave() {
    const missileCount = Math.min(ENEMY_BASE_COUNT + (this.level - 1) * ENEMY_COUNT_SCALE, ENEMY_MAX_COUNT);
    const speed = ENEMY_MISSILE_BASE_SPEED * (1 + (this.level - 1) * ENEMY_MISSILE_SPEED_SCALE);

    const aliveTargets = [
      ...this.cities.filter(c => c.alive),
      ...this.batteries.filter(b => b.alive),
    ];
    if (aliveTargets.length === 0) return;

    for (let i = 0; i < missileCount; i++) {
      const startX = 50 + Math.random() * (CANVAS_WIDTH - 100);
      const startY = 0;
      const target = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
      const isMirv = Math.random() < getMirvChance(this.level);
      let mirvAltitude = null;
      if (isMirv) {
        mirvAltitude = target.y * (0.3 + Math.random() * 0.4);
      }
      this.enemyMissiles.push(new EnemyMissile(startX, startY, target.x, target.y, speed, isMirv, mirvAltitude));
    }
  }

  _updateEnemies(dt) {
    // Update all enemy missiles
    for (const missile of this.enemyMissiles) missile.update(dt);

    // Process split and done missiles
    const newMissiles = [];
    const remaining = [];
    for (const missile of this.enemyMissiles) {
      if (missile.split) {
        // Spawn 2-3 children from the split point
        const childCount = 2 + Math.floor(Math.random() * 2); // 2 or 3
        const aliveTargets = [
          ...this.cities.filter(c => c.alive),
          ...this.batteries.filter(b => b.alive),
        ];
        // If no alive targets when MIRV splits, no children spawn — wave ends cleanly
        for (let i = 0; i < childCount && aliveTargets.length > 0; i++) {
          const target = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
          newMissiles.push(new EnemyMissile(missile.x, missile.y, target.x, target.y, missile.speed, false, null));
        }
      } else if (missile.done && !missile.intercepted) {
        // Reached target — detonate (intercepted missiles already spawned a chain explosion)
        this.enemyExplosions.push(new EnemyExplosion(missile.targetX, missile.targetY));
      } else {
        remaining.push(missile);
      }
    }
    this.enemyMissiles = remaining.concat(newMissiles);

    // Update enemy explosions
    for (const explosion of this.enemyExplosions) explosion.update(dt);
    this.enemyExplosions = this.enemyExplosions.filter(explosion => !explosion.done);

    // Collision detection
    this._checkCollisions();

    // Wave end detection
    if (this.enemyMissiles.length === 0 && this.enemyExplosions.length === 0) {
      this.sm.transition(GameState.LEVEL_END);
    }
  }

  _checkCollisions() {
    // Snapshot alive states before collision check
    const citiesAliveBefore = this.cities.map(c => c.alive);
    const batteriesAliveBefore = this.batteries.map(b => b.alive);

    const result = checkCollisions({
      playerExplosions: this.playerExplosions,
      enemyMissiles:    this.enemyMissiles,
      enemyExplosions:  this.enemyExplosions,
      cities:           this.cities,
      batteries:        this.batteries,
      score:            this.score,
      multiplier:       getScoreMultiplier(this.level),
    });
    this.score = result.score;
    this._checkBonusCityAward();

    // Detect newly destroyed cities/batteries for audio + screen shake
    let destroyed = false;
    for (let i = 0; i < this.cities.length; i++) {
      if (citiesAliveBefore[i] && !this.cities[i].alive) {
        this.audio.playCityDestruction();
        destroyed = true;
      }
    }
    for (let i = 0; i < this.batteries.length; i++) {
      if (batteriesAliveBefore[i] && !this.batteries[i].alive) {
        this.audio.playCityDestruction();
        destroyed = true;
      }
    }
    if (destroyed) {
      this.screenShake.trigger(8, 300);
    }

    if (result.gameOver) {
      this.sm.transition(GameState.GAME_OVER);
    }
  }

  _reset() {
    this.level = 1;
    this.score = 0;
    this.bonusCitiesReserve = 0;
    this.bonusCitiesAwarded = 0;
    this._bonusCityFlashTimer = 0;
    this.playerMissiles   = [];
    this.playerExplosions = [];
    this.enemyMissiles    = [];
    this.enemyExplosions  = [];
    this._initLayout();  // restore batteries (full ammo, alive) and cities (alive)
  }

  /** Check if a new bonus city threshold has been crossed and award it. */
  _checkBonusCityAward() {
    const earned = getBonusCitiesEarned(this.score);
    while (this.bonusCitiesAwarded < earned) {
      this.bonusCitiesAwarded++;
      this.bonusCitiesReserve++;
      this._bonusCityFlashTimer = 2; // show "BONUS CITY!" for 2 seconds
    }
  }

  /** Restore batteries and deploy bonus cities at the start of a new level. */
  _startNewLevel() {
    // Restore all batteries: alive, full ammo
    for (const b of this.batteries) {
      b.alive = true;
      b.missiles = BATTERY_MISSILE_COUNT;
    }
    // Deploy reserved bonus cities into destroyed city slots
    for (const city of this.cities) {
      if (!city.alive && this.bonusCitiesReserve > 0) {
        city.alive = true;
        this.bonusCitiesReserve--;
      }
    }
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt) {
    this.sm.update(dt);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    const ctx = this.ctx;

    // Screen shake: apply canvas translation
    this.screenShake.apply(ctx);

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

    // Enemy missiles and explosions
    for (const missile of this.enemyMissiles)     missile.render(ctx);
    for (const explosion of this.enemyExplosions) explosion.render(ctx);

    // HUD (score / level) when playing or level end
    const state = this.sm.current;
    if (state === GameState.PLAYING || state === GameState.LEVEL_END) {
      this._renderHUD(ctx);
    }

    // Bonus city flash
    if (this._bonusCityFlashTimer > 0) {
      const alpha = Math.min(this._bonusCityFlashTimer, 1);
      drawCenteredText(ctx, ['BONUS CITY!'], this.height / 2 - 80, this.width,
        { font: '36px monospace', fillStyle: `rgba(0, 255, 255, ${alpha})`, lineHeight: 40 });
    }

    // Overlay screens
    if (state === GameState.TITLE)     this._renderTitle(ctx);
    if (state === GameState.LEVEL_END) this._renderLevelEnd(ctx);
    if (state === GameState.GAME_OVER) this._renderGameOver(ctx);

    // Mute indicator (top-right)
    if (state === GameState.PLAYING) {
      ctx.save();
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#aaa';
      ctx.fillText(this.audio.isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A', this.width - 40, 6);
      ctx.restore();
    }

    // Crosshair (drawn last, on top of everything)
    if (state === GameState.PLAYING) {
      this.crosshair.x = this._mouseX;
      this.crosshair.y = this._mouseY;
      this.crosshair.render(ctx);
    }

    // Screen shake: restore canvas translation
    this.screenShake.reset(ctx);
  }

  _renderHUD(ctx) {
    ctx.save();
    ctx.font = '18px monospace';
    ctx.fillStyle = '#0f0';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${this.score}`, 16, 24);
    ctx.textAlign = 'center';
    const mult = getScoreMultiplier(this.level);
    ctx.fillText(`MULT: ${mult}x`, this.width / 2, 24);
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

    const mult = getScoreMultiplier(this.level);
    const lines = [`LEVEL ${this.level} COMPLETE`];
    lines.push(`MISSILE BONUS: ${this._tallyMissileCounted}`);
    lines.push(`CITY BONUS: ${this._tallyCityCounted}`);
    if (this._tallyDone) {
      lines.push(`SCORE: ${this.score}`);
    }

    drawCenteredText(ctx, lines,
      this.height / 2 - 60,
      this.width,
      { font: '28px monospace', fillStyle: '#ff0', lineHeight: 40 }
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
