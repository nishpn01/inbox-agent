import { Activity, ArrowRight, Check, CircleSlash, Eye, Inbox as InboxIcon, Lightbulb, Loader2, RotateCcw, Send, ShieldCheck, Sparkles, Tags } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import demoInbox from '../data/demo-inbox.json';
import { applyProposal, toActions } from '../lib/agent/rules.ts';
import type { Category, ChatTurn, Correction, Decision, DiscoverResult, Email, Proposal, RunLogEntry, Taxonomy } from '../lib/agent/types.ts';

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
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

const snippet = (e: Email) => e.body.replace(/\s+/g, ' ').slice(0, 140);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const money = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 3)}`;

type Tab = 'setup' | 'inbox' | 'learn' | 'log';
type Busy = { label: string; steps: string[]; started: number } | null;

export default function App() {
  const [s, setS] = useState<State>(load);
  const [tab, setTab] = useState<Tab>(() => (load().approved ? 'inbox' : 'setup'));
  const [busy, setBusy] = useState<Busy>(null);
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
  const color = useMemo(() => new Map((s.taxonomy?.categories ?? []).map((c, i) => [c.name, i % 10])), [s.taxonomy]);

  async function run(label: string, steps: string[], fn: () => Promise<void>) {
    setBusy({ label, steps, started: Date.now() });
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const discoverNow = () =>
    run('Reading the inbox', ['Reading senders and subjects', 'Reading message bodies', 'Grouping similar mail', 'Ordering categories by priority', 'Writing questions for you'], async () => {
      const { result, log } = await call<{ result: DiscoverResult }>('discover', { emails: INBOX });
      addLog(log);
      const taxonomy = { categories: result.categories.map(({ name, description, highStakes }) => ({ name, description, highStakes })), senderRules: result.senderRules };
      const intro =
        `I read ${INBOX.length} emails and propose ${result.categories.length} categories, in priority order.` +
        (result.questions.length ? `\n\nA few things I wasn't sure about:\n${result.questions.map((q) => `• ${q}`).join('\n')}` : '');
      patch({ discovery: result, taxonomy, approved: false, chat: [{ role: 'agent', text: intro }], decisions: [], proposals: [] });
    });

  const sendChat = (message: string) =>
    run('Updating categories', ['Reading your request', 'Applying the change'], async () => {
      const history = [...s.chat, { role: 'user' as const, text: message }];
      patch({ chat: history });
      const { reply, taxonomy, log } = await call<{ reply: string; taxonomy: Taxonomy }>('refine', { taxonomy: s.taxonomy, history: s.chat, message });
      addLog(log);
      patch({ taxonomy, chat: [...history, { role: 'agent', text: reply }] });
    });

  const classifyNow = () =>
    run(`Labeling ${INBOX.length} emails`, ['Applying sender rules', 'Reading each message', 'Checking against your corrections', 'Enforcing confidence bars'], async () => {
      const { decisions, log } = await call<{ decisions: Decision[] }>('classify', { emails: INBOX, taxonomy: s.taxonomy, corrections: s.corrections });
      addLog(log);
      patch({ decisions });
    });

  const proposeNow = () =>
    run('Reviewing your corrections', ['Looking for patterns', 'Drafting rule changes'], async () => {
      const { proposals, log } = await call<{ proposals: Proposal[] }>('propose', { taxonomy: s.taxonomy, corrections: s.corrections });
      addLog(log);
      patch({ proposals });
    });

  function correct(email: Email, d: Decision, label: string) {
    const c: Correction = { emailId: email.id, from: email.from.email, subject: email.subject, snippet: email.body.slice(0, 200), predicted: d.label, corrected: label };
    patch({
      corrections: [...s.corrections.filter((x) => x.emailId !== email.id), c],
      decisions: s.decisions.map((x) => (x.emailId === email.id ? { ...x, label, reason: 'Corrected by you', confidence: 1, needsEyes: false } : x)),
    });
  }

  const reset = () => {
    if (confirm('Start over? This clears categories, labels and corrections.')) {
      setS(EMPTY);
      setTab('setup');
    }
  };

  const steps: { id: Tab; label: string; done: boolean; enabled: boolean }[] = [
    { id: 'setup', label: 'Set up', done: s.approved, enabled: true },
    { id: 'inbox', label: 'Inbox', done: s.decisions.length > 0, enabled: s.approved },
    { id: 'learn', label: 'Learn', done: false, enabled: s.approved },
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <InboxIcon size={18} />
          </span>
          <div>
            <h1>Inbox Agent</h1>
            <p className="muted small">Learns your categories, labels with reasons, gets better from your corrections</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="badge" title="The only action this agent can take is applying a label">
            <ShieldCheck size={14} /> Label-only
          </span>
          <button className="ghost icon-btn" onClick={reset} aria-label="Start over">
            <RotateCcw size={16} /> <span className="hide-sm">Start over</span>
          </button>
        </div>
      </header>

      <nav className="stepper" aria-label="Steps">
        {steps.map((st, i) => (
          <button key={st.id} className={`step ${tab === st.id ? 'active' : ''}`} onClick={() => setTab(st.id)} disabled={!st.enabled} aria-current={tab === st.id ? 'step' : undefined}>
            <span className={`dot ${st.done ? 'done' : ''}`}>{st.done ? <Check size={12} /> : i + 1}</span>
            {st.label}
            {st.id === 'learn' && s.corrections.length > 0 && <span className="count">{s.corrections.length}</span>}
          </button>
        ))}
        <button className={`step log-link ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
          <Activity size={14} /> Run log
          {s.log.length > 0 && <span className="count">{s.log.length}</span>}
        </button>
      </nav>

      {error && (
        <div className="alert" role="alert">
          <strong>That didn't work.</strong> {error}
          <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main>
        {busy ? (
          <Working busy={busy} />
        ) : (
          <>
            {tab === 'setup' &&
              (s.taxonomy ? (
                <Setup
                  s={s}
                  color={color}
                  onChat={sendChat}
                  onToggleHighStakes={(name) => patch({ taxonomy: { ...s.taxonomy!, categories: s.taxonomy!.categories.map((c) => (c.name === name ? { ...c, highStakes: !c.highStakes } : c)) } })}
                  onApprove={() => {
                    patch({ approved: true });
                    setTab('inbox');
                  }}
                  onRediscover={discoverNow}
                />
              ) : (
                <Intro onStart={discoverNow} />
              ))}
            {tab === 'inbox' && s.taxonomy && <InboxView s={s} color={color} onRun={classifyNow} onCorrect={correct} onLearn={() => setTab('learn')} />}
            {tab === 'learn' && s.taxonomy && (
              <Learn s={s} onPropose={proposeNow} onDecide={(p, ok) => patch({ taxonomy: ok ? applyProposal(s.taxonomy!, p) : s.taxonomy, proposals: s.proposals.filter((x) => x !== p) })} />
            )}
            {tab === 'log' && <Log log={s.log} />}
          </>
        )}
      </main>

      <footer className="muted small">
        Demo data is a fictional staffing company, Harborline Staffing. Every person and address in it is invented. Contact details are stripped before any model call.
      </footer>
    </div>
  );
}

function Working({ busy }: { busy: NonNullable<Busy> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - busy.started) / 1000);
  // A description of the work, not fake progress: each task is one model call.
  return (
    <section className="working" aria-live="polite">
      <Loader2 className="spin" size={28} />
      <h2>{busy.label}…</h2>
      <p className="muted small">In this step the agent is</p>
      <ul className="progress">
        {busy.steps.map((st) => (
          <li key={st}>
            <span className="pip" /> {st.charAt(0).toLowerCase() + st.slice(1)}
          </li>
        ))}
      </ul>
      <p className="muted small tabular">{secs}s</p>
    </section>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  const steps = [
    { icon: <Sparkles size={18} />, title: 'Discover', text: 'Reads the inbox and proposes categories that fit it. No preset label list.' },
    { icon: <Tags size={18} />, title: 'Agree on them', text: 'You refine the categories in plain language and mark which ones are high-stakes.' },
    { icon: <Lightbulb size={18} />, title: 'Label and learn', text: 'Labels each email with a reason, skips what it is unsure of, and learns from your fixes.' },
  ];
  return (
    <section className="intro">
      <p className="eyebrow">Demo · Harborline Staffing (fictional)</p>
      <h2 className="hero">An inbox agent that learns your categories instead of shipping with them</h2>
      <p className="lede muted">
        The demo inbox has {INBOX.length} emails from a small staffing firm: candidates, clients, timesheets, invoices, job boards, and a phishing attempt. Start the agent and watch it work out the categories for itself.
      </p>
      <div className="intro-steps">
        {steps.map((st, i) => (
          <div key={st.title} className="card intro-step">
            <span className="intro-icon">{st.icon}</span>
            <div>
              <strong>
                {i + 1}. {st.title}
              </strong>
              <p className="muted small">{st.text}</p>
            </div>
          </div>
        ))}
      </div>
      <button className="primary big" onClick={onStart}>
        Read the demo inbox <ArrowRight size={18} />
      </button>
      <details className="peek">
        <summary className="muted small">Peek at the inbox first</summary>
        <ul>
          {INBOX.slice(0, 8).map((e) => (
            <li key={e.id}>
              <strong>{e.from.name}</strong> <span className="muted">{e.subject}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const SUGGESTIONS = ['Fewer categories, please', 'Which ones should be high-stakes?', 'Merge the two smallest categories'];

function Setup(props: { s: State; color: Map<string, number>; onChat: (m: string) => void; onToggleHighStakes: (n: string) => void; onApprove: () => void; onRediscover: () => void }) {
  const { s, color } = props;
  const [msg, setMsg] = useState('');
  const info = (name: string) => s.discovery?.categories.find((c) => c.name === name);
  const examples = (name: string) => (info(name)?.exampleIds ?? []).map((id) => INBOX.find((e) => e.id === id)?.subject).filter(Boolean);
  const send = (m: string) => {
    if (!m.trim()) return;
    props.onChat(m.trim());
    setMsg('');
  };
  return (
    <section className="setup">
      <div className="setup-cats">
        <div className="section-head">
          <div>
            <h2>Proposed categories</h2>
            <p className="muted small">In priority order: when two fit, the first one wins. High-stakes labels need more confidence.</p>
          </div>
          <button className="ghost small-btn" onClick={props.onRediscover}>
            <RotateCcw size={14} /> Re-run
          </button>
        </div>
        <ol className="cats">
          {s.taxonomy!.categories.map((c, i) => (
            <li key={c.name} className="card cat">
              <div className="cat-head">
                <span className="rank tabular">{i + 1}</span>
                <span className={`swatch c${color.get(c.name)}`} aria-hidden />
                <strong>{c.name}</strong>
                {info(c.name) && <span className="muted small tabular">{info(c.name)!.count} in sample</span>}
                <label className="switch">
                  <input type="checkbox" checked={c.highStakes} onChange={() => props.onToggleHighStakes(c.name)} />
                  <span className="track" aria-hidden />
                  <span className="small">High-stakes</span>
                </label>
              </div>
              <p>{c.description}</p>
              {examples(c.name).length > 0 && <p className="muted small examples">e.g. {examples(c.name).join(' · ')}</p>}
            </li>
          ))}
        </ol>
        {s.taxonomy!.senderRules.length > 0 && (
          <div className="rules small">
            <strong>Sender rules</strong> <span className="muted">(always applied, before the model)</span>
            <ul>
              {s.taxonomy!.senderRules.map((r) => (
                <li key={r.match + r.category}>
                  <code>{r.match}</code> → {r.category}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <aside className="chat card">
        <h2>Talk to the agent</h2>
        <div className="turns">
          {s.chat.map((t, i) => (
            <div key={i} className={`turn ${t.role}`}>
              {t.text}
            </div>
          ))}
        </div>
        <div className="chips">
          {SUGGESTIONS.map((q) => (
            <button key={q} className="chip-btn" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(msg);
          }}
        >
          <label className="sr-only" htmlFor="chat-input">Message the agent</label>
          <input id="chat-input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder='e.g. "Anything from @brightpath goes to Client escalation"' />
          <button className="primary icon-btn" aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </aside>

      <div className="approve-bar">
        <span className="muted small">
          {s.taxonomy!.categories.length} categories · {s.taxonomy!.categories.filter((c) => c.highStakes).length} high-stakes
        </span>
        <button className="primary" onClick={props.onApprove} disabled={!s.taxonomy!.categories.length}>
          {s.approved ? 'Back to the inbox' : 'Approve and label the inbox'} <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

type Filter = 'all' | 'eyes' | 'skipped' | string;

function InboxView(props: { s: State; color: Map<string, number>; onRun: () => void; onCorrect: (e: Email, d: Decision, label: string) => void; onLearn: () => void }) {
  const { s, color } = props;
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(s.decisions.map((d) => [d.emailId, d])), [s.decisions]);
  const ran = s.decisions.length > 0;
  const labeled = toActions(s.decisions).length;
  const eyes = s.decisions.filter((d) => d.needsEyes).length;
  const lastClassifyCost = [...s.log].reverse().filter((l) => l.task === 'classify');
  const runCost = lastClassifyCost.slice(0, Math.ceil(INBOX.length / 12)).reduce((t, l) => t + (l.costUsd ?? 0), 0);

  const shown = INBOX.filter((e) => {
    const d = byId.get(e.id);
    if (filter === 'all') return true;
    if (filter === 'eyes') return d?.needsEyes;
    if (filter === 'skipped') return d && !d.label;
    return d?.label === filter;
  });

  if (!ran)
    return (
      <section className="empty card">
        <InboxIcon size={28} className="muted" />
        <h2>Categories approved. Ready to label {INBOX.length} emails.</h2>
        <p className="muted">The agent gives every email one label or skips it, quotes the sentence it decided on, and puts anything urgent in a short "Needs your eyes" list. It never archives, sends or deletes.</p>
        <button className="primary big" onClick={props.onRun}>
          Run the agent <ArrowRight size={18} />
        </button>
      </section>
    );

  const count = (name: string) => s.decisions.filter((d) => d.label === name).length;
  return (
    <section>
      <div className="stats">
        <Stat label="Labeled" value={labeled} />
        <Stat label="Skipped" value={s.decisions.length - labeled} hint="Left for a human" />
        <Stat label="Needs your eyes" value={eyes} tone="warn" />
        <Stat label="Cost of this run" value={runCost ? money(runCost) : '—'} hint={s.corrections.length ? `Using ${s.corrections.length} of your corrections` : 'No corrections yet'} />
      </div>

      <div className="inbox">
        <aside className="labels" aria-label="Filter by label">
          <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')} icon={<InboxIcon size={15} />} label="All mail" n={INBOX.length} />
          <FilterBtn active={filter === 'eyes'} onClick={() => setFilter('eyes')} icon={<Eye size={15} />} label="Needs your eyes" n={eyes} />
          <FilterBtn active={filter === 'skipped'} onClick={() => setFilter('skipped')} icon={<CircleSlash size={15} />} label="Skipped" n={s.decisions.length - labeled} />
          <div className="labels-head small muted">Labels</div>
          {s.taxonomy!.categories.map((c) => (
            <FilterBtn key={c.name} active={filter === c.name} onClick={() => setFilter(c.name)} icon={<span className={`swatch c${color.get(c.name)}`} />} label={c.name} n={count(c.name)} />
          ))}
          <button className="ghost small-btn rerun" onClick={props.onRun}>
            <RotateCcw size={14} /> Run again
          </button>
        </aside>

        <div className="list card">
          {shown.length === 0 && <p className="muted pad">Nothing here.</p>}
          {shown.map((e) => {
            const d = byId.get(e.id);
            const cat = s.taxonomy!.categories.find((c) => c.name === d?.label);
            const isOpen = open === e.id;
            return (
              <article key={e.id} className={`mail ${isOpen ? 'open' : ''}`}>
                <button className="mail-row" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                  <span className="from">{e.from.name}</span>
                  <span className="subject-line">
                    <span className="subject">{e.subject}</span>
                    <span className="snip muted"> — {snippet(e)}</span>
                  </span>
                  <span className="tags">
                    {d?.needsEyes && (
                      <span className="flag" title={d.needsEyesReason ?? 'Needs your eyes'}>
                        <Eye size={13} />
                      </span>
                    )}
                    {d && <LabelChip cat={cat} idx={color.get(d.label ?? '')} />}
                  </span>
                  <span className="date muted small tabular">{shortDate(e.date)}</span>
                </button>
                {isOpen && (
                  <div className="detail">
                    {d && (
                      <div className="why">
                        <div className="why-head small">
                          <strong>{d.label ? `Why "${d.label}"` : 'Why it skipped'}</strong>
                          {d.source === 'sender-rule' && <span className="muted">sender rule</span>}
                          {d.source === 'model' && d.reason !== 'Corrected by you' && <Confidence value={d.confidence} high={!!cat?.highStakes} />}
                        </div>
                        <p>{d.reason}</p>
                        {d.needsEyesReason && (
                          <p className="small eyes-note">
                            <Eye size={13} /> {d.needsEyesReason}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="meta small muted">
                      From {e.from.name} &lt;{e.from.email}&gt; · {new Date(e.date).toLocaleString()}
                    </div>
                    <pre className="body">{e.body}</pre>
                    {d && (
                      <div className="fix">
                        <label htmlFor={`fix-${e.id}`} className="small">
                          Wrong label? Move it to
                        </label>
                        <select id={`fix-${e.id}`} value="" onChange={(ev) => ev.target.value && props.onCorrect(e, d, ev.target.value)}>
                          <option value="">Choose a label…</option>
                          {s.taxonomy!.categories.filter((c) => c.name !== d.label).map((c) => (
                            <option key={c.name}>{c.name}</option>
                          ))}
                        </select>
                        {s.corrections.some((c) => c.emailId === e.id) && (
                          <button className="link small" onClick={props.onLearn}>
                            Saved. See what the agent learns →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LabelChip({ cat, idx }: { cat?: Category; idx?: number }) {
  if (!cat) return <span className="chip skip">Skipped</span>;
  return (
    <span className={`chip c${idx}`}>
      {cat.name}
      {cat.highStakes && <span className="sr-only"> (high-stakes)</span>}
    </span>
  );
}

function Confidence({ value, high }: { value: number; high: boolean }) {
  const bar = high ? 0.85 : 0.6;
  return (
    <span className="conf" title={`Confidence ${Math.round(value * 100)}%. This label needs ${Math.round(bar * 100)}%.`}>
      <span className="conf-track">
        <span className="conf-fill" style={{ width: `${value * 100}%` }} />
        <span className="conf-bar" style={{ left: `${bar * 100}%` }} />
      </span>
      <span className="tabular">{Math.round(value * 100)}%</span>
    </span>
  );
}

function FilterBtn(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; n: number }) {
  return (
    <button className={`filter ${props.active ? 'active' : ''}`} onClick={props.onClick} aria-pressed={props.active}>
      {props.icon}
      <span className="filter-label">{props.label}</span>
      <span className="muted small tabular">{props.n}</span>
    </button>
  );
}

function Stat(props: { label: string; value: string | number; hint?: string; tone?: 'warn' }) {
  return (
    <div className={`card stat ${props.tone ?? ''}`}>
      <span className="muted small">{props.label}</span>
      <strong className="tabular">{props.value}</strong>
      {props.hint && <span className="muted small">{props.hint}</span>}
    </div>
  );
}

function Learn(props: { s: State; onPropose: () => void; onDecide: (p: Proposal, ok: boolean) => void }) {
  const { s } = props;
  const exportCases = () => {
    const cases = s.corrections.map((c) => ({ id: c.emailId, expected: c.corrected, needsEyes: false, note: `corrected from ${c.predicted ?? 'SKIP'}` }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' }));
    a.download = 'eval-extra.json';
    a.click();
  };
  const current = (name: string) => s.taxonomy!.categories.find((c) => c.name === name)?.description;
  return (
    <section className="learn">
      <div>
        <h2>Your corrections</h2>
        <p className="muted small">Each correction is used as an example on the next run, straight away. Bigger rule changes are proposed and wait for your approval.</p>
        {s.corrections.length === 0 ? (
          <div className="card empty-sm muted">No corrections yet. Open an email in the inbox and move it to the right label.</div>
        ) : (
          <ul className="corrections">
            {s.corrections.map((c) => (
              <li key={c.emailId} className="card">
                <strong>{c.subject}</strong>
                <span className="small">
                  <span className="muted strike">{c.predicted ?? 'Skipped'}</span> <ArrowRight size={12} /> {c.corrected}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.corrections.length > 0 && (
          <button className="ghost small-btn" onClick={exportCases}>
            Export as eval cases
          </button>
        )}
      </div>
      <div>
        <div className="section-head">
          <h2>What the agent learned</h2>
          <button className="primary small-btn" onClick={props.onPropose} disabled={!s.corrections.length}>
            <Lightbulb size={14} /> Propose rule changes
          </button>
        </div>
        {s.proposals.length === 0 && <div className="card empty-sm muted">{s.corrections.length ? 'Ask the agent to review your corrections.' : 'Proposals appear after you make a correction.'}</div>}
        {s.proposals.map((p, i) => (
          <div key={i} className="card proposal">
            <div className="row small">
              <span className="kind">{p.kind.replace(/_/g, ' ')}</span>
              <strong>{p.category}</strong>
            </div>
            {p.kind === 'edit_description' && current(p.category) ? (
              <div className="diff small">
                <p className="before">{current(p.category)}</p>
                <p className="after">{p.change}</p>
              </div>
            ) : (
              <p>{p.kind === 'add_sender_rule' ? <><code>{p.match}</code> → {p.category}</> : p.change}</p>
            )}
            <p className="muted small">{p.why}</p>
            <div className="row">
              <button className="primary small-btn" onClick={() => props.onDecide(p, true)}>
                <Check size={14} /> Approve
              </button>
              <button className="ghost small-btn" onClick={() => props.onDecide(p, false)}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Log({ log }: { log: RunLogEntry[] }) {
  const cost = log.reduce((t, l) => t + (l.costUsd ?? 0), 0);
  const tokens = log.reduce((t, l) => t + l.inputTokens + l.outputTokens, 0);
  return (
    <section>
      <h2>Run log</h2>
      <p className="muted small">Every model call, with the prompt version it used. Prompts change only after passing the eval.</p>
      <div className="stats">
        <Stat label="Model calls" value={log.length} />
        <Stat label="Tokens" value={tokens.toLocaleString()} />
        <Stat label="Total cost" value={money(cost)} />
      </div>
      {log.length === 0 ? (
        <div className="card empty-sm muted">No calls yet.</div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Task</th>
                <th>Prompt</th>
                <th>Model</th>
                <th className="num">Tokens in / out</th>
                <th className="num">Cost</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {[...log].reverse().map((l, i) => (
                <tr key={i}>
                  <td className="tabular">{new Date(l.at).toLocaleTimeString()}</td>
                  <td>{l.task}</td>
                  <td>
                    <code>{l.promptVersion}</code>
                  </td>
                  <td>{l.model}</td>
                  <td className="num tabular">
                    {l.inputTokens.toLocaleString()} / {l.outputTokens.toLocaleString()}
                  </td>
                  <td className="num tabular">{l.costUsd == null ? '—' : money(l.costUsd)}</td>
                  <td className="num tabular">{(l.ms / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
