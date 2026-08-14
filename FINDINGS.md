# FINDINGS

Things noticed during the pre-launch hardening work that were **deliberately not
changed**, plus the results of the checks the brief asked for.

This file is written for the repository owner, who is not a developer. Where
something is technical, the "What it means" line explains it in plain language.

---

## Phase 0 — version control

### The eight prior merges did not lose the login captcha or the login UX work

**The worry:** every previous commit changed only one file, `uep-v2-changes.tar.gz`
— a compressed archive. Git cannot merge inside an archive. When two branches both
changed it, the only way to resolve the conflict was to throw away one side
completely. Eight branches were merged this way, so there was a real chance some
work had silently vanished.

**What I checked and found:**

| Thing checked | Result |
|---|---|
| `create_captcha_challenge` in `backend/app/core/security.py` | **Present.** Also wired up in `app/api/auth.py` at the `/auth/captcha` endpoint and verified on login. |
| Login UX changes in `frontend/src/pages/Login.jsx` | **Present.** 193 lines, including captcha refresh, numeric-only validation, focus management, and inline error messages. |

**Conclusion: nothing was lost.** Both features survived intact.

### The stale branch was a duplicate, not lost work

The brief said `claude/action-center-notifications-d0ghuh` could be deleted because
its commit was superseded. Git initially disagreed — the commit was *not* an
ancestor of `main`, which normally means unmerged work.

I checked further, and it is a false alarm. The branch commit `a16c052` and the
`main` commit `addf900` have the **identical file tree** (`16f99cb3…`) and the
**identical parent** (`e222311`). They differ only in who signed them: GitHub
re-authored and re-signed the commit when it was merged through the web UI, which
produces a new commit ID for byte-identical content.

**What it means:** the work is fully present in `main`. Deleting the branch loses
nothing, and it is safe for you to delete.

**I could not delete it myself.** The sandbox this work ran in allows pushing new
commits but blocks deleting remote branches, and the GitHub tools available to me
have no "delete branch" operation. This is a one-click job for you:

1. Go to <https://github.com/vvalizadeh9-gif/USO-Platform/branches>
2. Find `claude/action-center-notifications-d0ghuh`
3. Click the wastebasket icon on its row.

If you ever change your mind, GitHub keeps a "Restore" button next to deleted
branches on that same page for a while afterwards.

### Other stale branches left alone

Eight further merged branches still exist on GitHub:

`claude/acceptance-tab-kpi-analysis-f5ndgw`, `claude/admin-console-restructure-asaz0x`,
`claude/cpm-import-filtering-1uoddy`, `claude/health-check-flow-discussion-ijpq5y`,
`claude/login-page-captcha-hei0mj`, `claude/login-page-ux-review-ouqn87`,
`claude/pm-action-center-kpi-lvr78g`, `claude/uep-permissions-admin-stats-naip0s`

The brief only authorised deleting one, so I left these. They are harmless — just
clutter in the branch dropdown. You can delete them from the GitHub web UI at any
time; their work is all in `main` already.

### The tarball is kept in history, not lost

`uep-v2-changes.tar.gz` was deleted from the working tree, but it still exists in
every historical commit. Nothing is unrecoverable. `.gitignore` now blocks `*.tar.gz`
so the pattern cannot come back by accident.
