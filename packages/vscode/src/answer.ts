// Renders a Studio answer for the webview and maps clicked citations back to source spans. Only sentences the
// server marked supported are shown as claims; unsupported ones stay visible but flagged, and an abstention
// reads "unknown". `[S:…]` cites static source (what may happen); `[E:…]` cites a recorded event (what did).
import type { Answer, CodeSymbol, ResolvedCitation } from '@mindmeld/client';

export type Span = CodeSymbol['span'];
import { answerUsageLine } from './usage.ts';

export interface CitationToken { kind: 'symbol' | 'event'; ref: string }
export interface CitationTarget { span: Span; freshness: ResolvedCitation['freshness']; label: string }

export function parseCitationToken(token: string): CitationToken | null {
  const m = /^(S|E):(\S+)$/.exec(token);
  return m ? { kind: m[1] === 'S' ? 'symbol' : 'event', ref: m[2] } : null;
}

export function citationTarget(answer: Answer, token: string): CitationTarget | null {
  const parsed = parseCitationToken(token);
  const found = parsed && answer.citations.find(c => c.kind === parsed.kind && c.ref === parsed.ref);
  return found?.valid && found.span ? { span: found.span, freshness: found.freshness, label: found.label } : null;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, ch => ESCAPES[ch]);

const provenance = (token: string): string => (token.startsWith('E:') ? 'observed event' : 'static source');

function citationLink(answer: Answer, token: string): string {
  const parsed = parseCitationToken(token);
  const c = parsed && answer.citations.find(x => x.kind === parsed.kind && x.ref === parsed.ref);
  const state = !c?.valid ? 'missing' : c.freshness;
  const title = `${provenance(token)} · ${state}${c ? ` · ${c.label}` : ''}`;
  if (state === 'missing') return `<span class="cite missing" title="${escapeHtml(title)}">[${escapeHtml(token)}] (unresolvable)</span>`;
  const badge = state === 'stale' ? ' <span class="badge stale">stale</span>' : '';
  return `<a href="#" class="cite ${state}" data-cite="${escapeHtml(token)}" title="${escapeHtml(title)}">[${escapeHtml(token)}]</a>${badge}`;
}

const stripCitations = (text: string): string => text.replace(/\s*\[(?:S|E):[^\]\s]+\]/g, '');

function sentenceHtml(answer: Answer, s: Answer['sentences'][number]): string {
  const cites = s.citations.map(t => citationLink(answer, t)).join(' ');
  if (s.supported) return `<li class="supported">${escapeHtml(stripCitations(s.text))} ${cites}</li>`;
  return `<li class="unsupported"><span class="badge unsupported">unsupported</span> <s>${escapeHtml(stripCitations(s.text))}</s> ${cites}`
    + ' <em>(no resolvable evidence; not a claim)</em></li>';
}

export function answerBodyHtml(answer: Answer): string {
  const head = `<h2>${escapeHtml(answer.question)}</h2>`;
  const verdict = answer.abstained ? `<p class="unknown"><strong>unknown</strong> — ${escapeHtml(answer.text.replace(/^unknown:?\s*/i, ''))}</p>` : '';
  const list = answer.sentences.length ? `<ol>${answer.sentences.map(s => sentenceHtml(answer, s)).join('')}</ol>` : '';
  const unknowns = answer.unknowns.map(u => `<p class="unknown">${escapeHtml(u)}</p>`).join('');
  const notes = answer.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join('');
  return `${head}${verdict}${list}${unknowns}<ul class="notes">${notes}</ul><p class="model">model: ${escapeHtml(answer.model ?? 'none')}</p>`
    + `<p class="usage">${escapeHtml(answerUsageLine(answer.usage))}</p>`;
}

const STYLE = 'body{font-family:var(--vscode-font-family);color:var(--vscode-foreground)}'
  + '.unsupported{opacity:.75}.badge{font-size:.8em;padding:0 .3em;border-radius:3px;border:1px solid currentColor}'
  + '.stale,.unsupported .badge{color:var(--vscode-editorWarning-foreground)}.missing{color:var(--vscode-errorForeground)}'
  + '.unknown{font-style:italic}.notes,.model,.usage{font-size:.85em;opacity:.8}';

export function answerHtml(answer: Answer, nonce: string, cspSource: string): string {
  const csp = `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const script = 'const vscode=acquireVsCodeApi();document.addEventListener("click",e=>{const a=e.target.closest("[data-cite]");'
    + 'if(a){e.preventDefault();vscode.postMessage({type:"cite",token:a.dataset.cite});}});';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>${STYLE}</style></head><body>${answerBodyHtml(answer)}<script nonce="${nonce}">${script}</script></body></html>`;
}
