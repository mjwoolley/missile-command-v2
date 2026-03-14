/**
 * src/explosion-color.js — Explosion color interpolation.
 * Maps explosion lifetime progress to a color transitioning:
 * white → yellow → orange → red
 */

/**
 * Linearly interpolate between two values.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Compute an explosion color for a given lifetime progress t (0..1).
 * t=0 → white (255,255,255)
 * t≈0.33 → yellow (255,255,0)
 * t≈0.66 → orange (255,140,0)
 * t=1 → red (255,0,0)
 *
 * @param {number} t  Progress through lifetime, 0 to 1 (clamped internally)
 * @returns {{ r: number, g: number, b: number }}
 */
export function lerpExplosionColor(t) {
  const ct = Math.max(0, Math.min(1, t));

  // Color stops: [t, r, g, b]
  const stops = [
    [0,    255, 255, 255],  // white
    [0.33, 255, 255, 0],    // yellow
    [0.66, 255, 140, 0],    // orange
    [1.0,  255, 0,   0],    // red
  ];

  // Find the two stops we're between
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, r0, g0, b0] = stops[i];
    const [t1, r1, g1, b1] = stops[i + 1];
    if (ct >= t0 && ct <= t1) {
      const local = (ct - t0) / (t1 - t0);
      return {
        r: Math.round(lerp(r0, r1, local)),
        g: Math.round(lerp(g0, g1, local)),
        b: Math.round(lerp(b0, b1, local)),
      };
    }
  }

  // Fallback (should not reach here due to clamping)
  return { r: 255, g: 0, b: 0 };
}
