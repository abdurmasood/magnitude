default:
    @just --list

# Run the tests.
test:
    npm test

# Typecheck.
typecheck:
    npm run typecheck

# Build the CLI.
build:
    npm run build

# Test, typecheck, and build.
check: test typecheck build

# Patch release. Pushes a commit and a tag, which publishes to npm.
release:
    just _release patch

# Minor release. Pushes a commit and a tag, which publishes to npm.
release-minor:
    just _release minor

# Major release. Pushes a commit and a tag, which publishes to npm.
release-major:
    just _release major

[private]
_release level:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "working tree is dirty" >&2
        exit 1
    fi
    git fetch origin main
    if ! git diff --quiet origin/main; then
        echo "workspace does not match origin/main" >&2
        exit 1
    fi
    if git show-ref --verify --quiet refs/heads/main \
        && [[ -n "$(git rev-list origin/main..main)" ]]; then
        echo "local main is ahead of origin/main" >&2
        exit 1
    fi
    root=$(pwd)
    dir=$(mktemp -d)
    branch="just-release-$$"
    cleanup() {
        cd "$root"
        git worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
        git branch -D "$branch" 2>/dev/null || true
    }
    trap cleanup EXIT
    git worktree add -b "$branch" "$dir" origin/main
    cd "$dir"
    npm ci
    npm test
    npm run typecheck
    npm run build
    npm version {{level}} -m "chore(release): %s"
    version=$(node -p "require('./package.json').version")
    git push origin HEAD:main
    git push origin "v${version}"
    git fetch origin main:main
    echo "pushed v${version}. run but pull so this workspace matches main."
