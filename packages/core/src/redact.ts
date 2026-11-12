// Redaction applied on the host to everything a sandbox returns, after the in-sandbox harness has already
// redacted by key name. Values matching credential shapes never reach storage or a model.
export const REDACTED = '[REDACTED]';
export const SECRET_KEY_PATTERN = 'pass(word|wd)?|secret|token|api[-_]?key|auth|credential|private[-_]?key|cookie|session';

// Credential shapes, written as strings so each pattern reads as one unit with its minimum length.
const VALUE_PATTERNS: RegExp[] = [
  'sk-[A-Za-z0-9_-]{16,}',                       // OpenAI/Anthropic-style keys
  'AKIA[0-9A-Z]{16}',                            // AWS access key ids
  'gh[pousr]_[A-Za-z0-9]{20,}',                  // GitHub tokens
  'xox[abprs]-[A-Za-z0-9-]{10,}',                // Slack tokens
  'eyJ[\\w-]{8,}\\.[\\w-]{8,}\\.[\\w-]{8,}',          // JWTs
  '[Bb]earer\\s+[\\w.~+/-]{8,}=*',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)',
].map(source => new RegExp(source, 'g'));
const KEY_VALUE = new RegExp(`("(?:[^"]*?(?:${SECRET_KEY_PATTERN})[^"]*?)"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi');

export function redactText(text: string): string {
  let out = text.replace(KEY_VALUE, `$1"${REDACTED}"`);
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}
