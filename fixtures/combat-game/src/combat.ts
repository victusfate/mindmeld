import { clampHp, computeDamage, type Fighter } from './damage.ts';

const CRITICAL_ATTACK = 100;

/** Only reachable when the attacker's attack is at least 100: the demo inputs never take this path. */
export function legacyCritical(amount: number): number {
  return amount * 3;
}

export function attack(attacker: Fighter, defender: Fighter): Fighter {
  let amount = computeDamage(attacker.attack, defender.armor);
  if (attacker.attack >= CRITICAL_ATTACK) amount = legacyCritical(amount);
  if (amount < 0) throw new Error('negative damage');
  return { ...defender, hp: clampHp(defender.hp - amount) };
}
