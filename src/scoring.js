/**
 * src/scoring.js — Pure scoring logic for Missile Command.
 * DOM-free: safe to import in both main.js and unit tests.
 */

/** Base points per remaining missile in end-of-level bonus. */
export const BONUS_MISSILE_POINTS = 5;

/** Base points per surviving city in end-of-level bonus. */
export const BONUS_CITY_POINTS = 100;

/** Points threshold for earning a bonus city. */
export const BONUS_CITY_THRESHOLD = 10000;

/**
 * Return the scoring multiplier for a given level.
 * Starts at 1x, increases by 1x every 2 levels, capped at 6x.
 *   Level 1-2 → 1x, 3-4 → 2x, 5-6 → 3x, … 11+ → 6x
 *
 * @param {number} level — 1-based level number
 * @returns {number}
 */
export function getScoreMultiplier(level) {
  return Math.min(Math.floor((level + 1) / 2), 6);
}

/**
 * Calculate how many total bonus cities have been earned at a given score.
 * One bonus city per 10,000 points.
 *
 * @param {number} score
 * @returns {number}
 */
export function getBonusCitiesEarned(score) {
  return Math.floor(score / BONUS_CITY_THRESHOLD);
}

/**
 * Calculate end-of-level bonus for remaining missiles.
 * @param {number} remainingMissiles — total remaining across all batteries
 * @param {number} multiplier
 * @returns {number}
 */
export function getMissileBonus(remainingMissiles, multiplier) {
  return remainingMissiles * BONUS_MISSILE_POINTS * multiplier;
}

/**
 * Calculate end-of-level bonus for surviving cities.
 * @param {number} survivingCities
 * @param {number} multiplier
 * @returns {number}
 */
export function getCityBonus(survivingCities, multiplier) {
  return survivingCities * BONUS_CITY_POINTS * multiplier;
}
