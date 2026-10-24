# Magnitude

A set of skills for improving a code writing flow (driven by agents) by an order of magnitude. Usable with Claude Code, Cursor and Codex.

## Workflow

```
discuss ──► /calibrate ──► /scaffold ──► plan ──► implement ──► /slice-commits ──► /open-pr ──► /merge-prs
                 │              │
                 ▼              ▼
       gate before building   structure before code
```

`magnitude init` writes coding principles into `AGENTS.md`. When `CLAUDE.md` is already there, it appends the same text to that file too.

## Install

Install the cli globally, then set up **(reccomended)**:

```
npm i -g @magnitudeai/cli
magnitude init
```

Update that global install, and refresh Magnitude skills in projects where you have already run `magnitude init`:

```
magnitude update
```

Or set up in project (no CLI left behind):

```
npx @magnitudeai/cli init
```

## Skills


| Skill           | What it does                                                                                                         | Runs             |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `calibrate`     | Rereads the conversation and reports what's unclear about the feature, and where the agent slipped, before you build | When you call it |
| `scaffold`      | Decides where the code lives and how the parts connect, then stops for approval before any plan or code              | When you call it |
| `slice-commits` | Splits a finished working tree into small, readable commits on the right branches, then pushes                       | When you call it |
| `open-pr`       | Opens a pull request with a conventional title and a short What / Why body                                           | When you call it |
| `merge-prs`     | Merges pull requests into main, including stacked sets, or closes them                                               | When you call it |
| `compress`      | Rewrites answers so the verdict comes first, with numbered follow-ups for the rest, and keeps that shape all session | When you call it |


Call a skill with `/name` in Claude Code and Cursor, or `$name` in Codex.

## Credits

Coding principles started from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) by Jiayuan Zhang and contributors, based on [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

## License

[MIT](LICENSE)