export type Email = {
  id: string;
  from: { name: string; email: string };
  to?: string;
  date: string;
  subject: string;
  body: string;
};

export type Category = {
  name: string;
  description: string;
  /** Rare, action-triggering labels. The agent needs higher confidence and skips when unsure. */
  highStakes: boolean;
};

/** An unconditional rule: mail from this sender always gets this label, whatever it says. */
export type SenderRule = { match: string; category: string };

/** Categories are listed in priority order: when two fit, the earlier one wins. */
export type Taxonomy = { categories: Category[]; senderRules: SenderRule[] };

export type Correction = {
  emailId: string;
  from: string;
  subject: string;
  snippet: string;
  predicted: string | null;
  corrected: string;
};

export type Decision = {
  emailId: string;
  /** null means the agent skipped: left unlabeled for a human. */
  label: string | null;
  confidence: number;
  reason: string;
  needsEyes: boolean;
  needsEyesReason?: string;
  source: 'sender-rule' | 'model';
};

export type Proposal = {
  kind: 'edit_description' | 'add_sender_rule' | 'mark_high_stakes' | 'add_category';
  category: string;
  change: string;
  why: string;
  /** Filled in for add_sender_rule. */
  match?: string;
};

export type DiscoverResult = {
  categories: (Category & { count: number; exampleIds: string[] })[];
  senderRules: SenderRule[];
  questions: string[];
  assignments: Record<string, string>;
};

export type ChatTurn = { role: 'user' | 'agent'; text: string };

export type RunLogEntry = {
  at: string;
  task: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  ms: number;
};
