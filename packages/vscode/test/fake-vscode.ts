// A small in-repo stand-in for the `vscode` API, enough to run activate() and drive commands, trees and
// CodeLens from node:test. The VS Code download is unavailable here, so @vscode/test-electron cannot run.
// Tests script user input through `fake` (queued input-box answers and quick-pick choosers) and read back
// what the extension showed (messages, panels, documents, status bar, decorations).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Listener<T> = (value: T) => unknown;
export interface Disposable { dispose(): void }
const disposable = (): Disposable => ({ dispose() { /* nothing to release */ } });

export class EventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  event = (fn: Listener<T>): Disposable => { this.listeners.add(fn); return { dispose: () => { this.listeners.delete(fn); } }; };
  fire(value: T): void { for (const fn of this.listeners) fn(value); }
  dispose(): void { this.listeners.clear(); }
}

export class Position {
  line: number; character: number;
  constructor(line: number, character: number) { this.line = line; this.character = character; }
}
export class Range {
  start: Position; end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    this.start = typeof a === 'number' ? new Position(a, b as number) : a;
    this.end = typeof a === 'number' ? new Position(c ?? 0, d ?? 0) : (b as Position);
  }
}
export class Selection extends Range {
  active: Position;
  constructor(anchor: Position, active: Position) { super(anchor, active); this.active = active; }
}

export class Uri {
  readonly scheme: string; readonly fsPath: string; readonly path: string;
  constructor(scheme: string, path: string) { this.scheme = scheme; this.fsPath = path; this.path = path; }
  static file(path: string): Uri { return new Uri('file', path); }
  static parse(text: string): Uri { return new Uri(text.split(':')[0], text); }
  static joinPath(base: Uri, ...parts: string[]): Uri { return new Uri(base.scheme, join(base.fsPath, ...parts)); }
  toString(): string { return this.scheme === 'file' ? `file://${this.fsPath}` : this.path; }
}

export class ThemeIcon { id: string; constructor(id: string) { this.id = id; } }
export class ThemeColor { id: string; constructor(id: string) { this.id = id; } }
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export class TreeItem {
  label: string; collapsibleState: number;
  description?: string; tooltip?: string; iconPath?: ThemeIcon; command?: { command: string; title: string; arguments?: unknown[] };
  constructor(label: string, state = TreeItemCollapsibleState.None as number) { this.label = label; this.collapsibleState = state; }
}
export class CodeLens {
  range: Range; command?: { title: string; command: string; arguments?: unknown[]; tooltip?: string };
  constructor(range: Range, command?: CodeLens['command']) { this.range = range; this.command = command; }
}
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 } as const;
export const ViewColumn = { Active: -1, Beside: -2, One: 1 } as const;
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export interface FakeDocument { uri: Uri; languageId: string; getText(): string }
export interface FakeEditor {
  document: FakeDocument; selection: Selection; decorations: { range: Range; hoverMessage?: string }[];
  revealRange(range: Range): void; setDecorations(type: unknown, items: { range: Range; hoverMessage?: string }[]): void;
}
export interface FakePanel { title: string; webview: { html: string; cspSource: string; onDidReceiveMessage(fn: Listener<unknown>): Disposable }; post(message: unknown): void }
export interface TreeProvider { getChildren(node?: unknown): unknown; getTreeItem(node: unknown): TreeItem }
export interface LensProvider { provideCodeLenses(doc: FakeDocument): CodeLens[] }
type Chooser = (items: { label: string; description?: string }[]) => unknown;
type InputOptions = { validateInput?: (text: string) => string | null | Promise<string | null> };

export const fake = {
  inputs: [] as string[],
  picks: [] as Chooser[],
  messages: [] as { level: 'info' | 'warning' | 'error'; text: string }[],
  validation: [] as (string | null)[],
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  trees: new Map<string, TreeProvider>(),
  lensProviders: [] as LensProvider[],
  panels: [] as FakePanel[],
  documents: [] as FakeDocument[],
  statusBar: { text: '', tooltip: '' as unknown, command: '' as unknown, show() { /* visible */ }, dispose() { /* gone */ } },
  config: new Map<string, unknown>(),
  saveTarget: undefined as Uri | undefined,
  clipboard: '',
  opened: [] as string[],
  activeEditor: undefined as FakeEditor | undefined,
  messageChoice: undefined as string | undefined,
  folder: undefined as Uri | undefined,
};

