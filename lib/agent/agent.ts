import { callJson } from './llm.ts';
import { CLASSIFY_SYSTEM, DISCOVER_SYSTEM, PROMPT_VERSION, PROPOSE_SYSTEM, REFINE_SYSTEM } from './prompts.ts';
import { redact, senderForModel } from './redact.ts';
import { cleanTaxonomy, enforce, findCategory, matchSenderRule } from './rules.ts';
import type { ChatTurn, Correction, Decision, DiscoverResult, Email, Proposal, RunLogEntry, Taxonomy } from './types.ts';

const BATCH = 12;

function forModel(e: Email, maxBody = 1500) {
  return {
    id: e.id,
    from: `${e.from.name} <${senderForModel(e.from.email)}>`,
    date: e.date,
    subject: redact(e.subject),
    body: redact(e.body).slice(0, maxBody),
  };
}

// ---------- Step 0: discover ----------

export async function discover(emails: Email[]): Promise<{ result: DiscoverResult; log: RunLogEntry[] }> {
  const sample = emails.slice(0, 100).map((e) => forModel(e, 600));
  type Raw = Omit<DiscoverResult, 'categories'> & { categories: (DiscoverResult['categories'][number])[] };
  const { data, log } = await callJson<Raw>('discover', PROMPT_VERSION.discover, DISCOVER_SYSTEM, JSON.stringify({ emails: sample }));
  const assignments = data.assignments ?? {};
  // Counts come from the assignments, not from the model's own arithmetic.
  const categories = (data.categories ?? []).map((c) => ({
    name: c.name,
    description: c.description,
    highStakes: !!c.highStakes,
    count: Object.values(assignments).filter((a) => a === c.name).length,
    exampleIds: (c.exampleIds ?? []).slice(0, 3),
  }));
  // A domain is not a classifier: keep a proposed sender rule only if every sample email
  // it matches landed in the same category. One client who sends both a complaint and a
  // routine request must not get a rule.
  const senderRules = (data.senderRules ?? []).filter((r) => {
    const hits = emails.filter((e) => matchSenderRule(e, { categories: [], senderRules: [r] })).map((e) => assignments[e.id]);
    return hits.length >= 2 && hits.every((a) => a === r.category);
  });
  // The user never sees email ids; models still write them ("(e04)") despite the prompt.
  const ids = new Set(emails.map((e) => e.id));
  const questions = (data.questions ?? []).map((q) => q.replace(/\s*\(?\b([\w-]+)\b\)?/g, (m, id) => (ids.has(id) ? '' : m)));
  return { result: { categories, senderRules, questions, assignments }, log: [log] };
}

// ---------- Onboarding chat ----------

export async function refine(taxonomy: Taxonomy, history: ChatTurn[], message: string) {
  const { data, log } = await callJson<{ reply: string; taxonomy: Taxonomy }>(
    'refine',
    PROMPT_VERSION.refine,
    REFINE_SYSTEM,
    JSON.stringify({ current: taxonomy, conversation: history.slice(-10), userMessage: message }),
  );
  return { reply: data.reply, taxonomy: cleanTaxonomy(data.taxonomy ?? taxonomy), log: [log] };
}

// ---------- Daily run: classify ----------

export async function classify(emails: Email[], taxonomy: Taxonomy, corrections: Correction[] = []) {
  const decisions: Decision[] = [];
  const log: RunLogEntry[] = [];
  const toModel: Email[] = [];

  // A label the user fixed stays fixed, and skips the model. Everything else goes to the
  // model, including sender-rule mail, so urgent mail from a ruled sender still gets flagged.
  const fixed = new Map(corrections.map((c) => [c.emailId, c.corrected]));
  for (const e of emails) {
    const fix = findCategory(taxonomy, fixed.get(e.id));
    if (fix) decisions.push({ emailId: e.id, label: fix.name, confidence: 1, reason: 'You set this label', needsEyes: false, source: 'correction' });
    else toModel.push(e);
  }

  const examples = corrections.slice(-30).map((c) => ({ from: c.from, subject: redact(c.subject), snippet: redact(c.snippet), wrong: c.predicted, correct: c.corrected }));

  for (let i = 0; i < toModel.length; i += BATCH) {
    const batch = toModel.slice(i, i + BATCH);
    const input = JSON.stringify({ categories: taxonomy.categories, pastCorrections: examples, emails: batch.map((e) => forModel(e)) });
    let result: Awaited<ReturnType<typeof callJson<{ decisions: Omit<Decision, 'source'>[] }>>> | null = null;
    // One bad batch (timeout, broken JSON) shouldn't sink the run: retry once, then leave that batch for a human.
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await callJson('classify', PROMPT_VERSION.classify, CLASSIFY_SYSTEM, input);
      } catch (err) {
        if (attempt === 1) console.error('classify batch failed', err);
      }
    }
    if (result) log.push(result.log);
    const byId = new Map((result?.data.decisions ?? []).map((d) => [d.emailId, d]));
    for (const e of batch) {
      const d = enforce(byId.get(e.id), e.id, taxonomy);
      const rule = matchSenderRule(e, taxonomy);
      // The rule decides the label; the model still decides whether it needs a look.
      decisions.push(rule ? { ...d, label: rule.category, confidence: 1, reason: `Always rule: ${rule.match}. ${d.reason}`.trim(), source: 'sender-rule' } : d);
    }
  }

  const order = new Map(emails.map((e, i) => [e.id, i]));
  decisions.sort((a, b) => order.get(a.emailId)! - order.get(b.emailId)!);
  return { decisions, log };
}

// ---------- Learn: propose rule changes from corrections ----------

export async function proposeRules(taxonomy: Taxonomy, corrections: Correction[]) {
  if (!corrections.length) return { proposals: [] as Proposal[], log: [] as RunLogEntry[] };
  const { data, log } = await callJson<{ proposals: Proposal[] }>(
    'propose',
    PROMPT_VERSION.propose,
    PROPOSE_SYSTEM,
    JSON.stringify({ taxonomy, corrections: corrections.slice(-50).map((c) => ({ ...c, subject: redact(c.subject), snippet: redact(c.snippet) })) }),
  );
  return { proposals: (data.proposals ?? []).slice(0, 4), log: [log] };
}
