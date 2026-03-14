/**
 * src/enemy.js — EnemyMissile, EnemyExplosion, and related constants.
 * DOM-free: safe to import in both main.js and unit tests.
 */

export const ENEMY_MISSILE_BASE_SPEED = 80;      // px/sec at level 1
export const ENEMY_MISSILE_SPEED_SCALE = 0.15;   // +15% per level
export const ENEMY_BASE_COUNT = 8;               // missiles at level 1
export const ENEMY_COUNT_SCALE = 2;              // +2 per level
export const ENEMY_MAX_COUNT = 20;
export const ENEMY_MIRV_CHANCE = 0.3;            // 30% base chance of missiles being MIRVs
export const ENEMY_MIRV_CHANCE_SCALE = 0.05;     // +5% per level
export const ENEMY_MIRV_CHANCE_MAX = 0.7;        // capped at 70%
export const ENEMY_TRAIL_LENGTH = 30;

/**
 * Return the MIRV chance for a given level.
 * Base 30% + 5% per level above 1, capped at 70%.
 *
 * @param {number} level — 1-based level number
 * @returns {number}
 */
export function getMirvChance(level) {
  return Math.min(ENEMY_MIRV_CHANCE + (level - 1) * ENEMY_MIRV_CHANCE_SCALE, ENEMY_MIRV_CHANCE_MAX);
}

export class EnemyMissile {
  /**
   * @param {number} startX
   * @param {number} startY
   * @param {number} targetX
   * @param {number} targetY
   * @param {number} speed    px/sec — must be positive
   * @param {boolean} isMirv  true if this missile splits at mirvAltitude
   * @param {number|null} mirvAltitude  canvas y-coordinate at which MIRV splits
   */
  constructor(startX, startY, targetX, targetY, speed, isMirv = false, mirvAltitude = null) {
    if (speed <= 0) throw new Error(`EnemyMissile speed must be positive, got ${speed}`);
    this.targetX      = targetX;
    this.targetY      = targetY;
    this.x            = startX;
    this.y            = startY;
    this.speed        = speed;
    this.isMirv       = isMirv;
    this.mirvAltitude = mirvAltitude;
    this.trail        = [];
    this.done         = false;
    this.split        = false;
    this.intercepted  = false;
  }

  update(dt) {
    if (this.done) return;

    // Record trail position
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > ENEMY_TRAIL_LENGTH) {
      this.trail.shift();
    }

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

    // MIRV split check: triggers once, then done=true prevents re-entry
    if (this.isMirv && !this.split && this.y >= this.mirvAltitude) {
      this.split = true;
      this.done  = true;
    }
  }

  render(ctx) {
    if (this.done) return;
    ctx.save();

    // Draw trail as fading line segments
    for (let i = 1; i < this.trail.length; i++) {
      const alpha = i / this.trail.length;
      ctx.strokeStyle = `rgba(255, 80, 80, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
      ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.stroke();
    }
    // Line from last trail point to current position
    if (this.trail.length > 0) {
      ctx.strokeStyle = 'rgba(255, 80, 80, 1)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.trail[this.trail.length - 1].x, this.trail[this.trail.length - 1].y);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
    }

    // Missile head
    ctx.fillStyle = this.isMirv ? '#ff8800' : '#ff3333';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.isMirv ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

export class EnemyExplosion {
  constructor(x, y, maxRadius = 35, expandDuration = 0.25, holdDuration = 0.15, contractDuration = 0.25) {
    this.x                = x;
    this.y                = y;
    this.maxRadius        = maxRadius;
    this.expandDuration   = expandDuration;
    this.holdDuration     = holdDuration;
    this.contractDuration = contractDuration;
    this.phase            = 'expand';
    this.timer            = 0;
    this.radius           = 0;
    this.done             = false;
    this.isChain          = false;
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
        this.done   = true;
      } else {
        this.radius = this.maxRadius * (1 - this.timer / this.contractDuration);
      }
    }
  }

  render(ctx) {
    if (this.done || this.radius <= 0) return;
    ctx.save();

    const alpha = this.phase === 'contract'
      ? 1 - Math.min(this.timer / this.contractDuration, 1)
      : 1;

    // Radial gradient: white core → orange → red → transparent
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
    grad.addColorStop(0,   'rgba(255, 255, 255, ' + alpha + ')');
    grad.addColorStop(0.3, 'rgba(255, 180, 50,  ' + alpha + ')');
    grad.addColorStop(0.6, 'rgba(255, 60,  0,   ' + alpha + ')');
    grad.addColorStop(1.0, 'rgba(200, 0,   0,   0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Thin red outer ring
    ctx.strokeStyle = 'rgba(255, 100, 50, ' + alpha + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
