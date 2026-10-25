import assert from 'node:assert/strict';
import { redact, senderForModel } from '../lib/agent/redact.ts';

const sig = 'Jasmine Okoye\nCell: (555) 010-0177\njasmine.okoye@mailbox.example\nhttps://www.linkedin.com/in/jasmine';
const out = redact(sig);
assert.ok(out.includes('Jasmine Okoye'), 'names stay');
assert.ok(!/0177|mailbox\.example|linkedin/.test(out), `contact details leaked: ${out}`);
assert.equal(redact('Call 555.010.0142 or +1 555 010 0142'), 'Call [phone] or [phone]');
assert.equal(redact('Invoice #2026-1043 for $1,250.00'), 'Invoice #2026-1043 for $1,250.00', 'numbers that are not phones survive');
assert.equal(senderForModel('noreply@portal.example'), 'noreply@portal.example');
assert.equal(senderForModel('tom@brightpath.example'), '[person]@brightpath.example');
console.log('redact: ok');
