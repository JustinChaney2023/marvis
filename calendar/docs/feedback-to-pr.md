# Feedback → issue → Claude → PR

Season's feedback button (the megaphone) can turn suggestions into pull
requests:

1. **Someone sends feedback.** It's saved to the in-app inbox as before and,
   when GitHub is configured, also filed as an issue labeled
   `season-feedback` (plus `bug` or `enhancement`). The issue doesn't say
   who sent it. Each account files at most 10 issues a day; anything past
   that only goes to the inbox.
2. **You approve it.** In **Settings → Feedback inbox**, press **Build with
   Claude**. You can also add the `claude-build` label to any issue on
   GitHub yourself. Approval is required because the text comes from
   users, and only people with write access can add labels.
3. **Claude builds it.** The `Season — Claude builds an approved issue`
   workflow (`.github/workflows/season-claude-build.yml`) runs Claude Code
   on the issue. Claude works in `calendar/`, runs the checks, and pushes a
   `claude/issue-…` branch. Its progress is posted as a comment on the issue.
4. **A PR is opened**, saying it closes the issue. CI runs on it like any
   other PR. You review it and merge it; nothing is merged automatically.

## Setup

**On GitHub (once):**

- Add a repo secret (Settings → Secrets and variables → Actions):
  - `CLAUDE_CODE_OAUTH_TOKEN`: run `claude setup-token` locally (uses your
    Claude subscription), **or**
  - `ANTHROPIC_API_KEY`: an API key from console.anthropic.com.
- The Claude GitHub App must be installed on the repo (it already is if you
  use Claude Code on the web with it). The workflow uses the app's token so
  that CI runs on the PR it opens.

**On the Season server** (`calendar/.env`, then restart):

```
SEASON_GITHUB_TOKEN="github_pat_…"   # fine-grained, Issues: read & write on the repo
SEASON_GITHUB_REPO="JustinChaney2023/marvis"
```

Create the token at github.com → Settings → Developer settings →
Fine-grained tokens. Give it access to this one repository and the
**Issues: Read and write** permission only.

Without these two variables, the feedback button works as before (inbox
only) and the inbox doesn't show the **Build with Claude** button.