function document(uri: Uri, text: string, languageId: string): FakeDocument {
  const doc = { uri, languageId, getText: () => text };
  fake.documents.push(doc);
  return doc;
}

function editorFor(doc: FakeDocument): FakeEditor {
  const editor: FakeEditor = {
    document: doc, selection: new Selection(new Position(0, 0), new Position(0, 0)), decorations: [],
    revealRange() { /* scrolled */ }, setDecorations(_type, items) { editor.decorations = items; },
  };
  fake.activeEditor = editor;
  return editor;
}

async function showInputBox(options: InputOptions = {}): Promise<string | undefined> {
  const value = fake.inputs.shift();
  if (value !== undefined && options.validateInput) {
    const problem = await options.validateInput(value);
    fake.validation.push(problem);
    if (problem) return undefined;
  }
  return value;
}

function message(level: 'info' | 'warning' | 'error') {
  return (text: string): Promise<string | undefined> => { fake.messages.push({ level, text }); return Promise.resolve(level === 'info' ? fake.messageChoice : undefined); };
}

export const window = {
  get activeTextEditor() { return fake.activeEditor; },
  showInputBox,
  showQuickPick: (items: { label: string }[]) => Promise.resolve(fake.picks.shift()?.(items)),
  showInformationMessage: message('info'),
  showWarningMessage: message('warning'),
  showErrorMessage: message('error'),
  showSaveDialog: () => Promise.resolve(fake.saveTarget),
  registerTreeDataProvider: (id: string, provider: TreeProvider) => { fake.trees.set(id, provider); return disposable(); },
  createStatusBarItem: () => fake.statusBar,
  createTextEditorDecorationType: () => disposable(),
  showTextDocument: (doc: FakeDocument) => Promise.resolve(editorFor(doc)),
  createWebviewPanel: (_type: string, title: string): FakePanel => {
    const emitter = new EventEmitter<unknown>();
    const panel: FakePanel = { title, webview: { html: '', cspSource: 'fake-csp', onDidReceiveMessage: fn => emitter.event(fn) }, post: m => emitter.fire(m) };
    fake.panels.push(panel);
    return panel;
  },
};

export const workspace = {
  get workspaceFolders() { return fake.folder ? [{ uri: fake.folder, name: 'fixture', index: 0 }] : undefined; },
  getConfiguration: () => ({
    get: (key: string) => fake.config.get(key),
    update: (key: string, value: unknown) => { fake.config.set(key, value); return Promise.resolve(); },
  }),
  openTextDocument: (target: Uri | { content: string; language?: string }) => Promise.resolve(target instanceof Uri
    ? document(target, readFileSync(target.fsPath, 'utf8'), 'typescript')
    : document(new Uri('untitled', `Untitled-${fake.documents.length}`), target.content, target.language ?? 'plaintext')),
  onDidChangeTextDocument: () => disposable(),
  fs: { writeFile: (uri: Uri, bytes: Uint8Array) => { writeFileSync(uri.fsPath, bytes); return Promise.resolve(); } },
};

export const languages = {
  registerCodeLensProvider: (_selector: unknown, provider: LensProvider) => { fake.lensProviders.push(provider); return disposable(); },
};

export const commands = {
  registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => { fake.commands.set(id, fn); return { dispose: () => fake.commands.delete(id) }; },
  executeCommand: (id: string, ...args: unknown[]) => Promise.resolve(fake.commands.get(id)?.(...args)),
};

export const env = {
  clipboard: { writeText: (text: string) => { fake.clipboard = text; return Promise.resolve(); } },
  openExternal: (uri: Uri) => { fake.opened.push(uri.toString()); return Promise.resolve(true); },
};

/** An ExtensionContext with in-memory secret storage and workspace state. */
export function fakeContext() {
  const secrets = new Map<string, string>();
  const state = new Map<string, unknown>();
  return {
    subscriptions: [] as Disposable[],
    secrets: { get: (k: string) => Promise.resolve(secrets.get(k)), store: (k: string, v: string) => { secrets.set(k, v); return Promise.resolve(); }, delete: (k: string) => { secrets.delete(k); return Promise.resolve(); } },
    workspaceState: { get: (k: string) => state.get(k), update: (k: string, v: unknown) => { state.set(k, v); return Promise.resolve(); } },
    secretValues: secrets,
  };
}
