# Magnitude CLI — Design

- **Date:** 2026-10-19
- **Status:** Approved 2026-10-19
- **Interactive sketch of the flow:** https://claude.ai/artifact/GGevQ4vEbW6AtrdV4Z87Sy

## Intent

Magnitude is an agent coding framework. Django is opinions about how to build a web app; Magnitude is opinions about how to work with a coding agent. Each opinion ships as a skill — a folder with a `SKILL.md` — and together they form one workflow:

```
discuss ──► /calibrate ──► plan ──► implement ──► /slice-commits ──► /open-pr ──► /merge-prs
            ▲                        ▲
            gate before building     coding-principles (loads automatically while coding)
```

The CLI exists so anyone can put these skills into a project with one command, for whichever agents they use: Claude Code, Cursor, Codex, or any mix.

## Goals (v1)

- `npx @magnitudeai/cli init` installs the chosen skills for the chosen agents.
- Works for any mix of Claude Code, Cursor and Codex in one run.
- Never writes anything without showing the full file list and getting a yes.
- Never overwrites a user's existing skill without asking.
- Fully scriptable with flags, for CI.

## Non-goals (v1)

- `magnitude update`, or remembering answers between runs.
- Writing `CLAUDE.md` / `AGENTS.md` or hooks into projects.
- Links between folders (we copy).
- Any agent beyond Claude Code, Cursor and Codex.

## Anti-goals (a failure even if it technically works)

- Writing files the user didn't see listed first.
- Silently replacing a skill the user wrote or edited.
- The same skill showing up twice in an agent when that was avoidable.
- Needing anything besides Node to run.
- Creating or touching a `.cursor/` folder.

## Package

| | |
|---|---|
| npm package | `@magnitudeai/cli` (org `magnitudeai`, owner `arafeymasood`) |
| Command | `magnitude` (`bin` field) |
| Language | TypeScript, compiled to ESM JavaScript |
| Node | 20 or newer *(my call)* |
| Skills | Bundled inside the npm package (`files: ["dist", "skills"]`). One release ships CLI and skills together; works offline after download |

Repo layout after this work:

```
magnitude/
├── skills/            ← source of truth, shipped in the package
├── src/               ← CLI code
├── test/
├── docs/specs/
├── package.json
├── tsconfig.json
├── README.md  LICENSE  CLAUDE.md  EXAMPLES.md
```

## `magnitude init` — the flow

### 1. Detect

Before asking anything, find the project root and look for agent folders.

- **Project root:** the git repository root if inside one, otherwise the current directory *(my call — Codex reads `.agents/skills` at the repo root, and skills should land in one predictable place)*.
- **Detection:** `.claude/` → Claude Code; `.cursor/` → Cursor; `.agents/` or `AGENTS.md` or `.codex/` → Codex *(Codex signals are my call)*.

Detected agents are pre-ticked in step 2.

### 2. Agents — multi-select

```
◆  Which agents do you use? (space to toggle, enter to confirm)
│  ◼ Claude Code   found .claude/
│  ◼ Cursor        found .cursor/
│  ◻ Codex
└
```

At least one must be ticked.

### 3. Scope — single choice

- **This project** (default): under the project root, shared with the team via git.
- **Global:** under the home folder, applies to every project on this machine.

### 4. Skills — multi-select

All bundled skills listed with their description, all ticked by default. At least one must be ticked.

Skills are discovered at runtime by reading `skills/*/SKILL.md` frontmatter (`name`, `description`, `disable-model-invocation`). Adding a skill to the repo needs no CLI code change.

### 5. Existing skills — ask before replacing

For each chosen skill whose folder already exists in a target folder:

- If the existing folder's contents are identical to ours, skip it silently *(my call)*.
- Otherwise ask, per skill: **No, keep mine** (default) / **Yes, replace**.

**Duplicates the CLI didn't cause — warn only** *(my call)*. For each ticked agent, scan every folder that agent reads (project and global: `.claude/skills`, `.agents/skills`, `.cursor/skills` and their home-folder equivalents) that is *not* a target of this run. If a chosen skill's name already exists there, warn: "Cursor will also load `.agents/skills/calibrate`". Never modify those folders: that would break "fewest folders" and "never write what wasn't listed".

### 6. Review — confirm before writing

Show every folder to be written, which agents read it, the skill count per folder, and the total file count. Nothing touches the disk until **Yes**.

### 7. Write, then tell them what to try

- Copy each skill's whole folder (`SKILL.md` plus any supporting files).
- **Replace** means: delete the target skill folder, then copy, so no stale files linger.
- End with what to type first, per tool:
  - Claude Code / Cursor: `/calibrate`
  - Codex: `$calibrate`
  - If `calibrate` wasn't chosen, use the first chosen skill.

## Where skills go — the core rule

Write the **fewest folders that cover every ticked agent**. Facts behind the rule (checked 2026-10-19):

| Folder | Claude Code | Cursor | Codex |
|---|---|---|---|
| `.claude/skills/` | ✅ | ✅ (compatibility) | ❌ |
| `.agents/skills/` | ❌ | ✅ | ✅ (only skills folder Codex reads) |
| `.cursor/skills/` | ❌ | ✅ | ❌ |

Resulting table — every row is a required test case:

| Ticked | Project scope | Global scope |
|---|---|---|
| Claude | `.claude/skills` | `~/.claude/skills` |
| Cursor | `.agents/skills` | `~/.agents/skills` |
| Codex | `.agents/skills` | `~/.agents/skills` |
| Claude + Cursor | `.claude/skills` | `~/.claude/skills` |
| Cursor + Codex | `.agents/skills` | `~/.agents/skills` |
| Claude + Codex | `.claude/skills` + `.agents/skills` | `~/.claude/skills` + `~/.agents/skills` |
| All three | `.claude/skills` + `.agents/skills` ⚠ | `~/.claude/skills` + `~/.agents/skills` ⚠ |

