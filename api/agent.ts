import { classify, discover, proposeRules, refine } from '../lib/agent/agent.ts';
import { withKey } from '../lib/agent/llm.ts';

// One serverless endpoint: POST { action, ...args }. The browser holds the state
// (taxonomy, corrections). A visitor's own OpenRouter key arrives in the
// x-openrouter-key header and is used for that request only.

const MAX_EMAILS = 100;

export async function POST(req: Request): Promise<Response> {
  const apiKey = req.headers.get('x-openrouter-key') ?? undefined;
  const model = req.headers.get('x-openrouter-model') ?? undefined;
  return withKey({ apiKey, model }, () => handle(req));
}

async function handle(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    if (Array.isArray(body.emails) && body.emails.length > MAX_EMAILS) return json({ error: `At most ${MAX_EMAILS} emails per request` }, 400);
    switch (body.action) {
      case 'discover':
        return json(await discover(body.emails));
      case 'refine':
        return json(await refine(body.taxonomy, body.history ?? [], String(body.message ?? '').slice(0, 2000)));
      case 'classify':
        return json(await classify(body.emails, body.taxonomy, body.corrections ?? []));
      case 'propose':
        return json(await proposeRules(body.taxonomy, body.corrections ?? []));
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
