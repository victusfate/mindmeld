// Builds an explorer page spec (scripts/explorer-spec.ts, rendered by scripts/explorer-render.ts) from a project's
// index: modules become nodes in lanes, cross-module call chains become flows. Everything here is counted from the
// graph, so the page is a deterministic map; an agent can add prose (roles, risks, glossary) to the JSON afterwards.
import type { CodeSymbol, Graph, StaticEdge } from '@mindmeld/core';
import type { ExplorerNode, ExplorerSpec, Flow, FlowStep } from '../../../scripts/explorer-spec.ts';
import { countBy, push } from './collections.ts';
import { shortHash } from './format.ts';

const MAX_NODES = 24;
const MAX_LANES = 8;
const MAX_FLOWS = 3;
const MAX_STEPS = 8;
const MIN_FLOW_MODULES = 3;
const MAX_VISITED = 2_000;
const MAX_ENTRY_CANDIDATES = 300;
const TOP = 5;
const ROOT = '.';
const OTHER = 'other';

const dirsOf = (file: string): string[] => file.split('/').slice(0, -1);
const shortName = (id: string): string => id.split('#').at(-1) ?? id;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;

/** Modules for the page. A small repo shows its files. Otherwise start from top-level directories and keep
 * splitting the module with the most symbols into its subdirectories while the page stays within MAX_NODES, so
 * detail goes where the code is. Returns file → node id. */
const keyAt = (file: string, depth: number): string => dirsOf(file).slice(0, depth).join('/') || ROOT;

/** Files grouped by their current key, with each group's symbol weight. */
function regroup(weights: Map<string, number>, depthOf: Map<string, number>): { groups: Map<string, string[]>; weightOf: Map<string, number> } {
  const groups = new Map<string, string[]>();
  const weightOf = new Map<string, number>();
  for (const [f, w] of weights) {
    const key = keyAt(f, depthOf.get(f) ?? 1);
    push(groups, key, f);
    weightOf.set(key, (weightOf.get(key) ?? 0) + w);
  }
  return { groups, weightOf };
}

function groupFiles(weights: Map<string, number>): Map<string, string> {
  const files = [...weights.keys()];
  if (files.length <= MAX_NODES) return new Map(files.map(f => [f, f]));
  const depthOf = new Map(files.map(f => [f, 1]));
  const done = new Set<string>();
  // Ends: each pass either splits a group (the count grows, capped at MAX_NODES) or marks one done.
  for (;;) {
    const { groups, weightOf } = regroup(weights, depthOf);
    const open = [...groups.keys()].filter(k => !done.has(k));
    const heaviest = open.sort((a, b) => (weightOf.get(b) ?? 0) - (weightOf.get(a) ?? 0) || a.localeCompare(b))[0];
    if (heaviest === undefined) return new Map(files.map(f => [f, keyAt(f, depthOf.get(f) ?? 1)]));
    const [key, members] = [heaviest, groups.get(heaviest) ?? []];
    const depth = depthOf.get(members[0]) ?? 1;
    const children = new Set(members.map(f => keyAt(f, depth + 1)));
    if (children.size > 1 && groups.size - 1 + children.size <= MAX_NODES) for (const f of members) depthOf.set(f, depth + 1);
    else done.add(key);
  }
}

/** A node's lane is the top-level directory of its files (root-level files share one lane); past MAX_LANES the lanes
 * with the fewest symbols merge into "other". */
function lanesFor(m: Model, nodeIds: string[]): Map<string, string> {
  const laneOf = (id: string): string => dirsOf(m.members.get(id)?.[0]?.span.file ?? '')[0] ?? ROOT;
  const sizes = new Map<string, number>();
  for (const id of nodeIds) sizes.set(laneOf(id), (sizes.get(laneOf(id)) ?? 0) + size(m, id));
  const kept = new Set([...sizes].sort((a, b) => b[1] - a[1]).slice(0, MAX_LANES - 1).map(([k]) => k));
  const all = sizes.size <= MAX_LANES;
  return new Map(nodeIds.map(id => [id, all || kept.has(laneOf(id)) ? laneOf(id) : OTHER]));
}

