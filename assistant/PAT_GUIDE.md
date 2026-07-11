# PAT Collaboration Guide

Purpose: document the GitHub Personal Access Token (PAT) workflow for
an AI assistant to push commits to a remote working branch.

This is an **optional** component. Only use if the assistant needs
to push to GitHub autonomously.

---

## 1. Why a PAT

The AI assistant runs in a sandboxed environment with no pre-existing
GitHub credentials. A short-lived Personal Access Token (PAT) is granted
once per collaboration period and stored outside the repository tree.

The user retains final authority over GitHub credentials. The assistant
**never** pushes to protected branches (e.g., `main`) directly.

---

## 2. Token lifecycle

The user generates a PAT and stores it at an agreed path outside the
repository tree. The assistant reads it on demand and discards it after
use. The assistant does not store the PAT anywhere inside the repository.

The user manages rotation before expiration.

---

## 3. Whitelisted branches (safety boundary)

Only branches in the GitHub branch-protection whitelist can be pushed to.
The whitelist is configured by the user via GitHub repository settings;
the assistant does not modify it.

Expected behavior:

| Target branch | Expected result |
|---|---|
| Whitelisted (working branch) | Push succeeds |
| Not whitelisted | Push rejected |

This whitelist serves as the **safety boundary** between the assistant's
working area and the protected default branch. Even if the PAT technically
permits pushing to the default branch, the assistant must not do so —
default branch merges are the user's manual responsibility.

---

## 4. Standard push workflow

1. **Read PAT** from the agreed external path. Mask the display: show
   only length, first 4 characters, and last 4 characters.
2. **Create a temporary credential file** at a path **outside** the
   repository. Set permissions to owner-only read. Never use a path
   inside the repo.
3. **Configure credential helper** for the push operation only using
   `git -c credential.helper`. Do not modify global git config.
4. **Push** to the target branch (whitelisted).
5. **Clean up** the credential file immediately after the push.

The credential file is never committed, never logged, and never written
to any file inside the repository tree.

---

## 5. Git identity

```
git config --local user.name "<assistant-collaboration-name>"
git config --local user.email "<assistant-collaboration-name>@local"
```

This identity is clearly marked as the assistant's and is not the
repository owner's identity. If the user wishes to attribute commits to
their own identity, they instruct the assistant to update the local
config accordingly.

---

## 6. Security rules (always)

- **Mask the PAT in all output.** Never display the full PAT in chat,
  log lines, commit messages, or project files. Display only length
  plus first 4 and last 4 characters.
- **Never commit the PAT.** Double-check before every `git add -A` that
  no PAT-like string is being staged.
- **Never write the PAT to working documents** (state tracker, review
  todo, drift report, pitfall list).
- **Use branch protection as the safety boundary.** Do not push to
  branches outside the whitelist.
- **Flag approaching expiration** if the assistant becomes aware of it.
