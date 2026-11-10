# combat-game fixture

A small, dependency-free TypeScript repository used by Mind Meld Studio's tests and guided demo.
It is treated as **untrusted** input like any other studied repository.

- `src/game.ts` — `playTurn` entry point (allowlist it in Studio, then run it).
- `src/combat.ts` — `attack` → `computeDamage`; `legacyCritical` is reachable statically but only on a
  path the demo inputs never take (a misleading call site: static ≠ observed).
- `src/save.ts` — in-memory save boundary (`MemorySave.write`).
- `src/account.ts` — receives a password so redaction can be checked.
- `src/notes.ts` — contains a prompt-injection string so the Q&A abstention can be checked.
