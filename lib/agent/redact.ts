// Contact details never go to the model (SimplyCareer backlog #31).
// Names stay: the agent needs "who" to classify, not how to reach them.

const PATTERNS: [RegExp, string][] = [
  [/https?:\/\/\S+/gi, '[link]'],
  [/www\.\S+/gi, '[link]'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  [/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]'],
];

export function redact(text: string): string {
  return PATTERNS.reduce((t, [re, sub]) => t.replace(re, sub), text);
}

/** Sender address is kept as its domain only: enough for "is this a noreply / a client domain". */
export function senderForModel(email: string): string {
  const [local, domain] = email.split('@');
  const automated = /^(no-?reply|donotreply|alerts?|notifications?|system|automated|mailer-daemon)/i.test(local);
  return `${automated ? local : '[person]'}@${domain}`;
}
