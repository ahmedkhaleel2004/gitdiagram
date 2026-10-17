import { GitCommitHorizontal } from "lucide-react";
import { githubCommitUrl, shortCommitSha } from "~/features/diagram/commit";
import styles from "./workspace.module.css";

/**
 * Which version of the repository a diagram shows: the commit's short SHA,
 * linking to that commit on GitHub. Rendered only for commit diagrams.
 */
export function CommitLink({
  repository,
  commit,
  className,
}: {
  repository: string;
  commit: string;
  className?: string;
}) {
  return (
    <a
      className={className ?? styles.commitChip}
      href={githubCommitUrl(repository, commit)}
      target="_blank"
      rel="noopener noreferrer"
      title={`View commit ${commit} on GitHub`}
      data-commit-link
    >
      <GitCommitHorizontal size={14} aria-hidden="true" />
      <code className={styles.commitSha}>{shortCommitSha(commit)}</code>
    </a>
  );
}