const tally = (values: string[]): string => countBy(values).map(([k, n]) => plural(n, k)).join(', ');

interface Model {
  graph: Graph;
  nodeOf: Map<string, string>;      // symbol id → node id
  members: Map<string, CodeSymbol[]>;
  calls: StaticEdge[];
  fanIn: Map<string, number>;
  callees: Map<string, StaticEdge[]>;
  /** Module-crossing call counts: node → other node → calls, in each direction. */
  outgoing: Map<string, Map<string, number>>;
  incoming: Map<string, Map<string, number>>;
}

const size = (m: Model, id: string): number => m.members.get(id)?.length ?? 0;

function bump(map: Map<string, Map<string, number>>, a: string, b: string): void {
  const inner = map.get(a) ?? new Map<string, number>();
  inner.set(b, (inner.get(b) ?? 0) + 1);
  map.set(a, inner);
}

function addCall(m: Model, e: StaticEdge): void {
  m.fanIn.set(e.to, (m.fanIn.get(e.to) ?? 0) + 1);
  push(m.callees, e.from, e);
  const [from, to] = [m.nodeOf.get(e.from) ?? OTHER, m.nodeOf.get(e.to) ?? OTHER];
  if (from !== to) { bump(m.outgoing, from, to); bump(m.incoming, to, from); }
}

function modelOf(graph: Graph): Model {
  const weights = new Map<string, number>();
  for (const s of graph.symbols) weights.set(s.span.file, (weights.get(s.span.file) ?? 0) + 1);
  const groupOf = groupFiles(new Map([...weights].sort((a, b) => a[0].localeCompare(b[0]))));
  const m: Model = { graph, nodeOf: new Map(), members: new Map(), calls: [], fanIn: new Map(), callees: new Map(), outgoing: new Map(), incoming: new Map() };
  for (const s of graph.symbols) {
    const node = groupOf.get(s.span.file) ?? OTHER;
    m.nodeOf.set(s.id, node);
    push(m.members, node, s);
  }
  // name-match edges are guesses; a map for newcomers shows only calls the indexer resolved.
  m.calls = graph.staticEdges.filter(e => e.kind === 'call' && e.resolution !== 'name-match' && m.nodeOf.has(e.from) && m.nodeOf.has(e.to));
  for (const e of m.calls) addCall(m, e);
  for (const list of m.callees.values()) list.sort((a, b) => (m.fanIn.get(b.to) ?? 0) - (m.fanIn.get(a.to) ?? 0) || a.to.localeCompare(b.to));
  return m;
}

