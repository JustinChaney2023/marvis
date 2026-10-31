/**
 * Files in-app feedback as GitHub issues, and hands an approved one to
 * Claude by labeling it — the `season-claude-build` workflow picks up the
 * label, implements it and opens a PR. See docs/feedback-to-pr.md.
 *
 * Off unless SEASON_GITHUB_TOKEN (issues read/write on the repo) and
 * SEASON_GITHUB_REPO ("owner/name") are set; feedback then just stays in
 * the in-app inbox as before.
 */

export const CLAUDE_BUILD_LABEL = "claude-build";
const FEEDBACK_LABEL = "season-feedback";
const CATEGORY_LABEL: Record<string, string> = { BUG: "bug", SUGGESTION: "enhancement" };
const TITLE_MAX = 80;

export function isGithubFeedbackConfigured(): boolean {
  return Boolean(process.env.SEASON_GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(process.env.SEASON_GITHUB_REPO ?? ""));
}

/**
 * Title and body for a feedback issue. The reporter's name and email stay
 * out of it on purpose: the repo may be public.
 */
export function feedbackIssueContent(feedback: { message: string; category: string; page: string | null }) {
  const firstLine = feedback.message.split("\n").find((l) => l.trim())?.trim() ?? "Feedback";
  const title = firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
  const kind = feedback.category === "BUG" ? "Bug report" : feedback.category === "SUGGESTION" ? "Suggestion" : "Feedback";
  const body = [
    `**${kind}** from a Season user${feedback.page ? `, sent from \`${feedback.page}\`` : ""}.`,
    "",
    feedback.message,
    "",
    "---",
    `_Filed from Season's feedback button. An admin adds the \`${CLAUDE_BUILD_LABEL}\` label (or presses "Build with Claude" in the feedback inbox) to have Claude implement it and open a PR._`,
  ].join("\n");
  const labels = [FEEDBACK_LABEL, CATEGORY_LABEL[feedback.category]].filter(Boolean) as string[];
  return { title, body, labels };
}

async function github(path: string, body: unknown): Promise<Response> {
  return fetch(`https://api.github.com/repos/${process.env.SEASON_GITHUB_REPO}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SEASON_GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function createFeedbackIssue(feedback: {
  message: string;
  category: string;
  page: string | null;
}): Promise<{ number: number; url: string }> {
  const res = await github("/issues", feedbackIssueContent(feedback));
  if (!res.ok) throw new Error(`GitHub issue create failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { number: number; html_url: string };
  return { number: json.number, url: json.html_url };
}

/** Adding the label is what starts the build workflow. */
export async function sendIssueToClaude(issueNumber: number): Promise<void> {
  const res = await github(`/issues/${issueNumber}/labels`, { labels: [CLAUDE_BUILD_LABEL] });
  if (!res.ok) throw new Error(`GitHub label failed: ${res.status} ${await res.text()}`);
}
