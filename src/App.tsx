import { Activity, ArrowRight, Check, CircleSlash, Eye, Inbox as InboxIcon, Lightbulb, Loader2, RotateCcw, Send, ShieldCheck, Sparkles, Tags } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
    run('Reading the inbox', ['Reading each email', 'Grouping similar emails', 'Suggesting labels', 'Noting what it is unsure about'], async () => {
      const { result, log } = await call<{ result: DiscoverResult }>('discover', { emails: INBOX });
      addLog(log);
      const taxonomy = { categories: result.categories.map(({ name, description, highStakes }) => ({ name, description, highStakes })), senderRules: result.senderRules };
      const intro =
        `I read ${INBOX.length} emails and suggest ${result.categories.length} labels.` +
        (result.questions.length ? `\n\nA few things I wasn't sure about:\n${result.questions.map((q) => `• ${q}`).join('\n')}` : '');
      patch({ discovery: result, taxonomy, approved: false, chat: [{ role: 'agent', text: intro }], decisions: [], proposals: [] });
    });

  const sendChat = (message: string) =>
    run('Updating labels', ['Reading your request', 'Making the change'], async () => {
      const history = [...s.chat, { role: 'user' as const, text: message }];
      patch({ chat: history });
      const { reply, taxonomy, log } = await call<{ reply: string; taxonomy: Taxonomy }>('refine', { taxonomy: s.taxonomy, history: s.chat, message });
      addLog(log);
      patch({ taxonomy, chat: [...history, { role: 'agent', text: reply }] });
    });

  const classifyNow = () =>
    run(`Sorting ${INBOX.length} emails`, ['Reading each email', 'Picking one label, or none if unsure', 'Using your past fixes', 'Flagging anything urgent'], async () => {
      const { decisions, log } = await call<{ decisions: Decision[] }>('classify', { emails: INBOX, taxonomy: s.taxonomy, corrections: s.corrections });
      addLog(log);
      patch({ decisions });
    });

  const proposeNow = () =>
    run('Looking at your fixes', ['Finding patterns', 'Writing suggestions'], async () => {
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
    if (confirm('Start over? This clears the labels and your fixes.')) {
      setS(EMPTY);
      setTab('setup');
    }
  };

  const steps: { id: Tab; label: string; done: boolean; enabled: boolean }[] = [
    { id: 'setup', label: 'Labels', done: s.approved, enabled: true },
    { id: 'inbox', label: 'Inbox', done: s.decisions.length > 0, enabled: s.approved },
    { id: 'learn', label: 'Fixes', done: false, enabled: s.approved },
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
            <p className="muted small">Sorts email into labels and learns from your fixes</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="badge" title="It can add labels. It cannot archive, send or delete.">
            <ShieldCheck size={14} /> Only adds labels
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
          <Activity size={14} /> Log
          {s.log.length > 0 && <span className="count">{s.log.length}</span>}
        </button>
      </nav>

      {error && (
        <div className="alert" role="alert">
          <strong>Something went wrong.</strong> {error}
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
        The demo emails are made up. Phone numbers, email addresses and links are removed before anything is sent to the AI.
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
      <p className="muted small">What it's doing</p>
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
    { icon: <Sparkles size={18} />, title: 'It suggests labels', text: 'It reads the inbox first and suggests labels that fit it.' },
    { icon: <Tags size={18} />, title: 'You adjust them', text: 'Rename, merge or add labels by asking in plain words.' },
    { icon: <Lightbulb size={18} />, title: 'It sorts and learns', text: 'Every email gets a label and a reason. Fix one and it remembers.' },
  ];
  return (
    <section className="intro">
      <p className="eyebrow">Demo with made-up emails</p>
      <h2 className="hero">Email sorting that fits your inbox</h2>
      <p className="lede muted">
        This inbox has {INBOX.length} made-up emails from a small staffing company: candidates, clients, timesheets, invoices, job board alerts and one phishing email. The agent reads them, suggests labels, and sorts the inbox. You can change anything it gets wrong.
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
        Start <ArrowRight size={18} />
      </button>
      <details className="peek">
        <summary className="muted small">See some of the emails first</summary>
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

const SUGGESTIONS = ['Use fewer labels', 'Which labels should be important?', 'Merge the two smallest labels'];

function Setup(props: { s: State; color: Map<string, number>; onChat: (m: string) => void; onToggleHighStakes: (n: string) => void; onApprove: () => void; onRediscover: () => void }) {
  const { s, color } = props;
  const [msg, setMsg] = useState('');
  const turnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    turnsRef.current?.scrollTo({ top: turnsRef.current.scrollHeight });
  }, [s.chat.length]);
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
            <h2>Suggested labels</h2>
            <p className="muted small">If an email fits two labels, the higher one wins. The agent has to be more sure before using an important label.</p>
          </div>
          <button className="ghost small-btn" onClick={props.onRediscover}>
            <RotateCcw size={14} /> Start again
          </button>
        </div>
        <ol className="cats">
          {s.taxonomy!.categories.map((c, i) => (
            <li key={c.name} className="card cat">
              <div className="cat-head">
                <span className="rank tabular">{i + 1}</span>
                <span className={`swatch c${color.get(c.name)}`} aria-hidden />
                <strong>{c.name}</strong>
                {info(c.name) && <span className="muted small tabular">{info(c.name)!.count} emails</span>}
                <label className="switch">
                  <input type="checkbox" checked={c.highStakes} onChange={() => props.onToggleHighStakes(c.name)} />
                  <span className="track" aria-hidden />
                  <span className="small">Important</span>
                </label>
              </div>
              <p>{c.description}</p>
              {examples(c.name).length > 0 && <p className="muted small examples">e.g. {examples(c.name).join(' · ')}</p>}
            </li>
          ))}
        </ol>
        {s.taxonomy!.senderRules.length > 0 && (
          <div className="rules small">
            <strong>Always</strong> <span className="muted">(emails from these senders get this label)</span>
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
        <h2>Ask for changes</h2>
        <div className="turns" ref={turnsRef}>
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
          <input id="chat-input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder='For example: "Put anything from @brightpath under Escalation"' />
          <button className="primary icon-btn" aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </aside>

      <div className="approve-bar">
        <span className="muted small">
          {s.taxonomy!.categories.length} labels · {s.taxonomy!.categories.filter((c) => c.highStakes).length} important
        </span>
        <button className="primary" onClick={props.onApprove} disabled={!s.taxonomy!.categories.length}>
          {s.approved ? 'Back to the inbox' : 'Use these labels'} <ArrowRight size={16} />
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
        <h2>Labels saved. Ready to sort {INBOX.length} emails.</h2>
        <p className="muted">Each email gets one label, or none if the agent isn't sure. Anything urgent shows up under Needs a look. It never archives, sends or deletes.</p>
        <button className="primary big" onClick={props.onRun}>
          Sort the inbox <ArrowRight size={18} />
        </button>
      </section>
    );

  const count = (name: string) => s.decisions.filter((d) => d.label === name).length;
  return (
    <section>
      <div className="stats">
        <Stat label="Labeled" value={labeled} />
        <Stat label="No label" value={s.decisions.length - labeled} hint="Left for you" />
        <Stat label="Needs a look" value={eyes} tone="warn" />
        <Stat label="Cost" value={runCost ? money(runCost) : '—'} hint={s.corrections.length ? `Used ${s.corrections.length} of your fixes` : 'No fixes yet'} />
      </div>

      <div className="inbox">
        <aside className="labels" aria-label="Filter by label">
          <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')} icon={<InboxIcon size={15} />} label="All mail" n={INBOX.length} />
          <FilterBtn active={filter === 'eyes'} onClick={() => setFilter('eyes')} icon={<Eye size={15} />} label="Needs a look" n={eyes} />
          <FilterBtn active={filter === 'skipped'} onClick={() => setFilter('skipped')} icon={<CircleSlash size={15} />} label="No label" n={s.decisions.length - labeled} />
          <div className="labels-head small muted">Labels</div>
          {s.taxonomy!.categories.map((c) => (
            <FilterBtn key={c.name} active={filter === c.name} onClick={() => setFilter(c.name)} icon={<span className={`swatch c${color.get(c.name)}`} />} label={c.name} n={count(c.name)} />
          ))}
          <button className="ghost small-btn rerun" onClick={props.onRun}>
            <RotateCcw size={14} /> Sort again
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
                      <span className="flag" title={d.needsEyesReason ?? 'Needs a look'}>
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
                          <strong>{d.label ? `Why ${d.label}` : 'Why no label'}</strong>
                          {d.source === 'sender-rule' && <span className="muted">always rule</span>}
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
                          Wrong label? Change to
                        </label>
                        <select id={`fix-${e.id}`} value="" onChange={(ev) => ev.target.value && props.onCorrect(e, d, ev.target.value)}>
                          <option value="">Choose a label…</option>
                          {s.taxonomy!.categories.filter((c) => c.name !== d.label).map((c) => (
                            <option key={c.name}>{c.name}</option>
                          ))}
                        </select>
                        {s.corrections.some((c) => c.emailId === e.id) && (
                          <button className="link small" onClick={props.onLearn}>
                            Saved. See what it learned →
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
  if (!cat) return <span className="chip skip">No label</span>;
  return (
    <span className={`chip c${idx}`}>
      {cat.name}
      {cat.highStakes && <span className="sr-only"> (important)</span>}
    </span>
  );
}

function Confidence({ value, high }: { value: number; high: boolean }) {
  const bar = high ? 0.85 : 0.6;
  return (
    <span className="conf" title={`${Math.round(value * 100)}% sure. This label needs ${Math.round(bar * 100)}%.`}>
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

const KIND: Record<Proposal['kind'], string> = { edit_description: 'Change rule', add_sender_rule: 'New always rule', mark_high_stakes: 'Mark important', add_category: 'New label' };

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
        <h2>Your fixes</h2>
        <p className="muted small">The agent uses each fix the next time it sorts. If it wants to change a label's rule, it asks first.</p>
        {s.corrections.length === 0 ? (
          <div className="card empty-sm muted">No fixes yet. Open an email in the inbox and change its label.</div>
        ) : (
          <ul className="corrections">
            {s.corrections.map((c) => (
              <li key={c.emailId} className="card">
                <strong>{c.subject}</strong>
                <span className="small">
                  <span className="muted strike">{c.predicted ?? 'No label'}</span> <ArrowRight size={12} /> {c.corrected}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.corrections.length > 0 && (
          <button className="ghost small-btn" onClick={exportCases}>
            Download as test cases
          </button>
        )}
      </div>
      <div>
        <div className="section-head">
          <h2>Suggested changes</h2>
          <button className="primary small-btn" onClick={props.onPropose} disabled={!s.corrections.length}>
            <Lightbulb size={14} /> Ask for suggestions
          </button>
        </div>
        {s.proposals.length === 0 && <div className="card empty-sm muted">{s.corrections.length ? 'Ask the agent what it learned from your fixes.' : 'Suggestions show up after you fix a label.'}</div>}
        {s.proposals.map((p, i) => (
          <div key={i} className="card proposal">
            <div className="row small">
              <span className="kind">{KIND[p.kind]}</span>
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
      <h2>Log</h2>
      <p className="muted small">Every call to the AI model, with its time and cost.</p>
      <div className="stats">
        <Stat label="AI calls" value={log.length} />
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
