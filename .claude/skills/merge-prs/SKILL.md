---
name: merge-prs
description: >-
  Merge GitHub pull requests into main, including a stacked set, or close
  them without merging. Use when the user asks to merge, land, or close
  pull requests into main, or invokes this skill.
disable-model-invocation: true
---

# Merge pull requests into main

Merge with `gh`. Do not merge with `but`, `git merge`, or `git push`.

A stack is merged with one request, on its top pull request. The calls below are the ones that worked. Do not try the others.

## Never call

These fail. A 403 or 404 from one of them is not a reason to invent another URL.

- `gh pr merge` on a pull request whose `stack` field is set. GraphQL refuses stacked pull requests.
- `PUT /repos/{owner}/{repo}/pulls/{number}/merge` returns 403 on a stack.
- `POST /repos/{owner}/{repo}/pulls/{number}/merge` returns 404.
- `POST /repos/{owner}/{repo}/stacks/{number}/merge` returns 404.
- Do not search docs, introspect GraphQL, or probe the API for a merge route.

If the tool runner blocks the merge and asks the user to approve it, send that same command again for approval. Do not change the URL.

## See what is open

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
gh pr list --state open --json number,title,baseRefName,headRefName
```

For each open number:

```bash
gh api repos/{owner}/{repo}/pulls/{number} --jq '{number,base:.base.ref,stack}'
```

`stack` is either `null` or `{number, position, size}`. Position 1 is the bottom and targets `main`. The highest position is the top.

Group them:

- One stack: one merge, on the top pull request. That merges every open pull request below it into `main`.
- `"stack": null` and base `main`: merge it on its own, after every stack.
- The user named specific pull requests: merge only those. Merging one in the middle of a stack also merges the open ones below it. The ones above it stay open. Say so.

## Merge a stack

Call this once, on the top pull request only:

```bash
gh api --method PUT repos/{owner}/{repo}/pulls/{top}/merge-async \
  -f merge_method=merge \
  -f merge_action=direct_merge
```

- `merge` keeps the commits. Use it unless the user says squash or rebase.
- `direct_merge` merges now. Do not leave `merge_action` off.
- A 202 with `"status":"pending"` and a `uuid` means the merge was accepted. It is not finished.

Wait, then read each pull request in that stack:

```bash
gh pr view {number} --json state,mergedAt,url
```

Every one of them should be `MERGED`. If any is still `OPEN`, read the queued result once:

```bash
gh api repos/{owner}/{repo}/pulls/{top}/merge-async/{uuid}
```

`failed` means stop and report `details.message`. Do not send a different merge call.

## Merge a pull request that is not in a stack

Do this only after the stacks are merged, and only for a pull request whose `stack` is `null`:

```bash
gh pr merge {number} --merge
```

If GitHub says it cannot merge, stop and report that. Do not retarget, rebase, or force it.

## Confirm

```bash
gh pr list --state open --json number,title
```

The list should be empty, or only the pull requests the user did not ask to merge.

## Close without merging

Use this only when the user asked to close, not merge.

```bash
gh pr close {number}
```

Close each named pull request. Do not call `merge-async`.

## Report

One line per pull request: number, URL, and `merged` or `closed`.
