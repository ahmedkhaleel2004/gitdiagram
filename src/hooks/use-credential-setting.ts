"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearCredential,
  getCredentialStatus,
  saveCredential,
  type CredentialKind,
  type CredentialStatus,
} from "~/features/credentials/api";

export type CredentialSettingError = "load" | "save" | "clear" | null;

interface CredentialSettingState {
  error: CredentialSettingError;
  isConfigured: boolean;
  isPending: boolean;
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
  isPending: false,
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
    async (action: Exclude<CredentialSettingError, "load" | null>) => {
      const requestRevision = requestRevisionRef.current + 1;
      requestRevisionRef.current = requestRevision;
      setState((current) => ({
        ...current,
        error: null,
        isPending: true,
      }));

      try {
        const status =
          action === "save"
            ? await saveCredential(credential, state.value)
            : await clearCredential(credential);
        if (requestRevisionRef.current === requestRevision) {
          setState((current) => ({
            ...current,
            isConfigured: status[CREDENTIAL_STATUS_KEYS[credential]],
            value: "",
          }));
        }
        return true;
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
            isPending: false,
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

  return {
    ...state,
    clear,
    save,
    setValue: (value: string) => {
      setState((current) => ({ ...current, value }));
    },
  };
}
