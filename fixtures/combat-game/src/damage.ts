export interface Fighter { name: string; hp: number; attack: number; armor: number }

/** Pure damage rule: attack minus armor, never below one. */
export function computeDamage(attack: number, armor: number): number {
  return Math.max(1, attack - armor);
}

export const clampHp = (hp: number): number => Math.max(0, hp);
