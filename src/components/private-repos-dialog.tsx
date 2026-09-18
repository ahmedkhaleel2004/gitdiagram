"use client";

import { CredentialDialog } from "./credential-dialog";

interface PrivateReposDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  repository?: string;
}

export function PrivateReposDialog({
  repository,
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
      description="Use a token to let GitDiagram read your private repository."
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
          Your token is kept in a protected browser cookie for 30 days.
          Repository content is sent to the AI provider to generate your
          diagram. Private diagrams are stored privately on GitDiagram.
        </>
      }
    />
  );
}
