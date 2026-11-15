// Links a source span into the user's editor (VS Code and its forks register a URL scheme that opens
// `<scheme>://file/<abs path>:<line>`; a WSL workspace opens through `<scheme>://vscode-remote/wsl+<distro>/…`).
import type { EditorLink, Project } from '@mindmeld/client';

/** Display names for the server's EDITOR_SCHEMES (packages/server/src/editor.ts); others show the raw scheme. */
const NAMES: Record<string, string> = { vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf' };

export interface SpanLink { href: string; label: string }

/** Absolute, `/`-separated and percent-encoded per segment; a Windows drive (`C:`) keeps its colon. */
function encodedPath(root: string, file: string): string {
  const path = `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/${file}`;
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return absolute.split('/').map(seg => encodeURIComponent(seg).replace(/^([A-Za-z])%3A$/, '$1:')).join('/');
}

/** UNC roots (`\\server\share`) have no reliable editor URL form, so they get no link. */
const isUnc = (root: string): boolean => /^(\\\\|\/\/)/.test(root);

/** Only local projects link: a git source's root is Studio's private clone, not the user's checkout. */
export function editorLink(editor: EditorLink | null, project: Project | null, file: string, line: number): SpanLink | null {
  if (!editor || project?.sourceKind !== 'local' || isUnc(project.root)) return null;
  const path = encodedPath(project.root, file);
  const href = editor.remote ? `${editor.scheme}://vscode-remote/${editor.remote}${path}:${line}` : `${editor.scheme}://file${path}:${line}`;
  return { href, label: `Open in ${NAMES[editor.scheme] ?? editor.scheme}` };
}
