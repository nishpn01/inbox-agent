# Inbox Agent

Sorts email into labels that fit your inbox, and learns from your fixes. It only adds labels. It never archives, sends or deletes.

This is a web version of the labeling agent I run on my own Gmail every morning. Mine has labels hard-coded for a job search. This one reads the inbox first and suggests its own, so it works for any inbox. The demo runs on 48 made-up emails from a small staffing company.

## How it works

1. It reads the inbox and suggests labels.
2. You adjust them by asking in plain words.
3. It labels every email and says why. Anything it isn't sure about stays unlabeled for you.
4. When you fix a label, it uses that fix next time. If it wants to change a rule, it asks first.

![Labeled demo inbox](docs/screenshots/3-inbox.png)

More screenshots: [suggested labels](docs/screenshots/2-setup.png), [why it chose a label](docs/screenshots/4-email-detail.png), [suggested changes after a fix](docs/screenshots/5-learn.png).

## Status

Working prototype. Tested with Claude Haiku through the Claude Code CLI. Not deployed yet, and not connected to Gmail.

## Test results

48 made-up emails, with expected labels drafted by AI. Run it with `npm run eval`.

| Check | Result | Must be at least |
|---|---|---|
| Correct label | 94% | 80% |
| Important labels that were right | 100% | 95% |
| Urgent emails it flagged | 90% | 80% |
| Flags that were really urgent | 95% | 60% |

The first version flagged 32 of 48 emails as urgent. The last check was added to catch that.

## Run it

```bash
npm install
cp .env.example .env.local   # add an OpenRouter key
npm run dev
```

## Layout

| Path | Contents |
|---|---|
| `lib/agent/` | The agent: prompts, rules, and the AI call |
| `api/agent.ts` | The one server endpoint |
| `src/` | The web app |
| `data/` | Demo emails and expected labels |
| `scripts/` | Tests |
| `docs/architecture.md` | How it's built |
