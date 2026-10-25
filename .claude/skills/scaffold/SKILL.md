---
name: scaffold
description: Use when the user has agreed what to build and wants the module boundaries, interfaces, and folder layout decided before planning or implementation.
disable-model-invocation: true
---

# Scaffold

Decide where the code lives and how the parts connect. This is a gate after `/calibrate` and before any plan or code exists: report, then stop.

Build the structure for the future. Build the features for now.

## Mode

Decide the mode from the repo before anything else. State it in one line at the top of the report.

- **New project** — no meaningful source and no established layout. A README, license, or config file is not a layout.
- **Existing project** — there is source or a real folder structure to follow. A partly-built repo is this mode once any real structure exists.

No third mode. If it is genuinely unclear which applies, ask and stop.

## The Rubric

1. **Expensive now** — how the system splits into parts, the interfaces between them, which of those are a stable public contract, the folder layout, where tests live.
2. **Cheap later** — extra features, config options, plugin systems. Do not add them until they're needed.
3. **Not this skill** — speculative features, configurability, plugin registries, CI, contributor docs. Those clash with Simplicity First.
4. **Follow the house** — in existing-project mode, put new code where that responsibility already lives. Do not invent a parallel layout.

## Process

1. Restate the job in a few sentences: what it does, inputs, outputs, what is out of scope. If something blocking is unclear, ask and stop.
2. Name the distinct responsibilities. Each becomes a module. No module reads another's internals.
3. Define the interfaces between them: signatures, data shapes, errors. Mark each public/stable or internal.
4. Propose the folder layout.
   - **New project:** choose it from scratch. Pick one or two patterns below that match the job, not all of them. Name them in Layout.
   - **Existing project:** read the existing tree. Show where the new code goes. No catch-all `utils`. Patterns are not needed.
5. Describe the thinnest end-to-end working version, then the next steps as small ordered increments, each with a verify check.
6. Write the report in the exact structure below, then stop.

## Patterns worth copying

New-project mode only. Pick the one or two that match the job.

- **Thin CLI over a library** (ripgrep) — the command is a thin layer over a library crate. Fits a CLI that others will also call as a library.
- **Small focused packages** (Go standard library) — small interfaces, no catch-all utils. Fits work that splits into focused units.
- **Core vs optional** (Linux) — split by folder; never break the user-facing interface. Fits a stable surface with optional internals.
- **Stable contract plus heavy tests** (SQLite) — a file format or public API that cannot drift.
- **Self-contained feature apps** (Django) — each feature owns its models, views, and tests.

## Scale

- A small change in an existing project: brief report. Place the code in the module that already owns that responsibility. Skip a new tree.
- A new project, a new system, or a change that crosses modules: full report.
- If `/scaffold` ran earlier in this conversation, keep the mode line first, then one line naming what changed since, then rewrite the report.

## Report

When something blocking is unclear:

```
**Mode**: new project | existing project

**NOT READY**: <what blocks>

1. <blocking question>
2. <blocking question>

Reply by number, e.g. "<short sample answers>", then run /scaffold again.
```

When the structure is proposed:

```
**Mode**: new project | existing project

**PROPOSED**: <what is being structured, in a few words>

**Job**
<what it does, inputs, outputs, out of scope. A few sentences.>

**Modules**
- <name> — <one responsibility>
- <name> — <one responsibility>

**Interfaces**
- <signature or data shape> — public | internal
- <error> — public | internal

**Layout**
<indented tree, or where the new files go in the existing tree>

**Walking skeleton**
1. <step> → verify: <check>
2. <step> → verify: <check>

**Next increments**
3. <step> → verify: <check>
4. <step> → verify: <check>

**Likely later** (not built now)
- <need> — would plug in at <module or interface>

Approve this structure, or reply with changes and run /scaffold again.
```

Leave out any section that would be empty. Drop the **Mode** line only when the mode itself is the question. For a small change, keep Job, Layout, and Walking skeleton. Drop the rest if they add nothing.

## Rules

- Report only: no implementation plan beyond the increments, no code, no files written, no offer to implement.
- Writing to the tree is not allowed. In existing-project mode, reading it is required.
- Do not invent features, config, plugins, CI, or contributor docs "while we're here".
- Public means callers outside this change will depend on it. Everything else is internal.
- A module that needs another module's internals is the wrong split. Redraw it.
- `utils`, `helpers`, and `common` are not modules. Put code with the responsibility that owns it.
- In existing-project mode, the existing tree wins. Show insertions, not a redesign, unless the current layout cannot hold the new responsibility.
- In new-project mode, pick the one or two patterns that match the job. Do not stack all five.
- Each increment is independently verifiable: a test, a command, an observable result.
- **Likely later** names the hook, not the implementation. If you cannot name where it plugs in, drop it.
- Write the report as markdown, not inside a code block.
- The last line of the response is the approval line, or the `Reply by number` line when NOT READY.
