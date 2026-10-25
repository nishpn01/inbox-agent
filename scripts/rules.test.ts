import assert from 'node:assert/strict';
import { applyProposal, enforce, findCategory, matchSenderRule, toActions } from '../lib/agent/rules.ts';
import type { Taxonomy } from '../lib/agent/types.ts';

const t: Taxonomy = {
  categories: [
    { name: 'Escalations', description: 'Unhappy clients', highStakes: true },
    { name: 'Billing', description: 'Invoices', highStakes: false },
  ],
  senderRules: [{ match: '@payroll.example', category: 'Billing' }],
};
const d = (label: string | null, confidence: number) => ({ emailId: 'x', label, confidence, reason: 'r', needsEyes: false });

assert.equal(enforce(d('Billing', 0.7), 'x', t).label, 'Billing');
assert.equal(enforce(d('Escalations', 0.7), 'x', t).label, null, 'high-stakes needs a higher bar');
assert.equal(enforce(d('Escalations', 0.7), 'x', t).needsEyes, true, 'a high-stakes skip is flagged');
assert.equal(enforce(d('Escalations', 0.9), 'x', t).label, 'Escalations');
assert.equal(enforce(d('Made Up', 0.99), 'x', t).label, null, 'unknown labels become skips');
assert.equal(enforce(d('  billing ', 0.7), 'x', t).label, 'Billing', 'case and spacing drift still matches');
assert.equal(findCategory(t, 'escalations')?.name, 'Escalations');
assert.equal(enforce(undefined, 'x', t).needsEyes, true, 'missing decisions are flagged');

const email = { id: 'x', from: { name: 'P', email: 'ap@payroll.example' }, date: '', subject: '', body: '' };
assert.equal(matchSenderRule(email, t)?.category, 'Billing');

const actions = toActions([{ ...d('Billing', 1), source: 'model' }, { ...d(null, 0), source: 'model' }]);
assert.deepEqual(actions, [{ type: 'label', emailId: 'x', label: 'Billing' }], 'labeling is the only action');

const t2 = applyProposal(t, { kind: 'add_sender_rule', category: 'Escalations', change: '', why: '', match: '@angry.example' });
assert.equal(t2.senderRules.length, 2);
assert.equal(t.senderRules.length, 1, 'applyProposal does not mutate');
console.log('rules: ok');
