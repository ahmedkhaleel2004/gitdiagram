export type CredentialKind = "openai_api_key" | "github_pat";

export interface CredentialStatus {
  openaiApiKeyConfigured: boolean;
  githubPatConfigured: boolean;
}

type CredentialAction =
  | { action: "status" }
  | { action: "set"; credential: CredentialKind; value: string }
  | { action: "clear"; credential: CredentialKind };

interface CredentialResponse {
  ok: true;
  credentials: CredentialStatus;
}

const CREDENTIAL_KINDS = ["openai_api_key", "github_pat"] as const;
const LEGACY_STORAGE_KEYS: Record<CredentialKind, string> = {
  openai_api_key: "openai_api_key",
  github_pat: "github_pat",
};
const CREDENTIAL_MUTATION_LOCK = "gitdiagram-credential-mutation";

let legacyMigrationPromise: Promise<boolean> | undefined;

async function withOriginWideCredentialLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lockManager: LockManager | undefined;
  try {
    lockManager =
      typeof navigator === "undefined" ? undefined : navigator.locks;
  } catch {
    return operation();
  }

  if (!lockManager) {
    return operation();
  }

  let operationStarted = false;
  try {
    return await lockManager.request(
      CREDENTIAL_MUTATION_LOCK,
      { mode: "exclusive" },
      async () => {
        operationStarted = true;
        return operation();
      },
    );
  } catch (error) {
    if (operationStarted) {
      throw error;
    }
    return operation();
  }
}

async function runLegacyCredentialMigration(): Promise<boolean> {
  if (typeof window === "undefined") {
    return true;
  }

  return withOriginWideCredentialLock(async () => {
    let storage: Storage;
    const pendingMigrations: Array<{
      storageKey: string;
      credential: CredentialKind;
      value: string;
    }> = [];
    try {
      storage = window.localStorage;
      for (const credential of CREDENTIAL_KINDS) {
        const storageKey = LEGACY_STORAGE_KEYS[credential];
        const value = storage.getItem(storageKey);
        if (value !== null) {
          pendingMigrations.push({ storageKey, credential, value });
        }
      }
    } catch {
      return false;
    }

    const outcomes = await Promise.all(
      pendingMigrations.map(async ({ storageKey, credential, value }) => {
        try {
          await performCredentialActionRaw({
            action: "set",
            credential,
            value,
          });
          storage.removeItem(storageKey);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return outcomes.every(Boolean);
  });
}

export function migrateLegacyCredentialStorage(): Promise<boolean> {
  legacyMigrationPromise ??= runLegacyCredentialMigration();
  return legacyMigrationPromise;
}

export function resetLegacyCredentialMigrationForTests(): void {
  legacyMigrationPromise = undefined;
}

function isCredentialResponse(value: unknown): value is CredentialResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<CredentialResponse>;
  return (
    response.ok === true &&
    typeof response.credentials?.openaiApiKeyConfigured === "boolean" &&
    typeof response.credentials.githubPatConfigured === "boolean"
  );
}

async function performCredentialActionRaw(
  action: CredentialAction,
): Promise<CredentialStatus> {
  const response = await fetch("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(action),
  });

  if (!response.ok) {
    throw new Error("Credential settings are temporarily unavailable.");
  }

  const result: unknown = await response.json();
  if (!isCredentialResponse(result)) {
    throw new Error("Credential settings are temporarily unavailable.");
  }
  return result.credentials;
}

function removeLegacyCredentialStorage(credential: CredentialKind): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEYS[credential]);
  } catch {
    // The server mutation succeeded. A later app load can retry cleanup if
    // browser storage is temporarily unavailable.
  }
}

async function performExplicitCredentialMutation(
  action: Extract<CredentialAction, { credential: CredentialKind }>,
): Promise<CredentialStatus> {
  await migrateLegacyCredentialStorage();
  return withOriginWideCredentialLock(async () => {
    const status = await performCredentialActionRaw(action);
    removeLegacyCredentialStorage(action.credential);
    return status;
  });
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  await migrateLegacyCredentialStorage();
  return performCredentialActionRaw({ action: "status" });
}

export async function saveCredential(
  credential: CredentialKind,
  value: string,
): Promise<CredentialStatus> {
  return performExplicitCredentialMutation({
    action: "set",
    credential,
    value,
  });
}

export async function clearCredential(
  credential: CredentialKind,
): Promise<CredentialStatus> {
  return performExplicitCredentialMutation({
    action: "clear",
    credential,
  });
}
