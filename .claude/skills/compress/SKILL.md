---
name: compress
description: >-
  Rewrite answers so line 1 says what kind of reply it is (DECIDE, NEED,
  DONE or EXPLAIN), the layout matches that kind, and every reply ends
  with the user's next step. Stays on for the rest of the session. Use
  when the user asks for shorter or more readable answers, or invokes
  this skill.
disable-model-invocation: true
argument-hint: "[text to rewrite; omit to rewrite the previous reply]"
---

# Compress

Rewrite your previous answer in the shape below. Then write every later reply in the same shape until the user turns it off.

If the user passed text with the command, rewrite that text instead of your previous answer.

## Pick the kind

Every reply is exactly one kind, and line 1 starts with its tag:

| Tag | Use when |
|---|---|
| `DECIDE` | the user has to choose between options |
| `NEED` | you are blocked until the user gives you something |
| `DONE` | you finished work and are reporting it |
| `EXPLAIN` | you are answering a question and there is nothing to choose |

When a reply fits more than one kind, use the first that fits in this order: DECIDE, NEED, DONE, EXPLAIN. Fold the rest into that layout. A small yes/no left over after finished work does not make the reply DECIDE: keep it DONE and list the question as a ○ item marked `← yours`.

## Layouts

### DECIDE

```
DECIDE  <the question, as a question>

A  <option>   <trade-off>   ← I'd pick
B  <option>   <trade-off>

Why A: <one line>

Your next step  reply A or B. Until then I change nothing.
Ask me about    1 <topic> · 2 <topic>
```

- 2 to 4 options, lettered A to D, one line each. Mark exactly one with `← I'd pick`.

### NEED

```
NEED  <what you are blocked on>

<one line on what it blocks>

Your next step  <exactly what to send or do>
```

### DONE

```
DONE  <the result in one line>

✓ <finished item>
✗ <item that failed>
○ <item left open on purpose>   ← yours | mine

Your next step  <the step, or "none">
Ask me about    1 <topic> · 2 <topic>
```

- ✗ is only for failures. Anything you stopped before on purpose, such as a commit or a deploy, is ○.
- Mark a ○ item `← yours` when the user acts or decides next, and `← mine` when you will do it without them.

### EXPLAIN

```
EXPLAIN  **<the answer in one sentence>**

<the why: a cause chain, an ASCII diagram, one code block with only the changed lines, or up to 3 bullets>

Your next step  <the step, or "none">
Ask me about    1 <topic> · 2 <topic>
```

## Rules for every layout

- Line 1 is the tag, then one sentence of at most 20 words.
- `Your next step` is always there. Write `none` when the user has nothing to do. When you can do the step yourself, end it with `, or say "<short command>" and I will`. It is one line: with two steps, join them with `, then ` in the order to do them.
- `Ask me about` is optional: up to 4 numbered topics of 2 to 6 words each. Everything you know but did not show goes here.
- Options use letters and topics use numbers. Never number options.
- Cite code as `path:line`.
- The whole reply fits on one screen: about 12 lines, plus any diagram, table, or code block.

## Follow-ups

- The user replies with a letter: act on that option.
- The user replies with a number: answer that `Ask me about` topic as a new reply in the same shape.
- The user says "stop compressing" or "/compress off": reply with one line confirming it is off, then write later replies in your normal style.

## Where it applies

Replies to the user in chat. Files, code, commit messages, and pull request bodies keep their own format. When another skill gives an exact report format, use that format for its report, then continue in this shape.

## Examples

The user asks why CI fails when the build passes locally:

````
EXPLAIN  **CI fails because the lockfile is missing `zod`.**

```
package.json:24 adds zod
        │  lockfile not regenerated
        ▼
npm ci sees the mismatch → exits 1
```

Locally `npm install` rewrites the lockfile, so the build passes.

Your next step  run `npm install` and commit the lockfile, or say "fix it" and I will
Ask me about    1 stop this happening again · 2 why `npm ci` is strict
````

The user asks how to stop it happening again:

```
DECIDE  How should we catch lockfile drift?

A  CI lockfile check   fails the PR · one step      ← I'd pick
B  pre-push hook       earlier · slows every push
C  nothing             this repeats

Why A: a hook can be skipped with `--no-verify`; CI can't.

Your next step  reply A, B or C. Until then I change nothing.
Ask me about    1 how the CI check works · 2 hook setup
```

The user says "fix it":

```
DONE  Lockfile fixed. Not committed yet.

✓ `package-lock.json` now includes `zod`
✓ `npm ci && npm test` pass
○ commit                                 ← yours

Your next step  commit it, or say "commit" and I will
Ask me about    1 lockfile diff · 2 add the CI check
```
