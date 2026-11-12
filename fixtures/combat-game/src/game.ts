import { attack } from './combat.ts';
import type { Fighter } from './damage.ts';
import { MemorySave } from './save.ts';

export interface TurnResult { defender: Fighter; defeated: boolean; savedBytes: number }

const save = new MemorySave();

/** Entry point: one attack, then persist the defender to the in-memory save. */
export function playTurn(attacker: Fighter, defender: Fighter): TurnResult {
  if (attacker.hp <= 0) throw new Error(`${attacker.name} cannot act at 0 hp`);
  const next = attack(attacker, defender);
  const savedBytes = save.write(next.name, next);
  return { defender: next, defeated: next.hp === 0, savedBytes };
}

export async function playTurnLater(attacker: Fighter, defender: Fighter): Promise<TurnResult> {
  await Promise.resolve();
  return playTurn(attacker, defender);
}
