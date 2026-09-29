"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearCredential,
  getCredentialStatus,
  saveCredential,
  type CredentialKind,
  type CredentialStatus,
} from "~/features/credentials/api";

type CredentialSettingError = "load" | "save" | "clear" | "disconnect" | null;

type CredentialMutation = Exclude<CredentialSettingError, "load" | null>;

interface CredentialSettingState {
  error: CredentialSettingError;
  isConfigured: boolean;
  pendingAction: CredentialMutation | null;
  /** The last status read, for extras such as a GitHub sign-in. */
  status: CredentialStatus | null;
  value: string;
}

interface UseCredentialSettingOptions {
  credential: CredentialKind;
  isOpen: boolean;
}

const CREDENTIAL_STATUS_KEYS = {
  openai_api_key: "openaiApiKeyConfigured",
  github_pat: "githubPatConfigured",
} as const satisfies Record<CredentialKind, keyof CredentialStatus>;

const INITIAL_STATE: CredentialSettingState = {
  error: null,
  isConfigured: false,
  pendingAction: null,
  status: null,
  value: "",
};

export function useCredentialSetting({
  credential,
  isOpen,
}: UseCredentialSettingOptions) {
  const [state, setState] = useState<CredentialSettingState>(INITIAL_STATE);
  const requestRevisionRef = useRef(0);

  useEffect(() => {
    const requestRevision = requestRevisionRef.current + 1;
    requestRevisionRef.current = requestRevision;
    if (!isOpen) {
      return;
    }

    setState(INITIAL_STATE);
    void getCredentialStatus()
      .then((status) => {
        if (requestRevisionRef.current !== requestRevision) {
          return;
        }
        setState((current) => ({
          ...current,
          isConfigured: status[CREDENTIAL_STATUS_KEYS[credential]],
          status,
        }));
      })
      .catch(() => {
        if (requestRevisionRef.current !== requestRevision) {
          return;
        }
        setState((current) => ({
          ...current,
          error: "load",
        }));
      });

    return () => {
      requestRevisionRef.current += 1;
    };
  }, [credential, isOpen]);

  const mutateCredential = useCallback(
    async (action: CredentialMutation) => {
      const requestRevision = requestRevisionRef.current + 1;
      requestRevisionRef.current = requestRevision;
      setState((current) => ({
        ...current,
        error: null,
        pendingAction: action,
      }));

      try {
        const status =
          action === "save"
            ? await saveCredential(credential, state.value)
            : await clearCredential(
                action === "disconnect" ? "github_app" : credential,
              );
        if (requestRevisionRef.current === requestRevision) {
          setState((current) => ({
            ...current,
            isConfigured: status[CREDENTIAL_STATUS_KEYS[credential]],
            status,
            value: action === "disconnect" ? current.value : "",
          }));
        }
        return requestRevisionRef.current === requestRevision;
      } catch {
        if (requestRevisionRef.current === requestRevision) {
          setState((current) => ({
            ...current,
            error: action,
          }));
        }
        return false;
      } finally {
        if (requestRevisionRef.current === requestRevision) {
          setState((current) => ({
            ...current,
            pendingAction: null,
          }));
        }
      }
    },
    [credential, state.value],
  );

  const save = useCallback(() => mutateCredential("save"), [mutateCredential]);
  const clear = useCallback(
    () => mutateCredential("clear"),
    [mutateCredential],
  );
  const disconnectGitHub = useCallback(
    () => mutateCredential("disconnect"),
    [mutateCredential],
  );

  return {
    ...state,
    isPending: state.pendingAction !== null,
    clear,
    disconnectGitHub,
    save,
    setValue: (value: string) => {
      setState((current) => ({ ...current, value }));
    },
  };
}
