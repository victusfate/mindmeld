// Two-state colour-scheme toggle: follow the system, or pin the opposite of it. The override lives in the
// `<meta name="color-scheme">` content, which the stylesheet maps back onto `color-scheme` (CSS works without JS).
const KEY = 'color-scheme';
const DARK = '(prefers-color-scheme: dark)';
type Scheme = 'light' | 'dark';

function meta(): HTMLMetaElement | null { return document.querySelector('meta[name="color-scheme"]'); }

function stored(): Scheme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

const system = (): Scheme => (matchMedia(DARK).matches ? 'dark' : 'light');
export const renderedScheme = (): Scheme => stored() ?? system();

export function applyStoredScheme(): void {
  const m = meta();
  if (m) m.content = stored() ?? 'light dark';
}

/** Flip what is on screen; flipping back to the system's own scheme clears the override instead of pinning it. */
export function toggleScheme(): Scheme {
  const target: Scheme = renderedScheme() === 'dark' ? 'light' : 'dark';
  try {
    if (target === system()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, target);
  } catch { /* storage blocked: the change still applies to this page */ }
  const m = meta();
  if (m) m.content = target === system() ? 'light dark' : target;
  return target;
}

export function watchScheme(onChange: () => void): () => void {
  const mq = matchMedia(DARK);
  const sync = (): void => { applyStoredScheme(); onChange(); };
  mq.addEventListener('change', sync);
  addEventListener('storage', sync);
  return () => { mq.removeEventListener('change', sync); removeEventListener('storage', sync); };
}
