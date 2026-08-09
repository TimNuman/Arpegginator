import { useEffect, useState } from "react";
import { css } from "@emotion/react";

/**
 * Branch switcher for GitHub Pages deployments. main is served from the site
 * root and PR previews from /<repo>/branch/<name>/ (see ci.yml), so this
 * lists open PRs from the GitHub API and navigates between the deployed
 * copies. Renders nothing when not served from *.github.io.
 */

// Must match the sed sanitization in ci.yml / cleanup-preview.yml
const sanitizeBranch = (branch: string) => branch.replace(/[^a-zA-Z0-9._-]/g, "-");

interface BranchOption {
  /** "" for main, otherwise the sanitized branch name (= deploy directory) */
  value: string;
  label: string;
}

const switcherStyles = css`
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 50;

  select {
    appearance: none;
    background: rgba(20, 20, 25, 0.85);
    border: 1px solid #333;
    border-radius: 4px;
    color: #888;
    font-size: 10px;
    letter-spacing: 1px;
    padding: 4px 8px;
    cursor: pointer;
    max-width: 200px;

    &:hover {
      color: #ccc;
      border-color: #555;
    }
  }
`;

// Where this build is deployed, from the build-time base path:
//   /<repo>/               -> main
//   /<repo>/branch/<name>/ -> branch preview
const parseBase = () => {
  const match = import.meta.env.BASE_URL.match(/^\/([^/]+)\/(?:branch\/([^/]+)\/)?$/);
  return match ? { repo: match[1], current: match[2] ?? "" } : null;
};

export function BranchSwitcher() {
  const host = window.location.hostname;
  const deployed = host.endsWith(".github.io") ? parseBase() : null;
  const [pulls, setPulls] = useState<BranchOption[]>([]);

  useEffect(() => {
    if (!deployed) return;
    const owner = host.split(".")[0];
    fetch(`https://api.github.com/repos/${owner}/${deployed.repo}/pulls?state=open&per_page=100`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((prs: { number: number; head: { ref: string } }[]) => {
        setPulls(
          prs.map((pr) => ({
            value: sanitizeBranch(pr.head.ref),
            label: `#${pr.number} ${pr.head.ref}`,
          })),
        );
      })
      .catch((err) => console.warn("[branch-switcher] Could not list open PRs:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!deployed) return null;

  const options: BranchOption[] = [{ value: "", label: "main" }, ...pulls];
  // A preview can exist without an open PR (workflow_dispatch deploys);
  // keep the current one selectable so the dropdown reflects reality.
  if (deployed.current && !options.some((o) => o.value === deployed.current)) {
    options.push({ value: deployed.current, label: deployed.current });
  }

  const navigate = (value: string) => {
    if (value === deployed.current) return;
    const root = `/${deployed.repo}/`;
    window.location.assign(value ? `${root}branch/${value}/` : root);
  };

  return (
    <div css={switcherStyles}>
      <select
        aria-label="Deployed branch"
        value={deployed.current}
        onChange={(e) => navigate(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
