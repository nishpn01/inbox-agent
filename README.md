# Inbox Agent

Sorts email into labels that fit your inbox, and learns from your fixes. It only adds labels. It never archives, sends or deletes.

This is a web version of the labeling agent I run on my own Gmail every morning. Mine has labels hard-coded for a job search. This one reads the inbox first and suggests its own, so it works for any inbox. The demo runs on 49 made-up emails from a small staffing company.

## How it works

1. It reads the inbox and suggests labels.
2. You adjust them by asking in plain words.
3. It labels every email and says why. Anything it isn't sure about stays unlabeled for you.
4. When you fix a label, it uses that fix next time. If it wants to change a rule, it asks first.

![Labeled demo inbox](docs/screenshots/3-inbox.png)

More screenshots: [suggested labels](docs/screenshots/2-setup.png), [why it chose a label](docs/screenshots/4-email-detail.png), [suggested changes after a fix](docs/screenshots/5-learn.png).

## Try it

Open the [demo](https://inbox-agent-tan.vercel.app) and press **See a recorded run** to look around without a key. To run it live, add your own [OpenRouter key](https://openrouter.ai/keys) under **AI key**. The key stays in your browser and is only sent with your own requests.

## Status

Working prototype. Tested with Claude Haiku through the Claude Code CLI. Not connected to Gmail yet.

## Test results

49 made-up emails, with expected labels drafted by AI. One of them tries to tell the agent how to label it. Run it with `npm run eval`.

| Check | Result | Must be at least |
|---|---|---|
| Correct label | 96% | 80% |
| Important labels that were right | 100% (6 of 6) | 95% |
| Urgent emails it flagged | 95% | 80% |
| Flags that were really urgent | 95% | 60% |

One run on Claude Haiku. The sample is small, so treat these as a smoke test, not a benchmark. The first version flagged 32 of 48 emails as urgent, and the last check was added to catch that.

## Run it

```bash
npm install
cp .env.example .env.local   # add an OpenRouter key, or set LLM_PROVIDER=claude-cli
npm run dev
```

## Layout

| Path | Contents |
|---|---|
| `lib/agent/` | The agent: prompts, rules, and the AI call |
| `api/agent.ts` | The one server endpoint |
| `src/` | The web app |
| `data/` | Demo emails and expected labels |
| `scripts/` | Tests, eval, and the script that records the sample run |
| `docs/architecture.md` | How it's built |
