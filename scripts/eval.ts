// Eval gate. Classifies the demo inbox against the reference taxonomy and scores it.
// Run before shipping any prompt or threshold change: `npm run eval`.
// Optional: data/eval-extra.json (corrections exported from the app) adds cases.

import { existsSync, readFileSync } from 'node:fs';
import { classify } from '../lib/agent/agent.ts';
import type { Email, Taxonomy } from '../lib/agent/types.ts';

type Case = { id: string; expected: string; acceptable?: string[]; needsEyes: boolean; note?: string };

const GATES = { accuracy: 0.8, highStakesPrecision: 0.95, needsEyesRecall: 0.8, needsEyesPrecision: 0.6 };

const inbox: Email[] = JSON.parse(readFileSync('data/demo-inbox.json', 'utf8'));
const set: { taxonomy: Taxonomy['categories']; labels: Case[] } = JSON.parse(readFileSync('data/eval-set.json', 'utf8'));
const extra: Case[] = existsSync('data/eval-extra.json') ? JSON.parse(readFileSync('data/eval-extra.json', 'utf8')) : [];
const cases = new Map([...set.labels, ...extra].map((c) => [c.id, c]));
const taxonomy: Taxonomy = { categories: set.taxonomy, senderRules: [] };
const highStakes = new Set(set.taxonomy.filter((c) => c.highStakes).map((c) => c.name));

const { decisions, log } = await classify(inbox.filter((e) => cases.has(e.id)), taxonomy);

let correct = 0, hsLabeled = 0, hsCorrect = 0, eyesExpected = 0, eyesCaught = 0, eyesFlagged = 0, skips = 0;
const misses: string[] = [];
const eyesMissed: string[] = [];
for (const d of decisions) {
  const c = cases.get(d.emailId)!;
  const got = d.label ?? 'SKIP';
  const ok = got === c.expected || (c.acceptable ?? []).includes(got);
  if (ok) correct++;
  else misses.push(`${d.emailId}  expected ${c.expected}, got ${got}  (${d.reason})`);
  if (!d.label) skips++;
  if (d.label && highStakes.has(d.label)) {
    hsLabeled++;
    if (ok) hsCorrect++;
  }
  if (d.needsEyes) eyesFlagged++;
  if (c.needsEyes) {
    eyesExpected++;
    if (d.needsEyes) eyesCaught++;
    else eyesMissed.push(`${d.emailId}  ${c.note ?? ''}`);
  }
}

const score = {
  accuracy: correct / decisions.length,
  highStakesPrecision: hsLabeled ? hsCorrect / hsLabeled : 1,
  needsEyesRecall: eyesExpected ? eyesCaught / eyesExpected : 1,
  // A queue that flags everything stops being read, same as a polluted high-stakes label.
  needsEyesPrecision: eyesFlagged ? eyesCaught / eyesFlagged : 1,
};
const cost = log.reduce((s, l) => s + (l.costUsd ?? 0), 0);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

console.log(`\nInbox agent eval — ${decisions.length} emails, model ${log[0]?.model}, ${log[0]?.promptVersion}`);
console.log(`  Accuracy               ${pct(score.accuracy)}   (gate ${pct(GATES.accuracy)})`);
console.log(`  High-stakes precision  ${pct(score.highStakesPrecision)}   (gate ${pct(GATES.highStakesPrecision)}, ${hsCorrect}/${hsLabeled})`);
console.log(`  Needs-your-eyes recall ${pct(score.needsEyesRecall)}   (gate ${pct(GATES.needsEyesRecall)}, ${eyesCaught}/${eyesExpected})`);
console.log(`  Needs-your-eyes precision ${pct(score.needsEyesPrecision)} (gate ${pct(GATES.needsEyesPrecision)}, ${eyesCaught}/${eyesFlagged})`);
console.log(`  Skipped                ${skips}`);
console.log(`  Cost                   $${cost.toFixed(4)} across ${log.length} calls, ${log.reduce((s, l) => s + l.ms, 0) / 1000}s`);
if (misses.length) console.log(`\nMisses:\n  ${misses.join('\n  ')}`);
if (eyesMissed.length) console.log(`\nUrgent but not flagged:\n  ${eyesMissed.join('\n  ')}`);

const failed = (Object.keys(GATES) as (keyof typeof GATES)[]).filter((k) => score[k] < GATES[k]);
if (failed.length) {
  console.log(`\nFAIL: ${failed.join(', ')} below gate`);
  process.exit(1);
}
console.log('\nPASS');
