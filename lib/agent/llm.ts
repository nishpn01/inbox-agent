import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunLogEntry } from './types.ts';

// One place for every model call: provider, model, JSON parsing, and the run log.
// Provider is OpenRouter. LLM_PROVIDER=claude-cli is a local-dev fallback that runs
// prompts through the Claude Code CLI so the agent can be tested before a key exists.

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

// A visitor's own OpenRouter key, set per request by the API route. Request-scoped,
// never stored or logged, so concurrent requests on one instance can't mix keys.
type Byok = { apiKey?: string; model?: string };
const byok = new AsyncLocalStorage<Byok>();
export const withKey = <T>(cfg: Byok, fn: () => Promise<T>) => byok.run(cfg, fn);

export type LlmResult<T> = { data: T; log: RunLogEntry };

export async function callJson<T>(task: string, promptVersion: string, system: string, user: string): Promise<LlmResult<T>> {
  const started = Date.now();
  const own = byok.getStore();
  const res = own?.apiKey
    ? await viaOpenRouter(system, user, own.apiKey, own.model || DEFAULT_MODEL)
    : process.env.LLM_PROVIDER === 'claude-cli'
      ? await viaClaudeCli(system, user)
      : await viaOpenRouter(system, user, process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_MODEL || DEFAULT_MODEL);
  return {
    data: parseJson<T>(res.text),
    log: { at: new Date().toISOString(), task, promptVersion, ms: Date.now() - started, ...res.usage },
  };
}

type Raw = { text: string; usage: Omit<RunLogEntry, 'at' | 'task' | 'promptVersion' | 'ms'> };

async function viaOpenRouter(system: string, user: string, key: string | undefined, model: string): Promise<Raw> {
  if (!key) throw new Error('No AI key. Add your OpenRouter key under Settings, or open the recorded run.');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Inbox Agent' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      usage: { include: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    usage: {
      model: j.model ?? model,
      inputTokens: j.usage?.prompt_tokens ?? 0,
      outputTokens: j.usage?.completion_tokens ?? 0,
      costUsd: j.usage?.cost ?? null,
    },
  };
}

async function viaClaudeCli(system: string, user: string): Promise<Raw> {
  const { spawn } = await import('node:child_process');
  const model = process.env.CLAUDE_CLI_MODEL ?? 'haiku';
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', model, '--output-format', 'json', '--system-prompt', system], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`))));
    p.stdin.end(user);
  });
  const j = JSON.parse(out);
  return {
    text: j.result ?? '',
    usage: {
      model: `claude-cli/${model}`,
      inputTokens: (j.usage?.input_tokens ?? 0) + (j.usage?.cache_creation_input_tokens ?? 0) + (j.usage?.cache_read_input_tokens ?? 0),
      outputTokens: j.usage?.output_tokens ?? 0,
      costUsd: j.total_cost_usd ?? null,
    },
  };
}

/** Models sometimes wrap JSON in prose or code fences; take the outermost object. */
export function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}
