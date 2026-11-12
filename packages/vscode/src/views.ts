// Tree views: Symbols (file → symbol, with static/observed evidence) and Runs (run → recorded call tree).
import * as vscode from 'vscode';
import type { CodeSymbol, Run, TraceEvent } from '@mindmeld/client';
import { evidenceFor } from './evidence.ts';
import type { Session } from './session.ts';
import { childEvents, eventDescription, eventLabel, groupByFile, runDescription, runLabel, runTooltip, symbolDescription, type FileGroup } from './trees.ts';

export const OPEN_SPAN = 'mindmeld.openSpan';
export const REVEAL_EVENT = 'mindmeld.revealEvent';

const { Collapsed, None } = vscode.TreeItemCollapsibleState;

abstract class Provider<T> implements vscode.TreeDataProvider<T> {
  private readonly emitter = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  refresh(): void { this.emitter.fire(undefined); }
  abstract getChildren(node?: T): vscode.ProviderResult<T[]>;
  abstract getTreeItem(node: T): vscode.TreeItem;
}

export type SymbolNode = { kind: 'file'; group: FileGroup } | { kind: 'symbol'; symbol: CodeSymbol };

export class SymbolsProvider extends Provider<SymbolNode> {
  private readonly session: Session;
  constructor(session: Session) { super(); this.session = session; }

  getChildren(node?: SymbolNode): SymbolNode[] {
    const graph = this.session.graph;
    if (!graph) return [];
    if (!node) return groupByFile(graph.symbols).map(group => ({ kind: 'file', group }));
    return node.kind === 'file' ? node.group.symbols.map(symbol => ({ kind: 'symbol', symbol })) : [];
  }

  getTreeItem(node: SymbolNode): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.group.file, Collapsed);
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.description = `${node.group.symbols.length} symbols`;
      return item;
    }
    const s = node.symbol;
    const graph = this.session.graph!;
    const item = new vscode.TreeItem(s.name, None);
    item.description = symbolDescription(s, evidenceFor(graph, this.session.runs, s.id));
    item.tooltip = `${s.kind} ${s.id} (${s.span.file}:${s.span.startLine}-${s.span.endLine})`;
    item.iconPath = new vscode.ThemeIcon(s.kind === 'class' ? 'symbol-class' : 'symbol-function');
    item.command = { command: OPEN_SPAN, title: 'Open', arguments: [s.span] };
    return item;
  }
}

export type RunNode = { kind: 'run'; run: Run } | { kind: 'event'; run: Run; event: TraceEvent; events: TraceEvent[] };

export class RunsProvider extends Provider<RunNode> {
  private readonly session: Session;
  constructor(session: Session) { super(); this.session = session; }

  async getChildren(node?: RunNode): Promise<RunNode[]> {
    if (!node) return this.session.runs.map(run => ({ kind: 'run', run }));
    const events = node.kind === 'run' ? await this.session.runEvents(node.run.id) : node.events;
    const parent = node.kind === 'run' ? null : node.event.seq;
    return childEvents(events, parent).map(event => ({ kind: 'event', run: node.run, event, events }));
  }

  getTreeItem(node: RunNode): vscode.TreeItem {
    if (node.kind === 'run') {
      const item = new vscode.TreeItem(runLabel(node.run), Collapsed);
      item.description = runDescription(node.run);
      item.tooltip = runTooltip(node.run);
      item.iconPath = new vscode.ThemeIcon(node.run.stale ? 'warning' : node.run.status === 'ok' ? 'pass' : 'error');
      return item;
    }
    const e = node.event;
    const hasChildren = node.events.some(x => x.parent === e.seq);
    const item = new vscode.TreeItem(eventLabel(e), hasChildren ? vscode.TreeItemCollapsibleState.Expanded : None);
    item.description = eventDescription(e) + (node.run.stale ? ' (stale run)' : '');
    item.tooltip = `observed call #${e.seq} ${e.symbol}\nargs: ${e.args}\n${e.threw ? 'threw' : 'returned'}: ${e.result}`;
    item.iconPath = new vscode.ThemeIcon(e.threw ? 'error' : 'debug-stackframe');
    item.command = { command: REVEAL_EVENT, title: 'Reveal', arguments: [node.run.id, e.seq] };
    return item;
  }
}
