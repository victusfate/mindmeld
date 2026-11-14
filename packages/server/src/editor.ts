// Which editor the browser UI links source spans to. The browser cannot know whether the backend runs in WSL (where
// a Windows editor must open the file through its remote extension), so the backend reports it in /api/status.
export interface EditorLink {
  /** URL scheme the editor registers, e.g. `vscode` or `cursor`. */
  scheme: string;
  /** VS Code remote authority when the files live in WSL (`wsl+<distro>`), else null. */
  remote: string | null;
}

export const EDITOR_SCHEMES = ['vscode', 'vscode-insiders', 'cursor', 'windsurf'] as const;
const DEFAULT_EDITOR = 'vscode';

/** MINDMELD_EDITOR picks the scheme (default vscode); `none` turns links off, e.g. in a container. */
export function editorFromEnv(env: NodeJS.ProcessEnv): EditorLink | null {
  const name = env.MINDMELD_EDITOR ?? DEFAULT_EDITOR;
  if (name === 'none') return null;
  if (!(EDITOR_SCHEMES as readonly string[]).includes(name)) {
    throw new Error(`MINDMELD_EDITOR must be one of ${[...EDITOR_SCHEMES, 'none'].join(', ')}; got ${name}`);
  }
  return { scheme: name, remote: env.WSL_DISTRO_NAME ? `wsl+${env.WSL_DISTRO_NAME}` : null };
}
