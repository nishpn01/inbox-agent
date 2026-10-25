import { useEffect, useMemo, useState } from 'react';
import demoInbox from '../data/demo-inbox.json';
import { applyProposal, toActions } from '../lib/agent/rules.ts';
import type { ChatTurn, Correction, Decision, DiscoverResult, Email, Proposal, RunLogEntry, Taxonomy } from '../lib/agent/types.ts';

const INBOX = demoInbox as Email[];
const STORE = 'inbox-agent:v1';

type State = {
  discovery: DiscoverResult | null;
  taxonomy: Taxonomy | null;
  approved: boolean;
  chat: ChatTurn[];
  decisions: Decision[];
  corrections: Correction[];
  proposals: Proposal[];
  log: RunLogEntry[];
};
const EMPTY: State = { discovery: null, taxonomy: null, approved: false, chat: [], decisions: [], corrections: [], proposals: [], log: [] };

function load(): State {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') };
  } catch {
    return EMPTY;
  }
}

async function call<T>(action: string, args: object): Promise<T & { log: RunLogEntry[] }> {
  const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...args }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

type Tab = 'onboard' | 'inbox' | 'learn' | 'log';

export default function App() {
  const [s, setS] = useState<State>(load);
  const [tab, setTab] = useState<Tab>(() => (load().approved ? 'inbox' : 'onboard'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* private window: state just won't persist */
    }
  }, [s]);

  const patch = (p: Partial<State>) => setS((prev) => ({ ...prev, ...p }));
  const addLog = (entries: RunLogEntry[]) => setS((prev) => ({ ...prev, log: [...prev.log, ...entries] }));

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const discoverNow = () =>
    run('Reading your inbox and proposing categories…', async () => {
      const { result, log } = await call<{ result: DiscoverResult }>('discover', { emails: INBOX });
      addLog(log);
      const taxonomy = { categories: result.categories.map(({ name, description, highStakes }) => ({ name, description, highStakes })), senderRules: result.senderRules };
      const intro = `I read ${INBOX.length} emails and propose ${result.categories.length} categories.` + (result.questions.length ? `\n\nA few questions:\n${result.questions.map((q) => `• ${q}`).join('\n')}` : '');
      patch({ discovery: result, taxonomy, approved: false, chat: [{ role: 'agent', text: intro }], decisions: [] });
    });

  const sendChat = (message: string) =>
    run('Updating categories…', async () => {
      const history = [...s.chat, { role: 'user' as const, text: message }];
      patch({ chat: history });
      const { reply, taxonomy, log } = await call<{ reply: string; taxonomy: Taxonomy }>('refine', { taxonomy: s.taxonomy, history: s.chat, message });
      addLog(log);
      patch({ taxonomy, chat: [...history, { role: 'agent', text: reply }] });
    });

  const classifyNow = () =>
    run('Labeling your inbox…', async () => {
      const { decisions, log } = await call<{ decisions: Decision[] }>('classify', { emails: INBOX, taxonomy: s.taxonomy, corrections: s.corrections });
      addLog(log);
      patch({ decisions });
    });

  const proposeNow = () =>
    run('Looking for patterns in your corrections…', async () => {
      const { proposals, log } = await call<{ proposals: Proposal[] }>('propose', { taxonomy: s.taxonomy, corrections: s.corrections });
      addLog(log);
      patch({ proposals });
    });

  function correct(email: Email, d: Decision, label: string) {
    const c: Correction = { emailId: email.id, from: email.from.email, subject: email.subject, snippet: email.body.slice(0, 200), predicted: d.label, corrected: label };
    patch({
      corrections: [...s.corrections.filter((x) => x.emailId !== email.id), c],
      decisions: s.decisions.map((x) => (x.emailId === email.id ? { ...x, label, reason: 'Corrected by you', confidence: 1 } : x)),
    });
  }

  const reset = () => {
    if (confirm('Start over? This clears categories, labels and corrections.')) {
      setS(EMPTY);
      setTab('onboard');
    }
  };

  return (
    <div className="app">
      <header>
        <div>
          <h1>Inbox Agent</h1>
          <p className="muted">Demo inbox: Harborline Staffing (fictional) · {INBOX.length} emails · label-only, never archives, sends or deletes</p>
        </div>
        <button className="ghost" onClick={reset}>Start over</button>
      </header>

      <nav>
        {(['onboard', 'inbox', 'learn', 'log'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} disabled={t !== 'onboard' && t !== 'log' && !s.approved}>
            {{ onboard: '1 · Set up', inbox: '2 · Inbox', learn: `3 · Learn${s.corrections.length ? ` (${s.corrections.length})` : ''}`, log: 'Run log' }[t]}
          </button>
        ))}
      </nav>

      {busy && <div className="banner">{busy}</div>}
      {error && <div className="banner error">{error}</div>}

      {tab === 'onboard' && (
        <Onboard
          s={s}
          busy={!!busy}
          onDiscover={discoverNow}
          onChat={sendChat}
          onToggleHighStakes={(name) => patch({ taxonomy: { ...s.taxonomy!, categories: s.taxonomy!.categories.map((c) => (c.name === name ? { ...c, highStakes: !c.highStakes } : c)) } })}
          onApprove={() => {
            patch({ approved: true });
            setTab('inbox');
          }}
        />
      )}
      {tab === 'inbox' && s.taxonomy && <Inbox s={s} busy={!!busy} onRun={classifyNow} onCorrect={correct} />}
      {tab === 'learn' && s.taxonomy && (
        <Learn
          s={s}
          busy={!!busy}
          onPropose={proposeNow}
          onDecide={(p, ok) => patch({ taxonomy: ok ? applyProposal(s.taxonomy!, p) : s.taxonomy, proposals: s.proposals.filter((x) => x !== p) })}
        />
      )}
      {tab === 'log' && <Log log={s.log} />}
    </div>
  );
}

