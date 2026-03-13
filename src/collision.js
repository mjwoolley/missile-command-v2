/**
 * src/collision.js — Pure collision detection logic for MIS-8.
 * DOM-free: safe to import in both main.js and unit tests.
 */

import { EnemyExplosion } from './enemy.js';

/** Points awarded per enemy missile destroyed by a player explosion. */
export const POINTS_PER_MISSILE = 25;

/**
 * Run all collision checks for a single frame.
 *
 * @param {object} state
 * @param {Array} state.playerExplosions  — active PlayerExplosion instances
 * @param {Array} state.enemyMissiles     — active EnemyMissile instances (mutated in place)
 * @param {Array} state.enemyExplosions   — active EnemyExplosion instances (may be appended to)
 * @param {Array} state.cities            — City instances
 * @param {Array} state.batteries         — Battery instances
 * @param {number} state.score            — current score (read/write)
 * @returns {{ score: number, gameOver: boolean }}
 */
export function checkCollisions(state) {
  const { playerExplosions, enemyMissiles, enemyExplosions, cities, batteries } = state;
  let score = state.score;

  // 1. Player explosions vs enemy missiles
  const newChainExplosions = [];
  for (const missile of enemyMissiles) {
    // missile.split is always set with missile.done; check done only
    if (missile.done) continue;
    for (const explosion of playerExplosions) {
      if (explosion.done || explosion.radius <= 0) continue;
      const dx = missile.x - explosion.x;
      const dy = missile.y - explosion.y;
      if (dx * dx + dy * dy <= explosion.radius * explosion.radius) {
        missile.done = true;
        missile.intercepted = true;
        score += POINTS_PER_MISSILE;
        const chainExplosion = new EnemyExplosion(missile.x, missile.y);
        chainExplosion.isChain = true;
        newChainExplosions.push(chainExplosion);
        break;
      }
    }
  }

  // 2. Chain-reaction: all active enemy explosions vs enemy missiles
  //    (Both chain and ground detonations can chain-kill missiles; isChain only gates city/battery destruction in section 3)
  for (const explosion of enemyExplosions) {
    if (explosion.done || explosion.radius <= 0) continue;
    for (const missile of enemyMissiles) {
      // missile.split is always set with missile.done; check done only
      if (missile.done) continue;
      const dx = missile.x - explosion.x;
      const dy = missile.y - explosion.y;
      if (dx * dx + dy * dy <= explosion.radius * explosion.radius) {
        missile.done = true;
        missile.intercepted = true;
        score += POINTS_PER_MISSILE;
        const chainExplosion = new EnemyExplosion(missile.x, missile.y);
        chainExplosion.isChain = true;
        newChainExplosions.push(chainExplosion);
      }
    }
  }

  // NOTE: newChainExplosions from section 1 are added AFTER section 2 runs intentionally.
  // This prevents same-frame infinite cascade: new chains only resolve from the next frame onward.

  // Add chain explosions to the main array
  for (const ce of newChainExplosions) {
    enemyExplosions.push(ce);
  }

  // 3. Enemy ground explosions (non-chain) vs cities/batteries
  for (const explosion of enemyExplosions) {
    if (explosion.done || explosion.radius <= 0 || explosion.isChain) continue;
    for (const city of cities) {
      if (!city.alive) continue;
      const dx = city.x - explosion.x;
      const dy = city.y - explosion.y;
      if (dx * dx + dy * dy <= explosion.radius * explosion.radius) {
        city.destroy();
      }
    }
    for (const battery of batteries) {
      if (!battery.alive) continue;
      const dx = battery.x - explosion.x;
      const dy = battery.y - explosion.y;
      if (dx * dx + dy * dy <= explosion.radius * explosion.radius) {
        battery.destroy();
      }
    }
  }

  // 4. Game over: all cities destroyed
  const gameOver = cities.length > 0 && cities.every(c => !c.alive);

  return { score, gameOver };
}
