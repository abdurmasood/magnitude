---
name: recap
description: >-
  Use when the user has lost the thread, the conversation has gone off
  the rails, they no longer know what the discussion is about, or they
  invoke this skill.
disable-model-invocation: true
---

# Recap

Rebuild the thought process of this conversation: where it started, what changed the plan, what was decided, and where the last messages sit. Report, then stop.

## Process

1. Reread the whole conversation from the first message. If context was compacted, say early details may be missing, in one line before the recap.
2. If there is no question, finding, or decision, say there is nothing to recap and stop.
3. Write the recap in the structure below, then stop. Do not continue the discussion.

## Structure

Four sections, in this order. Labels on their own line. Indent the body two spaces. Indent a list under a line two more. Replace every angle-bracket slot. Never print the brackets.

```
WHERE WE STARTED
  "<the original ask, in the user's words>"

WHAT <THING> SHOWED
  <fact that changed the plan>
  <gap> · <gap> · <gap>
  → <one sentence: what that means, and what the real bottleneck is>

WHAT WE LANDED ON INSTEAD
  <what it is not, then what it is>
    <concrete piece> · <concrete piece> · <concrete piece>
  → <what the current work is actually about>

WHERE WE ARE NOW
  <the open fork, if there is one>:
    (a) <path>
    (b) <path>
  The last few messages were detail inside (<which path>).
```

- `<THING>` is what was actually examined: the data, the code, the design. One or two words.
- Drop `INSTEAD` when the original ask was not replaced. The label is then `WHAT WE LANDED ON`.
- Drop the `(a)` / `(b)` fork when there is only one path. Say where things stand in one line.
- The last line always starts with `The last few messages were`. It places those messages inside the bigger picture, including when they were a tangent.
- Each `→` line is the point of its section. One sentence.

## Rules

- The reasoning chain, not a transcript and not a list of topics.
- Every line traces to something said in the conversation. If you can't point to it, drop it.
- Quote the user only in WHERE WE STARTED, and only the original ask.
- Name concrete things. Join peers with ` · `.
- Write to the user, second person.
- About 15 lines. No advice, no next step, no offer to continue.
- Write the recap as markdown, not inside a code block. The recap is the whole reply.

## Example

A conversation that started as training a model on assay data, then drifted into pretraining:

```
WHERE WE STARTED
  "Can we train our own small language model on our assay data?"

WHAT THE DATA SHOWED
  17 molecules tested across 4 targets, enzyme assays only
  0 cell assays · no structures stored · results sitting in free-text comments
  → nothing trainable yet. The bottleneck is data, not models.

WHAT WE LANDED ON INSTEAD
  Not a language model. Three small models you'd train in-house:
    re-ranker · false-signal flag · cell predictor
  → that's what the page explains

WHERE WE ARE NOW
  Two ways to get from 17 to enough:
    (a) start recording properly, so your own data accumulates
    (b) pretrain on public data, for a head start while you collect
  The last few messages were detail inside (b).
```