function Onboard(props: { s: State; busy: boolean; onDiscover: () => void; onChat: (m: string) => void; onToggleHighStakes: (n: string) => void; onApprove: () => void }) {
  const { s, busy } = props;
  const [msg, setMsg] = useState('');
  if (!s.taxonomy)
    return (
      <section className="empty">
        <h2>Step 0: let the agent read the inbox first</h2>
        <p className="muted">No preset labels. The agent reads a sample of the mail, proposes categories that fit this inbox, and asks where it was unsure. You refine them in plain language, then approve.</p>
        <button onClick={props.onDiscover} disabled={busy}>Discover categories</button>
      </section>
    );
  const count = (name: string) => s.discovery?.categories.find((c) => c.name === name)?.count;
  const examples = (name: string) => (s.discovery?.categories.find((c) => c.name === name)?.exampleIds ?? []).map((id) => INBOX.find((e) => e.id === id)?.subject).filter(Boolean);
  return (
    <section className="grid2">
      <div>
        <h2>Proposed categories <span className="muted small">in priority order: first match wins</span></h2>
        {s.taxonomy.categories.map((c) => (
          <div key={c.name} className="card">
            <div className="row">
              <strong>{c.name}</strong>
              {count(c.name) !== undefined && <span className="muted small">{count(c.name)} in sample</span>}
              <label className="small toggle">
                <input type="checkbox" checked={c.highStakes} onChange={() => props.onToggleHighStakes(c.name)} /> high-stakes
              </label>
            </div>
            <p>{c.description}</p>
            {examples(c.name).length > 0 && <p className="muted small">e.g. {examples(c.name).join(' · ')}</p>}
          </div>
        ))}
        {s.taxonomy.senderRules.length > 0 && (
          <p className="small">Sender rules: {s.taxonomy.senderRules.map((r) => `${r.match} → ${r.category}`).join(' · ')}</p>
        )}
        <button onClick={props.onApprove} disabled={busy || !s.taxonomy.categories.length}>{s.approved ? 'Approved: go to inbox' : 'Approve categories'}</button>
      </div>
      <div className="chat">
        <h2>Talk to the agent</h2>
        <div className="turns">
          {s.chat.map((t, i) => (
            <div key={i} className={`turn ${t.role}`}>{t.text}</div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            props.onChat(msg.trim());
            setMsg('');
          }}
        >
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder='e.g. "Merge Vendors and Newsletters" or "Anything from @mesaridge always goes to Client Requests"' disabled={busy} />
          <button disabled={busy}>Send</button>
        </form>
      </div>
    </section>
  );
}

function Inbox(props: { s: State; busy: boolean; onRun: () => void; onCorrect: (e: Email, d: Decision, label: string) => void }) {
  const { s } = props;
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(s.decisions.map((d) => [d.emailId, d])), [s.decisions]);
  const eyes = s.decisions.filter((d) => d.needsEyes);
  const labeled = toActions(s.decisions).length;
  return (
    <section>
      <div className="row">
        <button onClick={props.onRun} disabled={props.busy}>{s.decisions.length ? 'Run again' : 'Run agent'}</button>
        {s.decisions.length > 0 && (
          <span className="muted">
            Labeled {labeled} · skipped {s.decisions.length - labeled} · needs your eyes {eyes.length}
            {s.corrections.length > 0 && ` · using ${s.corrections.length} of your corrections`}
          </span>
        )}
      </div>
      {eyes.length > 0 && (
        <>
          <h2>Needs your eyes</h2>
          <List emails={INBOX.filter((e) => byId.get(e.id)?.needsEyes)} {...{ byId, open, setOpen, s, onCorrect: props.onCorrect }} />
        </>
      )}
      <h2>All mail</h2>
      <List emails={INBOX} {...{ byId, open, setOpen, s, onCorrect: props.onCorrect }} />
    </section>
  );
}

