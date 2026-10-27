# Eval results

Raw output of `npm run eval`, run on October 26, 2026 with prompt `classify@4`. The test set is 49 made-up emails in [`data/demo-inbox.json`](../data/demo-inbox.json), with expected labels in [`data/eval-set.json`](../data/eval-set.json). The expected labels were drafted by AI.

Results move a few points between runs of the same model, so read these as one sample, not a fixed score. The Haiku run went through the Claude Code CLI, so its cost includes the CLI's own overhead.

## Gemini 2.5 Flash, through OpenRouter

```
Inbox agent eval — 49 emails, model google/gemini-2.5-flash, classify@4
  Accuracy               100%   (gate 80%)
  High-stakes precision  100%   (gate 95%, 9/9)
  Needs-your-eyes recall 90%   (gate 80%, 19/21)
  Needs-your-eyes precision 95% (gate 60%, 19/20)
  Skipped                1
  Cost                   $0.0142 across 5 calls, 21.055s

Urgent but not flagged:
  e15  Posting expires in 3 days; time-sensitive but automated.
  e38  Start date change; candidate may have given notice.

PASS
```

## Claude Haiku, through the Claude Code CLI

```
Inbox agent eval — 49 emails, model claude-cli/haiku, classify@4
  Accuracy               94%   (gate 80%)
  High-stakes precision  100%   (gate 95%, 6/6)
  Needs-your-eyes recall 100%   (gate 80%, 21/21)
  Needs-your-eyes precision 91% (gate 60%, 21/23)
  Skipped                3
  Cost                   $0.0595 across 5 calls, 94.961s

Misses:
  e02  expected Interviews & Scheduling, got Client Requests  ("I would like to meet both of them on a video call this Tuesday, Oct 27 at 2:00pm")
  e21  expected Interviews & Scheduling, got Client Requests  ("Can we do a quick call Thursday at 3:00pm Central" to onboard two office admins starting Nov 2.)
  e44  expected Interviews & Scheduling, got SKIP  ("Does Wednesday, Oct 28 at 11:00am Eastern work for you?" quarterly check-in call)

PASS
```
