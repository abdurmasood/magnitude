---
name: calibrate
description: Use when the user has finished discussing a feature or change and wants to check the conversation is ready before planning or implementation.
disable-model-invocation: true
---

# Calibrate

Audit the conversation so far — the feature AND your own behavior — against the four guidelines below. This is a gate before any plan or code exists: report, then stop.

## The Rubric

1. **Think Before Coding** — assumptions stated, ambiguities surfaced, simpler options raised, confusion named.
2. **Simplicity First** — only what was asked. No speculative features, abstractions, or configurability.
3. **Surgical Changes** — the code to be touched is known. Nothing adjacent gets "improved".
4. **Goal-Driven Execution** — success is verifiable: a test, a command, an observable result.

## Process

1. Reread the whole conversation from the first message. If context was compacted, say early details may be missing.
2. If no feature or change has been discussed, say there is nothing to calibrate and stop.
3. If `/calibrate` ran earlier in this conversation, mark each earlier gap as closed (quote the answer) or still open.
4. Run every required check below.
5. Write the report in the exact structure below, then stop.

## Required Checks

Each check appears in the report, either as a gap or under **Settled** with a quote.

**Part 1 — The feature**
- Scope: what is in, and what is explicitly out
- Ambiguous words: anything that could reasonably mean two things
- Unstated assumptions: things both sides seem to take for granted
- Blast radius: which files or modules change
- Success criteria: how we will verify it works. Missing = blocking.

**Part 2 — Claude's behavior** (check every Claude message)
- Claims about the codebase not backed by reading the code in this conversation
- Agreement or praise without raising trade-offs
- Choices made silently where the user could reasonably want otherwise
- Additions beyond what the user asked: frameworks, extra formats, future-proofing
- Moving on while a question was still unanswered

## Report

```
CALIBRATION — <feature in a few words>
Verdict: READY | NOT READY (<n> blocking)

Part 1 — The feature
  1. [<guideline>] [blocking|minor] <gap>
     evidence: "<quote from the conversation>"
     question: <question for the user>

Part 2 — Claude's behavior
  1. [<guideline>] [blocking|minor] <slip>
     evidence: "<quote of Claude's own words>"
     fix: <what must happen, e.g. read X to verify, or user decides Y>

Settled
  - <decision> — "<quote where the user stated or agreed to it>"

Weakest point: <the single biggest risk, even when READY>

Next: <answer the questions above, then run /calibrate again> | <Ready.>
```

## Rules

- Every item quotes the conversation. No quote, no item.
- "Sounds good" settles only what was explicitly stated, not what was implied.
- Blocking = would change what gets built or how it is verified. Everything else is minor.
- READY only with zero blocking items.
- Raise alternatives as questions. The user decides; calibrate never picks a design.
- Report only: no plan, no code, no file reads, no offer to implement.
- The `Next:` line is the last line of the response.
