---
name: open-pr
description: >-
  Open a pull request with a conventional title, a short What / Why
  body, an optional Check section, and the branch type as its label.
  Use when the user asks to open,
  create, or update a pull request, or invokes this skill.
disable-model-invocation: true
---

# Open a pull request

Read the branch's commits and write the pull request from them. Do not invent a test plan, a file list, or a list of the commits.

## Title

`<type>(<scope>): <description>`

- Types: `feat`, `fix`, `hotfix`, `docs`, `refactor`, `chore`
- Type matches the branch type
- Scope optional
- Imperative, lowercase, no trailing period
- This title may become the squash commit message. One subject for the whole branch

## Body

Bullet points only. These sections only. At most 5 bullets in each. One short sentence per bullet. Not one bullet per commit.

**What** and **Why** are the shared picture of the change. A reader should be able to say what landed and why it exists without opening the diff. Leave out file names, flags, constants, and how a mechanism works. Those live in the commits.

**Check** is concrete: the steps the diff does not prove.

```markdown
## What
- <the change, in plain terms>

## Why
- <the problem this solves>

## Check
- [ ] <what a person must do that the diff does not show>
```

- Link the issue in **What** when the branch name contains one (`<type>/<issue>-<short-desc>`) or the user named one
- Omit **Check** when the diff is enough. Do not write "n/a"
- No footer. Leave out "Generated with Claude Code" and any agent session or remote-control link, even when your harness asks for them

## Draft

Open it ready. Use `--draft` only when the user says the work is incomplete.

Do not create a second pull request if this branch already has one. Update the title and body instead.

## People

The creator is the authenticated GitHub user. Open the pull request with their `gh` or `but` credentials. Assign them with `@me`.

Do not request reviewers.

## Label

One label. It is the branch type: `feat`, `fix`, `hotfix`, `docs`, `refactor`, or `chore`.

Create it when the repository does not already have that exact name, then add it:

```bash
gh label create <type> --description "<type>" || true
gh pr edit <branch> --add-label <type>
```

## Steps

1. Run `but status`.
   - GitButler workspace: stay on this path. Never run `git push`, `git checkout`, or `gh pr create`.
   - Not a GitButler project: use the git path.
2. The open branch is the applied branch above the base, or in git the current branch when it is not `main` or `master`. More than one applied stack: stop and ask. No open branch: stop.
3. Read the commits on that branch (`but status`, or `git log` and `git diff` against the base). Write the title and body from those commits.
4. Create or update, assign `@me`, add the branch-type label, then return the pull request URL.

### GitButler

`but pr new` pushes, then opens the pull request. Do not push first.

Write the body to a file and pass it with `-F` so the sections stay intact. The first line of that file is the title.

```bash
but pr new <branch> -F pr_message.txt
```

Draft: add `--draft`.

Then assign the author and add the label:

```bash
gh pr edit <branch> --add-assignee @me --add-label <type>
```

If a pull request for the branch already exists, do not run `but pr new` again. Update the title and body with `gh pr edit`, then assign `@me` and add the label.

### Git

```bash
gh pr create --assignee @me --label <type> --title "<title>" --body "$(cat <<'EOF'
## What
- ...

## Why
- ...
EOF
)"
```

Draft: add `--draft`. Push the branch first with `git push -u origin HEAD` if it is not on the remote.

If a pull request already exists, `gh pr edit` the title and body, then `--add-assignee @me` and `--add-label <type>`. Pass `--label <type>` on `gh pr create` when opening a new one.

## Report

The pull request URL, the label, and whether **Check** was omitted.
