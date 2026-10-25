// Records one real run (discover, then classify) for the demo's "recorded run" button,
// so visitors without an AI key can still see real output. Re-run after prompt changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { classify, discover } from '../lib/agent/agent.ts';
import type { Email } from '../lib/agent/types.ts';

const inbox: Email[] = JSON.parse(readFileSync('data/demo-inbox.json', 'utf8'));
const d = await discover(inbox);
const taxonomy = { categories: d.result.categories.map(({ name, description, highStakes }) => ({ name, description, highStakes })), senderRules: d.result.senderRules };
const c = await classify(inbox, taxonomy);
const recordedAt = new Date().toISOString();
writeFileSync('data/sample-run.json', JSON.stringify({ recordedAt, discovery: d.result, taxonomy, decisions: c.decisions, log: [...d.log, ...c.log] }, null, 2));
console.log(`recorded ${c.decisions.length} decisions, ${taxonomy.categories.length} labels, model ${c.log[0]?.model}`);
