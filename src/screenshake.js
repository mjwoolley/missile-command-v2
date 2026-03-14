/**
 * src/screenshake.js — Screen shake effect via canvas translation.
 * Provides a decaying shake triggered on city/battery destruction.
 */

export class ScreenShake {
  constructor() {
    this._active = false;
    this._intensity = 0;
    this._duration = 0;
    this._elapsed = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  get active() {
    return this._active;
  }

  /**
   * Trigger a screen shake.
   * @param {number} intensity  Maximum pixel offset
   * @param {number} durationMs Duration in milliseconds
   */
  trigger(intensity, durationMs) {
    this._intensity = intensity;
    this._duration = durationMs / 1000; // convert to seconds
    this._elapsed = 0;
    this._active = true;
  }

  /**
   * Update the shake state each frame.
   * @param {number} dt  Delta time in seconds
   */
  update(dt) {
    if (!this._active) return;
    this._elapsed += dt;
    if (this._elapsed >= this._duration) {
      this._active = false;
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    // Decaying random offset
    const decay = 1 - (this._elapsed / this._duration);
    const magnitude = this._intensity * decay;
    this.offsetX = (Math.random() * 2 - 1) * magnitude;
    this.offsetY = (Math.random() * 2 - 1) * magnitude;
  }

  /**
   * Apply the shake offset to a canvas context (call before rendering).
   * @param {CanvasRenderingContext2D} ctx
   */
  apply(ctx) {
    if (!this._active) return;
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
  }

  /**
   * Reset the canvas context after rendering (call after rendering).
   * @param {CanvasRenderingContext2D} ctx
   */
  reset(ctx) {
    if (!this._active) return;
    ctx.restore();
  }
}
