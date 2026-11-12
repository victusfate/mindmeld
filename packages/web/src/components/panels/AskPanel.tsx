// Ask: a question answered only with verifiable citations. Supported text is shown with clickable citations
// (source span or replay event) marked fresh/stale/invalid; unsupported sentences are flagged and hidden behind
// a reveal; an abstained answer shows "unknown". Usage nulls render as "unknown", never 0.
import { useState, type FormEvent } from 'react';
import type { Answer, ResolvedCitation, Status } from '@mindmeld/client';
import { api } from '../../api.ts';
import type { Report } from '../../hooks.ts';
import { answerView, citationTone, parseEventRef, resolvedIndex, segments, type CiteRef } from '../../lib/answer.ts';
import { errorMessage } from '../../lib/format.ts';
import { usageLine } from '../../lib/usage.ts';

interface Nav { onSelect: (id: string) => void; onReplay: (runId: string, step: number) => void }
interface Props extends Nav { projectId: string; status: Status | null; onChanged: () => void; report: Report }

function Cite({ cite, resolved, nav }: { cite: CiteRef; resolved: ResolvedCitation | null; nav: Nav }) {
  const tone = citationTone(resolved);
  const open = (): void => {
    if (cite.kind === 'symbol') { nav.onSelect(cite.ref); return; }
    const ev = parseEventRef(cite.ref);
    if (ev) nav.onReplay(ev.runId, ev.seq);
  };
  const label = `${cite.kind === 'symbol' ? 'S' : 'E'}:${cite.ref}`;
  return (
    <button type="button" className={`cite cite-${tone}`} onClick={open} disabled={tone === 'invalid'} data-testid="citation"
      title={`${resolved?.label ?? 'unresolved'} — ${tone}`}>[{label}]</button>
  );
}

function Rich({ text, index, nav }: { text: string; index: Map<string, ResolvedCitation>; nav: Nav }) {
  return <>{segments(text, index).map((s, i) => s.kind === 'text' ? <span key={i}>{s.text}</span> : <Cite key={i} cite={s.cite} resolved={s.resolved} nav={nav} />)}</>;
}

function AnswerView({ answer, nav }: { answer: Answer; nav: Nav }) {
  const [reveal, setReveal] = useState(false);
  const view = answerView(answer);
  const index = resolvedIndex(answer);
  return (
    <article className="answer" data-testid="answer">
      {view.abstained && <span className="badge badge-unknown">unknown</span>}
      <p className="answer-text"><Rich text={answer.text} index={index} nav={nav} /></p>
      {view.unsupported.length > 0 && (
        <div className="unsupported">
          <button type="button" className="link" aria-expanded={reveal} onClick={() => setReveal(v => !v)} data-testid="reveal-unsupported">
            {reveal ? 'Hide' : 'Show'} {view.unsupported.length} unsupported sentence{view.unsupported.length === 1 ? '' : 's'}
          </button>
          {reveal && <ul>{view.unsupported.map((s, i) => <li key={i} className="flagged" data-testid="unsupported"><span className="badge badge-error">unsupported</span> <Rich text={s.text} index={index} nav={nav} /></li>)}</ul>}
        </div>
      )}
      {answer.citations.length > 0 && (
        <ul className="citations">{answer.citations.map(c => (
          <li key={`${c.kind}:${c.ref}`}><span className={`badge badge-${citationTone(c)}`}>{c.valid ? c.freshness : 'invalid'}</span> <span className="small">{c.label}</span></li>
        ))}</ul>
      )}
      {answer.unknowns.length > 0 && <ul className="small muted">{answer.unknowns.map(u => <li key={u}>{u}</li>)}</ul>}
      <p className="usage-line mono small" data-testid="answer-usage">{usageLine(answer.usage)}</p>
    </article>
  );
}

export function AskPanel({ projectId, status, onSelect, onReplay, onChanged, report }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const modelOk = status?.model.available === true;
  const ask = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    try { setAnswer(await api.ask(projectId, question.trim())); } catch (err) { report(`Ask failed: ${errorMessage(err)}`); } finally { setBusy(false); onChanged(); }
  };
  return (
    <div className="ask">
      <h2>Ask</h2>
      <form onSubmit={e => void ask(e)}>
        <label htmlFor="question">Question about this code</label>
        <textarea id="question" rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="What does playTurn do when the attack is very high?" />
        <button type="submit" className="primary" disabled={!modelOk || busy || !question.trim()} data-testid="ask-button"
          title={modelOk ? 'Ask the local agent CLI' : `Model unavailable: ${status?.model.reason ?? 'checking'}`}>{busy ? 'Asking…' : 'Ask'}</button>
      </form>
      <p className="muted small">Answers cite source [S:…] or recorded events [E:…]. Claims without valid citations are flagged.</p>
      {answer && <AnswerView answer={answer} nav={{ onSelect, onReplay }} />}
    </div>
  );
}
