"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, GitBranch, X } from "lucide-react";
import { parseGitHubRepoUrl } from "~/features/diagram/github-url";
import styles from "./repository-form.module.css";
import workspace from "./workspace.module.css";

export function RepositoryForm({
  initialValue = "",
  onClose,
}: {
  initialValue?: string;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      className={styles.form}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose?.();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const parsed = parseGitHubRepoUrl(value);
        if (!parsed) {
          setError("Enter a GitHub repository URL or owner/repo.");
          input.current?.focus();
          return;
        }
        setError("");
        startTransition(() => {
          router.push(
            `/${encodeURIComponent(parsed.username)}/${encodeURIComponent(parsed.repo)}`,
          );
          onClose?.();
        });
      }}
    >
      <div className={workspace.repositoryControl}>
        <GitBranch size={18} aria-hidden="true" />
        <label className="sr-only" htmlFor={id}>
          GitHub repository
        </label>
        <input
          ref={input}
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="owner/repo or GitHub URL"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={styles.input}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <button type="submit" disabled={pending} className={workspace.primary}>
          {pending ? "Opening…" : "Generate"}
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
        {onClose && (
          <button
            type="button"
            className={styles.cancel}
            onClick={onClose}
            aria-label="Cancel editing"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
