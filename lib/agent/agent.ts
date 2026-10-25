import { callJson } from './llm.ts';
import { CLASSIFY_SYSTEM, DISCOVER_SYSTEM, PROMPT_VERSION, PROPOSE_SYSTEM, REFINE_SYSTEM } from './prompts.ts';
import { redact, senderForModel } from './redact.ts';
import { cleanTaxonomy, enforce, matchSenderRule } from './rules.ts';
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
  return { result: { categories, senderRules: data.senderRules ?? [], questions: data.questions ?? [], assignments }, log: [log] };
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

  // Sender rules are unconditional and run in code, before the model sees anything.
  for (const e of emails) {
    const rule = matchSenderRule(e, taxonomy);
    if (rule) decisions.push({ emailId: e.id, label: rule.category, confidence: 1, reason: `Sender rule: ${rule.match}`, needsEyes: false, source: 'sender-rule' });
    else toModel.push(e);
  }

  const examples = corrections.slice(-30).map((c) => ({ from: c.from, subject: redact(c.subject), snippet: redact(c.snippet), wrong: c.predicted, correct: c.corrected }));

  for (let i = 0; i < toModel.length; i += BATCH) {
    const batch = toModel.slice(i, i + BATCH);
    const { data, log: entry } = await callJson<{ decisions: Omit<Decision, 'source'>[] }>(
      'classify',
      PROMPT_VERSION.classify,
      CLASSIFY_SYSTEM,
      JSON.stringify({ categories: taxonomy.categories, pastCorrections: examples, emails: batch.map((e) => forModel(e)) }),
    );
    log.push(entry);
    const byId = new Map((data.decisions ?? []).map((d) => [d.emailId, d]));
    for (const e of batch) decisions.push(enforce(byId.get(e.id), e.id, taxonomy));
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