⚠ Cursor reads both folders, so it may show each skill twice. Unverified — see Open checks. When both folders are written, they get two real copies.

## Codex: manual-only skills

Claude Code and Cursor read `disable-model-invocation: true` from `SKILL.md`. Codex ignores it and instead reads a file inside the skill folder:

```yaml
# <skill>/agents/openai.yaml
policy:
  allow_implicit_invocation: false
```

Rule: for every skill whose frontmatter has `disable-model-invocation: true`, write this file into **every** copy under `.agents/skills/`, whether or not Codex is ticked *(my call)*. Today that's `calibrate`, `slice-commits`, `open-pr` and `merge-prs`; `coding-principles` loads automatically and gets no file.

Why always: a project folder is shared through git, so a Cursor-only teammate's install must still behave correctly for Codex teammates. It also keeps "ours" stable: the expected contents of a skill folder depend only on the target folder, never on which agents were ticked. The file is harmless to Cursor.

**What "ours" means** for the identical-content check and for replace: the bundled skill folder, plus `agents/openai.yaml` when the target is `.agents/skills` and the skill is manual-only.

## Flags (non-interactive)

```
magnitude init [--agents claude,cursor,codex] [--skills all|name,name]
               [--global] [--replace | --keep-existing] [--yes]
magnitude --help | --version
```

- `--yes` skips every prompt. With `--yes`:
  - no `--agents` → use detected agents; if none detected, exit with an error asking for `--agents`.
  - no `--skills` → all skills.
  - no `--replace` / `--keep-existing` → keep existing *(safe default, my call)*.
- Any flag given without `--yes` pre-fills that answer and skips its question.
- Unknown agent or skill names → exit with an error listing the valid ones.
- Not a terminal (CI) and no `--yes` → exit with an error suggesting `--yes`.
- Cancel (Ctrl-C) at any prompt → exit without writing anything.

## Architecture

```
cli.ts      parse flags (node:util parseArgs), route to init
detect.ts   project root + which agent folders exist
skills.ts   read bundled skills and their frontmatter
prompts.ts  the questions (@clack/prompts)
plan.ts     answers + detected state → exact list of writes and conflicts   ← pure, no disk access
write.ts    review, confirm, perform the writes
```

`plan.ts` takes plain data in and returns plain data out. All folder-rule, conflict and Codex-file logic lives there and is tested without touching the disk.

## Tools

| Job | Choice |
|---|---|
| Prompts | `@clack/prompts` |
| Flags | `node:util` `parseArgs` (no dependency) |
| Frontmatter | a small YAML parser (builder's choice) |
| Build | `tsup` |
| Tests | `vitest` |

These are new dependencies; approving this document approves them.

## Testing

- **`plan.ts`, table-driven:** all 7 agent combinations × 2 scopes; Codex YAML present only for manual-only skills and only under `.agents/skills`; conflict detection; identical-content skip; replace vs keep.
- **Flags:** `--yes` defaults, error cases, invalid names.
- **Integration:** run `init --yes` against a temporary directory, assert the exact files written. Includes a pre-existing skill folder to prove keep/replace behavior.
- No network access in tests.

## Open checks (before publishing)

1. Cursor loads skills from project `.claude/skills/`. Two-minute manual test.
2. Cursor loads skills from global `~/.claude/skills/` and `~/.agents/skills/`. Its docs list `~/.cursor/skills` and `~/.agents/skills`; the Claude-folder compatibility may be project-only. If `~/.claude/skills` isn't read globally, the Claude + Cursor global row becomes `~/.claude/skills` + `~/.agents/skills`.
3. With both folders written, does Cursor show duplicates?
4. In Cursor, `disable-model-invocation: true` still allows typing `/calibrate`.

If a check fails, only the folder table in `plan.ts` and its tests change.

## Later (not v1)

- `magnitude update`, possibly remembering earlier answers.
- Writing `CLAUDE.md` / `AGENTS.md` and per-tool hooks.
- More agents.

## Where the build plan ends *(my call)*

**In the plan:** a locally working, tested package that `npm pack` produces correctly, plus updating the README "Install" section to match this design.

**Not in the plan:**
- Publishing. The author runs `npm publish --access public` by hand for v0.1.0, after the Open checks.
- CI and release automation (GitHub Actions, provenance). This needs separate approval under the author's rules.

## Repo housekeeping (separate from the CLI)

- Rewrite `CLAUDE.md` as the contributor guide (skill layout, test skills with subagents before committing, one copy of each rule). It's currently a copy of `coding-principles`.

## Decision log

| Decision | Why |
|---|---|
| Fresh repo `abdurmasood/magnitude`; old fork archived as `magnitude-fork` | Make it its own project, not a fork of the Karpathy repo |
| Package `@magnitudeai/cli`, command `magnitude` | Unscoped `magnitude` taken; `@magnitude` and `@magnitude-dev` orgs taken; avoids the author's name in the package |
| Own CLI instead of Vercel's `npx skills add` | Room to grow into `init` that also writes instructions and hooks |
| TypeScript | Native to npm; matches similar CLIs |
| Skills bundled in the package | Simple, offline, one release |
| Copies, not links | Works everywhere, including Windows |
| Fewest folders, never `.cursor/` | Cursor reads the Claude and agents folders; avoids duplicates |
| Ask before replacing | The user's own edits are never lost |
