/**
 * src/gamestate.js — Pure game-state predicates for MIS-10.
 * DOM-free: safe to import in both main.js and unit tests.
 */

/**
 * Returns true if game over should be triggered.
 * Faithful to original Missile Command: game ends only when all cities are
 * destroyed AND there are no bonus cities in reserve to deploy at the next
 * wave.
 *
 * @param {Array<{alive: boolean}>} cities — City instances
 * @param {number} bonusCitiesReserve — cities waiting to be deployed
 * @returns {boolean}
 */
export function shouldTriggerGameOver(cities, bonusCitiesReserve) {
  if (cities.length === 0) return false;
  return cities.every(c => !c.alive) && bonusCitiesReserve === 0;
}

/**
 * Load the persisted high score.
 * Returns 0 on any error (private browsing, no prior entry, etc.).
 *
 * @param {Storage} storage — e.g. localStorage or a mock
 * @returns {number}
 */
export function loadHighScore(storage) {
  try {
    const val = storage.getItem('missileCommandHighScore');
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

/**
 * Persist the high score if score > currentHigh.
 * Returns the new high score (unchanged if score didn't beat it).
 *
 * @param {number} score
 * @param {number} currentHigh
 * @param {Storage} storage — e.g. localStorage or a mock
 * @returns {number}
 */
export function updateHighScore(score, currentHigh, storage) {
  const newHigh = Math.max(score, currentHigh);
  try {
    storage.setItem('missileCommandHighScore', String(newHigh));
  } catch {
    // Silently fail (storage full, private browsing, etc.)
  }
  return newHigh;
}
