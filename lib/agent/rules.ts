import type { Decision, Email, Proposal, Taxonomy } from './types.ts';

// Pure rules: no model calls, safe to run in the browser and in tests.

// Confidence bars. High-stakes labels hold rare, action-triggering mail; a wrong
// entry there costs trust, a skip costs a few seconds. So their bar is higher.
export const MIN_CONFIDENCE = 0.6;
export const MIN_CONFIDENCE_HIGH_STAKES = 0.85;
export function cleanTaxonomy(t: Taxonomy): Taxonomy {
  const seen = new Set<string>();
  const categories = (t.categories ?? [])
    .filter((c) => c?.name?.trim() && !seen.has(c.name) && seen.add(c.name))
    .map((c) => ({ name: c.name.trim(), description: (c.description ?? '').trim(), highStakes: !!c.highStakes }));
  const names = new Set(categories.map((c) => c.name));
  const senderRules = (t.senderRules ?? []).filter((r) => r?.match?.trim() && names.has(r.category));
  return { categories, senderRules };
}

export function matchSenderRule(email: Email, t: Taxonomy) {
  const addr = email.from.email.toLowerCase();
  return t.senderRules.find((r) => {
    const m = r.match.toLowerCase().trim();
    return m.startsWith('@') ? addr.endsWith(m) : addr === m;
  });
}

/** The model suggests; code decides. Unknown labels and low confidence become skips. */
export function enforce(d: Omit<Decision, 'source'> | undefined, emailId: string, t: Taxonomy): Decision {
  if (!d) return { emailId, label: null, confidence: 0, reason: 'No decision returned', needsEyes: true, needsEyesReason: 'Agent returned nothing for this email', source: 'model' };
  const cat = t.categories.find((c) => c.name === d.label);
  const confidence = Math.max(0, Math.min(1, Number(d.confidence) || 0));
  const base = { emailId, confidence, reason: d.reason ?? '', needsEyes: !!d.needsEyes, needsEyesReason: d.needsEyesReason || undefined, source: 'model' as const };
  if (!d.label) return { ...base, label: null };
  if (!cat) return { ...base, label: null, needsEyes: true, needsEyesReason: `Suggested a label that does not exist ("${d.label}")` };
  const bar = cat.highStakes ? MIN_CONFIDENCE_HIGH_STAKES : MIN_CONFIDENCE;
  if (confidence < bar) {
    return { ...base, label: null, needsEyes: base.needsEyes || cat.highStakes, needsEyesReason: base.needsEyesReason ?? `Probably "${cat.name}", not sure enough to file it` };
  }
  return { ...base, label: cat.name };
}

// ---------- Guardrail: the only write ----------

/** Applying a label is the only action this agent can produce. Nothing archives, sends, deletes or marks read. */
export type Action = { type: 'label'; emailId: string; label: string };

export function toActions(decisions: Decision[]): Action[] {
  return decisions.filter((d): d is Decision & { label: string } => !!d.label).map((d) => ({ type: 'label', emailId: d.emailId, label: d.label }));
}

/** Pure: apply an approved proposal to the taxonomy. */
export function applyProposal(t: Taxonomy, p: Proposal): Taxonomy {
  const categories = t.categories.map((c) => ({ ...c }));
  const cat = categories.find((c) => c.name === p.category);
  switch (p.kind) {
    case 'edit_description':
      if (cat) cat.description = p.change;
      break;
    case 'mark_high_stakes':
      if (cat) cat.highStakes = true;
      break;
    case 'add_category':
      if (!cat) categories.push({ name: p.category, description: p.change, highStakes: false });
      break;
    case 'add_sender_rule':
      if (p.match && cat) return { categories, senderRules: [...t.senderRules, { match: p.match, category: p.category }] };
  }
  return { categories, senderRules: t.senderRules };
}
