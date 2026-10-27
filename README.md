# Inbox Agent

An AI agent that sorts an inbox into labels that fit it, explains every label, and learns from your corrections.

**[Try the live demo](https://inbox-agent-tan.vercel.app)** · Press "See a recorded run" to look around without an API key.

![The agent sorting a staffing company's inbox](docs/screenshots/3-inbox.png)

## Why I built it

I run a version of this agent on my own Gmail every morning. Important emails, like interview invites and assessments, used to get lost under job alerts and newsletters. Now every email gets a label, and I can see what needs me at a glance.

My version has labels hard-coded for a job search. This one reads the inbox first and suggests its own labels, so it works for any team. The demo runs on 49 made-up emails from a small staffing company.

## How it works

1. **It suggests labels.** The agent reads the inbox and proposes labels that fit it, in priority order. It also asks about anything it wasn't sure of.
2. **You adjust them.** Rename, merge or add labels by asking in plain words. You also choose which labels are important.
3. **It sorts the inbox.** Each email gets one label and the sentence the label was based on. Urgent emails are flagged. Anything it isn't sure about stays unlabeled for you.
4. **It learns.** A label you fix stays fixed. The agent uses your fixes as examples next time, and it asks before changing any of its rules.

## Results

Tested on all 49 emails against a set of expected labels. I re-run these checks after every prompt change.

| Check | Gemini 2.5 Flash | Claude Haiku | Must reach |
|---|---|---|---|
| Correct label | 100% | 94% | 80% |
| Important labels that were right | 9 of 9 | 6 of 6 | 95% |
| Urgent emails it flagged | 90% | 100% | 80% |
| Flags that were really urgent | 95% | 91% | 60% |

A full run on Gemini costs about $0.01. Raw output: [docs/eval-results.md](docs/eval-results.md).

The checks caught two real problems. The first version flagged 32 of 48 emails as urgent, which makes the flag useless, so I added the last check. Then the rule I wrote to fix it made Gemini skip automated alerts, like a sign-in warning, and in one run only 57% of urgent emails were flagged. Rewriting the rule brought that back to 90%.

## Design decisions

- **It can only add labels.** Archive, send and delete don't exist in the code, so no prompt can trigger them. A wrong label takes seconds to fix. A wrong archive is easy to miss.
- **The AI suggests, the code decides.** A label that doesn't exist, or one the AI isn't confident about, becomes "no label." Important labels need more confidence than the rest.
- **Emails are treated as data.** One test email tells the AI how to label it. The agent ignores the instruction and flags the email.
- **Private details stay out of the AI.** Phone numbers, email addresses and links are removed before any email is sent to the model.
- **Visitors use their own key.** The live demo holds no API key. A visitor's OpenRouter key stays in their browser and is sent only with their own requests.

## Built with

| | |
|---|---|
| Agent | TypeScript, prompts with version numbers, an eval script with pass/fail gates |
| Models | Gemini 2.5 Flash through OpenRouter (live demo), Claude Haiku through the Claude Code CLI (local testing) |
| App | React 19, Vite, one Vercel serverless function |
| Tools | Claude Code, GitHub, Vercel |

I designed the agent and built it with Claude Code over a weekend. The labeling rules come from the agent I run on my own inbox.

## Limitations

- **Small test set.** 49 made-up emails, and the expected labels were drafted by AI. It catches regressions, but it isn't a benchmark.
- **Scores vary between runs.** The same model can move a few points from one run to the next.
- **Only the sorting is tested.** The eval doesn't measure how good the suggested labels are, and that part varies more between models.
- **Confidence is the model's own estimate.** The thresholds of 60% and 85% are judgment calls, not measured.
- **Not connected to a real inbox yet.** The demo uses sample data.

## What's next

Connect it to Gmail and run it on a daily schedule, with the morning report posted where the team already works, like Slack.

## Run it locally

```bash
npm install
cp .env.example .env.local   # add an OpenRouter key, or set LLM_PROVIDER=claude-cli
npm run dev                  # the app
npm run eval                 # the checks above
npm test                     # guardrail tests
```

| Path | What's there |
|---|---|
| `lib/agent/` | The agent: prompts, rules and the AI call |
| `api/agent.ts` | The one server endpoint |
| `src/` | The web app |
| `data/` | Demo emails, expected labels and the recorded run |
| `scripts/` | Eval, tests, and the script that records the sample run |
| `docs/` | [How it's built](docs/architecture.md), eval output and screenshots |

MIT License · [Pranish (Nish) Pakwan](https://linkedin.com/in/nish-p01)
