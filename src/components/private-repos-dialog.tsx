"use client";

import { ExternalLink } from "lucide-react";

import { GitHubIcon } from "~/components/icons/github-icon";
import {
  GITHUB_CONNECT_ENABLED,
  GITHUB_CONNECT_FAILURES,
  githubConnectUrl,
  type GitHubConnectFailure,
  type GitHubConnectSource,
} from "~/features/credentials/github-connect";
import { captureAnalyticsEvent } from "~/lib/analytics-client";

import {
  CredentialDialog,
  type CredentialDialogPrimaryContext,
} from "./credential-dialog";
import controls from "./generation/workspace.module.css";

interface PrivateReposDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  repository?: string;
  /** Where "Continue with GitHub" was opened from, to come back to it. */
  source?: GitHubConnectSource;
  /** The page to come back to, for the header's dialog. */
  returnTo?: string;
  /** Why the last GitHub sign-in did not finish, if it did not. */
  connectError?: GitHubConnectFailure;
}

function GitHubConnect({
  context: { status, disconnectGitHub, isPending, pendingAction },
  repository,
  source,
  returnTo,
  connectError,
}: {
  context: CredentialDialogPrimaryContext;
  repository?: string;
  source: GitHubConnectSource;
  returnTo?: string;
  connectError?: GitHubConnectFailure;
}) {
  const needsInstall = connectError === "no_access" && Boolean(repository);
  const start = (mode: "authorize" | "install") => {
    captureAnalyticsEvent("github_connect_started", { source, mode });
  };

  return (
    <div className="space-y-3">
      <a
        href={githubConnectUrl({ repository, source, returnTo })}
        data-dialog-autofocus
        onClick={() => start("authorize")}
        className={`${controls.actionButton} ${controls.primary} w-full`}
      >
        <GitHubIcon className="h-4 w-4" aria-hidden="true" />
        Continue with GitHub
      </a>
      <p className="text-xs text-neutral-700 dark:text-neutral-300">
        Read-only, and only for the repositories you pick on GitHub. No token to
        copy.
      </p>
      {connectError && (
        <p
          role="alert"
          className="text-sm font-medium text-red-700 dark:text-red-300"
        >
          {GITHUB_CONNECT_FAILURES[connectError]}
        </p>
      )}
      {needsInstall && (
        <a
          href={githubConnectUrl({
            repository,
            source,
            returnTo,
            install: true,
          })}
          onClick={() => start("install")}
          className={`${controls.actionButton} w-full`}
        >
          Choose repositories on GitHub
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
      {status?.githubAppConnected && (
        <p className="text-xs text-neutral-700 dark:text-neutral-300">
          Connected as{" "}
          <strong className="break-all">@{status.githubLogin}</strong>.{" "}
          <button
            type="button"
            onClick={() => void disconnectGitHub()}
            disabled={isPending}
            className="neo-link underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
          </button>
        </p>
      )}
    </div>
  );
}

export function PrivateReposDialog({
  repository,
  source = "repo",
  returnTo,
  connectError,
  ...props
}: PrivateReposDialogProps) {
  const tokenUrl = new URL(
    "https://github.com/settings/personal-access-tokens/new",
  );
  tokenUrl.search = new URLSearchParams({
    name: "GitDiagram",
    description: "Read selected repositories to generate architecture diagrams",
    expires_in: "30",
    contents: "read",
    ...(repository ? { target_name: repository.split("/")[0]! } : {}),
  }).toString();
  const aiPrompt = [
    `Help me connect ${repository ? `https://github.com/${repository}` : "a private GitHub repository"} to GitDiagram.`,
    `Use my browser to open ${tokenUrl.toString()} and create a fine-grained personal access token named GitDiagram that expires in 30 days.`,
    repository
      ? `Choose the resource owner ${repository.split("/")[0]} and grant access only to the ${repository} repository.`
      : "Ask me which repository I want to use, then choose its resource owner and grant access only to that repository.",
    "Set repository Contents to Read-only; Metadata read access is included automatically. Do not add write or account permissions.",
    "If the organization requires approval, tell me what its admin needs to approve.",
    "Help me paste the token directly into GitDiagram's GitHub access dialog and save it. Do not put the token in chat, logs, or files.",
    "If you cannot use my browser, walk me through these steps briefly.",
  ].join("\n\n");

  return (
    <CredentialDialog
      {...props}
      credential="github_pat"
      title="GitHub access"
      description={
        GITHUB_CONNECT_ENABLED
          ? "Connect GitHub to let GitDiagram read your private repository."
          : "Use a token to let GitDiagram read your private repository."
      }
      primary={
        GITHUB_CONNECT_ENABLED
          ? (context) => (
              <GitHubConnect
                context={context}
                repository={repository}
                source={source}
                returnTo={returnTo}
                connectError={connectError}
              />
            )
          : undefined
      }
      alternativeLabel="Use a personal access token instead"
      setup={{
        instructions: (
          <>
            Choose the repository owner and select{" "}
            {repository ? (
              <strong className="break-all">{repository}</strong>
            ) : (
              "your repository"
            )}
            . <strong>Contents: Read-only</strong> is already selected.
          </>
        ),
        url: tokenUrl.toString(),
        linkLabel: "Create token on GitHub",
        aiPrompt,
      }}
      dataUsage={
        <>
          {GITHUB_CONNECT_ENABLED &&
            "Continue with GitHub gives GitDiagram read-only access to only the repositories you pick, and you can remove it anytime in your GitHub settings. "}
          Your {GITHUB_CONNECT_ENABLED ? "sign-in or token" : "token"} is kept
          in a protected browser cookie for 30 days. Repository content is sent
          to the AI provider to generate your diagram. Private diagrams are
          stored privately on GitDiagram.
        </>
      }
    />
  );
}