function List(props: { emails: Email[]; byId: Map<string, Decision>; open: string | null; setOpen: (id: string | null) => void; s: State; onCorrect: (e: Email, d: Decision, label: string) => void }) {
  return (
    <div className="list">
      {props.emails.map((e) => {
        const d = props.byId.get(e.id);
        const hs = props.s.taxonomy?.categories.find((c) => c.name === d?.label)?.highStakes;
        return (
          <div key={e.id} className="mail">
            <div className="row" onClick={() => props.setOpen(props.open === e.id ? null : e.id)}>
              <span className="from">{e.from.name}</span>
              <span className="subject">{e.subject}</span>
              {d && <span className={`chip ${d.label ? (hs ? 'hs' : '') : 'skip'}`}>{d.label ?? 'Skipped'}</span>}
              {d?.needsEyes && <span className="chip eyes">👀</span>}
            </div>
            {d && (
              <div className="why small muted">
                {d.reason} {d.source === 'model' && d.reason !== 'Corrected by you' && `· ${(d.confidence * 100).toFixed(0)}%`}
                {d.needsEyesReason && ` · ${d.needsEyesReason}`}
              </div>
            )}
            {props.open === e.id && (
              <div className="body">
                <pre>{e.body}</pre>
                {d && (
                  <label className="small">
                    Correct the label:{' '}
                    <select value={d.label ?? ''} onChange={(ev) => ev.target.value && props.onCorrect(e, d, ev.target.value)}>
                      <option value="">—</option>
                      {props.s.taxonomy!.categories.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Learn(props: { s: State; busy: boolean; onPropose: () => void; onDecide: (p: Proposal, ok: boolean) => void }) {
  const { s } = props;
  const exportCases = () => {
    const cases = s.corrections.map((c) => ({ id: c.emailId, expected: c.corrected, needsEyes: false, note: `corrected from ${c.predicted ?? 'SKIP'}` }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' }));
    a.download = 'eval-extra.json';
    a.click();
  };
  return (
    <section className="grid2">
      <div>
        <h2>Your corrections</h2>
        <p className="muted small">Every correction is used as an example on the next run, straight away. Bigger changes to the rules are proposed on the right and wait for your approval.</p>
        {s.corrections.length === 0 && <p className="muted">None yet. Open an email in the inbox and correct its label.</p>}
        {s.corrections.map((c) => (
          <div key={c.emailId} className="card small">
            <strong>{c.subject}</strong>
            <div>{c.predicted ?? 'Skipped'} → {c.corrected}</div>
          </div>
        ))}
        {s.corrections.length > 0 && <button className="ghost" onClick={exportCases}>Export as eval cases</button>}
      </div>
      <div>
        <h2>Proposed rule changes</h2>
        <button onClick={props.onPropose} disabled={props.busy || !s.corrections.length}>Ask the agent what it learned</button>
        {s.proposals.map((p, i) => (
          <div key={i} className="card">
            <div className="row">
              <strong>{p.kind.replace(/_/g, ' ')}</strong>
              <span className="muted small">{p.category}</span>
            </div>
            <p>{p.kind === 'add_sender_rule' ? `${p.match} → ${p.category}` : p.change}</p>
            <p className="muted small">{p.why}</p>
            <div className="row">
              <button onClick={() => props.onDecide(p, true)}>Approve</button>
              <button className="ghost" onClick={() => props.onDecide(p, false)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Log({ log }: { log: RunLogEntry[] }) {
  const cost = log.reduce((s, l) => s + (l.costUsd ?? 0), 0);
  return (
    <section>
      <h2>Run log <span className="muted small">{log.length} model calls · ${cost.toFixed(4)} total</span></h2>
      <table>
        <thead>
          <tr><th>When</th><th>Task</th><th>Model</th><th>Prompt</th><th>Tokens in/out</th><th>Cost</th><th>Time</th></tr>
        </thead>
        <tbody>
          {[...log].reverse().map((l, i) => (
            <tr key={i}>
              <td>{new Date(l.at).toLocaleTimeString()}</td>
              <td>{l.task}</td>
              <td>{l.model}</td>
              <td>{l.promptVersion}</td>
              <td>{l.inputTokens}/{l.outputTokens}</td>
              <td>{l.costUsd == null ? '—' : `$${l.costUsd.toFixed(4)}`}</td>
              <td>{(l.ms / 1000).toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
