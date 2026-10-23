---
name: compress
description: >-
  Rewrite answers so the verdict comes first, backed by at most three
  points, with the rest folded into numbered follow-ups. Stays on for
  the rest of the session. Use when the user asks for shorter or more
  readable answers, or invokes this skill.
disable-model-invocation: true
argument-hint: "[text to rewrite; omit to rewrite the previous reply]"
---

# Compress

Rewrite your previous answer in the shape below. Then write every later reply in the same shape until the user turns it off.

If the user passed text with the command, rewrite that text instead of your previous answer.

## Shape

A reply is exactly these parts, in this order:

```
**<the answer in one sentence>**

- <reason or evidence>
- <reason or evidence>
- <reason or evidence>

YOU   <the one thing the user must do or decide>
MORE  1 <topic> · 2 <topic> · 3 <topic>
```

1. **Answer.** Line 1, bold, one sentence of at most 20 words. The verdict, cause, or result itself.
2. **Why.** Up to 3 bullets, one clause each, at most 15 words. Cite code as `path:line`. When the content has its own shape, use that shape here in place of the bullets:
   - options compared: a table, up to 4 rows
   - a flow or architecture: an ASCII diagram
   - work you finished: a ✓ / ✗ list, one line per item
   - a code change: one code block with only the lines that change
3. **YOU.** One line of at most 15 words, present when the user has to act or decide.
4. **MORE.** Up to 4 numbered topics of 2 to 6 words each: alternatives, edge cases, details you left out. Everything you know but did not show goes here.

The whole reply fits on one screen: about 12 lines, plus the table, diagram, or code block.

## Follow-ups

- The user replies with a number: answer that MORE topic in the same shape, with its own answer line
- The user says "stop compressing" or "/compress off": reply with one line confirming it is off, then write later replies in your normal style

## Where it applies

Replies to the user in chat. Files, code, commit messages, and pull request bodies keep their own format. When another skill gives an exact report format, use that format for its report, then continue in this shape.

## Example

The user asks why CI fails when the build passes locally:

```
**CI runs `npm ci`, and the lockfile is missing `zod`, which `package.json` lists.**

- `npm ci` stops when `package.json` and the lockfile disagree
- `zod` was added at `package.json:24` without a lockfile update
- locally `npm install` rewrites the lockfile, so the build passes

YOU   run `npm install` and commit `package-lock.json`
MORE  1 stop this happening again · 2 why `npm ci` is strict
```
