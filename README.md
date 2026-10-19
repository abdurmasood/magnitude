# Magnitude

An agent coding framework. Skills and workflows for working with AI coding agents in Claude Code, Cursor and Codex.

## The workflow

```
discuss ──► /calibrate ──► plan ──► implement ──► /slice-commits ──► /open-pr ──► /merge-prs
                 │                      │
                 ▼                      ▼
       gate before building     coding-principles
                                loads automatically while coding
```

## Skills


| Skill               | What it does                                                                                                           | Runs                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `coding-principles` | Four rules for writing code: think before coding, keep it simple, make surgical changes, define how success is checked | Automatically, while coding |
| `calibrate`         | Rereads the conversation and reports what's unclear about the feature, and where the agent slipped, before you build   | When you call it            |
| `slice-commits`     | Splits a finished working tree into small, readable commits on the right branches, then pushes                         | When you call it            |
| `open-pr`           | Opens a pull request with a conventional title and a short What / Why body                                             | When you call it            |
| `merge-prs`         | Merges pull requests into main, including stacked sets, or closes them                                                 | When you call it            |


Call a skill with `/name` in Claude Code and Cursor, or `$name` in Codex.

## Install

Set up this project (no CLI left behind):

```
npx @magnitudeai/cli init
```

Or install the command, then set up:

```
npm i -g @magnitudeai/cli
magnitude init
```


| Flag                                   | What it does                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| `--agents claude,cursor,codex`         | Pick agents without being asked                                      |
| `--skills all` or `--skills name,name` | Pick skills without being asked                                      |
| `--global`                             | Put skills in your home folder instead of this project               |
| `--replace` / `--keep-existing`        | Overwrite or keep skills that already exist and differ               |
| `--yes`                                | Skip every prompt (uses detected agents, all skills, keeps existing) |


## Credits

`coding-principles` and `EXAMPLES.md` started from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) by Jiayuan Zhang and contributors, based on [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

## License

[MIT](LICENSE)