// Run-input validation: the sandbox takes a JSON array of positional arguments.
export const MAX_INPUT_BYTES = 100_000;

export type InputCheck = { ok: true; value: unknown[] } | { ok: false; error: string };

export function checkInputs(text: string): InputCheck {
  let value: unknown;
  try { value = JSON.parse(text); } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(value)) return { ok: false, error: 'Inputs must be a JSON array of arguments, e.g. [1, "two"].' };
  if (text.length > MAX_INPUT_BYTES) return { ok: false, error: 'Inputs are larger than 100 KB.' };
  return { ok: true, value };
}

/** A starting template with one `null` per declared parameter. */
export const inputTemplate = (params: string[]): string => JSON.stringify(params.map(() => null));
