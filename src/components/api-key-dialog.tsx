"use client";

import { CredentialDialog } from "./credential-dialog";

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

const API_KEYS_URL = "https://platform.openai.com/api-keys";
const AI_PROMPT = [
  "Help me set up an OpenAI API key for GitDiagram.",
  `Use my browser to open ${API_KEYS_URL} and help me create a secret key named GitDiagram in my chosen project.`,
  "Explain that diagram generations using this key are billed to my OpenAI API account. If billing needs setup, walk me through it and ask before adding payment details or buying credits.",
  "Help me paste the key directly into GitDiagram's OpenAI API key dialog and save it. Do not put the key in chat, logs, or files.",
  "If you cannot use my browser, walk me through these steps briefly.",
].join("\n\n");

export function ApiKeyDialog(props: ApiKeyDialogProps) {
  return (
    <CredentialDialog
      {...props}
      credential="openai_api_key"
      title="OpenAI API key"
      description="Use your own key to generate diagrams with your OpenAI account."
      setup={{
        instructions: (
          <>
            Create a secret key in your OpenAI project. Generations with this
            key are billed to your OpenAI account.
          </>
        ),
        url: API_KEYS_URL,
        linkLabel: "Create key on OpenAI",
        aiPrompt: AI_PROMPT,
      }}
      dataUsage={
        <>
          Your key is kept in a protected browser cookie for 30 days. Page
          JavaScript cannot read it. GitDiagram uses it only on the server to
          generate your diagrams.
        </>
      }
    />
  );
}
