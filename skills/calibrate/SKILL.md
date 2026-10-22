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
3. If `/calibrate` ran earlier in this conversation, open the report with one line naming the earlier questions now answered, by their old numbers. Questions still open go back in the list.
4. Run every required check below.
5. Write the report in the exact structure below, then stop.

## Required Checks

Run every check. Only gaps appear in the report. Checks that pass are not listed, except as the one **Agreed** line in a READY report.

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

Group findings by who acts, not by check:
- A gap in the feature → a question for the user.
- A choice you made silently, an addition the user didn't ask for, agreement without raising a trade-off, or a question you moved past → a question for the user, in your own voice: "I suggested --json for CI. You didn't ask for it. Keep it or drop it?"
- A claim about the codebase you made without reading the code → **I'll fix before planning**, naming what you will read.

When anything blocks:

```
**NOT READY**: <what blocks, e.g. "3 questions block this">

1. <blocking question>
2. <blocking question>

**Worth deciding** (won't block)
3. <minor question>

**I'll fix before planning**
- <unverified claim, and what you will read to check it>

Reply by number, e.g. "<short sample answers>", then run /calibrate again.
```

When nothing blocks:

```
**READY**: <what is agreed, in a few words>

Agreed: <decision> · <decision> · <decision>

Biggest risk: <the single biggest risk>
```

Leave out any section that would be empty.

## Rules

- Every item must trace to something said in the conversation. If you can't point to it, drop it.
- Don't print quotes. The exception is when the exact wording is the gap: then quote just those words.
- "Sounds good" settles only what was explicitly stated, not what was implied.
- Blocking = would change what gets built or how it is verified. Everything else is minor.
- READY only when no question blocks and nothing is listed under **I'll fix before planning**.
- Write each question so it can be answered in a few words.
- Raise alternatives as questions. The user decides; calibrate never picks a design.
- Report only: no plan, no code, no file reads, no offer to implement.
- Write the report as markdown, not inside a code block.
- The last line of the response is the `Reply by number` line, or `Biggest risk` when READY.