function nodeSpec(m: Model, id: string, lane: string): ExplorerNode {
  const members = m.members.get(id) ?? [];
  const files = new Set(members.map(s => s.span.file));
  const ranked = (c: Map<string, number> | undefined): [string, number][] => [...(c ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const names = (r: [string, number][]): string => r.slice(0, TOP).map(([k]) => k).join(', ');
  const [incoming, out] = [ranked(m.incoming.get(id)), ranked(m.outgoing.get(id))];
  const busiest = [...members].sort((a, b) => (m.fanIn.get(b.id) ?? 0) - (m.fanIn.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, TOP);
  const role = [`${plural(members.length, 'symbol')} in ${plural(files.size, 'file')} (${tally(members.map(s => s.kind))}).`,
    incoming.length ? `Called from ${names(incoming)}.` : 'Nothing else in the repo calls into it.',
    out.length ? `Calls into ${names(out)}.` : ''].filter(Boolean).join(' ');
  return {
    lane, name: id === ROOT ? '(repo root)' : id, role,
    details: busiest.map(s => `${s.name} (${s.kind}) at ${s.span.file}:${s.span.startLine}; ${plural(m.fanIn.get(s.id) ?? 0, 'static caller')}`),
    ...(out.length ? { deep: [{ h: 'Calls into other modules', table: { head: ['module', 'calls'], rows: out.map(([k, n]) => [k, String(n)]) } }] } : {}),
    qs: [`What is ${id} responsible for?`, ...(busiest[0] ? [`How does ${busiest[0].name} work, and who depends on it?`] : [])],
  };
}

/** Depth-first from `entry`, recording each call that crosses into another module, until MAX_STEPS. */
function trace(m: Model, entry: string): FlowStep[] {
  const steps: FlowStep[] = [];
  const seen = new Set([entry]);
  const walk = (id: string): void => {
    for (const e of m.callees.get(id) ?? []) {
      if (steps.length >= MAX_STEPS || seen.size >= MAX_VISITED) return;
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      const [from, to] = [m.nodeOf.get(e.from), m.nodeOf.get(e.to)];
      if (from && to && from !== to) steps.push([from, to, `${shortName(e.from)} calls ${shortName(e.to)}`, `${e.site.file}:${e.site.startLine} (${e.resolution})`]);
      walk(e.to);
    }
  };
  walk(entry);
  return steps;
}

const modulesTouched = (steps: FlowStep[]): number => new Set(steps.flatMap(([from, to]) => [from, to])).size;

/** Entry points: symbols nothing calls, ranked by how many modules their call chain touches, then its length. */
function flows(m: Model): Flow[] {
  const candidates = m.graph.symbols.filter(s => !m.fanIn.has(s.id) && m.callees.has(s.id))
    .sort((a, b) => (m.callees.get(b.id)?.length ?? 0) - (m.callees.get(a.id)?.length ?? 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_ENTRY_CANDIDATES);
  // A chain that only bounces between two modules says little a reader cannot see from the map itself.
  return candidates.map(s => ({ s, steps: trace(m, s.id) })).filter(f => modulesTouched(f.steps) >= MIN_FLOW_MODULES)
    .sort((a, b) => modulesTouched(b.steps) - modulesTouched(a.steps) || b.steps.length - a.steps.length || a.s.id.localeCompare(b.s.id))
    .slice(0, MAX_FLOWS)
    .map((f, i) => ({ id: `flow-${i + 1}`, name: `${f.s.name} (${f.s.span.file})`, intro: `Static calls from ${f.s.id} that cross into another module, depth first.`, steps: f.steps }));
}

export function explorerSpec(graph: Graph): ExplorerSpec {
  if (!graph.symbols.length) throw new Error(`${graph.project.name} has no indexed symbols to map`);
  const m = modelOf(graph);
  const nodeIds = [...m.members.keys()].sort();
  const laneOf = lanesFor(m, nodeIds);
  const laneIds = [...new Set(laneOf.values())].sort();
  const traced = flows(m);
  const { project, snapshot } = graph;
  return {
    title: `${project.name}: code map`,
    eyebrow: 'Mind Meld',
    lede: `Generated from the static index of ${project.name} (snapshot ${shortHash(snapshot.snapshotHash)}): ${plural(graph.symbols.length, 'symbol')} in ${plural(nodeIds.length, 'module')}. Calls are possible calls found by parsing; calls matched only by name are left out.`,
    lanes: laneIds.map(id => ({ id, name: id === ROOT ? '(repo root)' : id })),
    nodes: Object.fromEntries(nodeIds.map(id => [id, nodeSpec(m, id, laneOf.get(id) ?? OTHER)])),
    ...(traced.length ? { flows: traced } : {}),
    ask: { context: `The reader is new to the ${project.name} repository and is using this map to find where to start reading.`, style: 'Answer concretely, naming files and functions. Plain text, under 200 words.' },
    start: { node: [...nodeIds].sort((a, b) => size(m, b) - size(m, a) || a.localeCompare(b))[0], ...(traced[0] ? { flow: traced[0].id } : {}) },
  };
}
