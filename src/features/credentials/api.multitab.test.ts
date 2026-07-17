import { afterEach, describe, expect, it, vi } from "vitest";

import type * as CredentialApi from "~/features/credentials/api";

type CredentialModule = Pick<
  typeof CredentialApi,
  "clearCredential" | "saveCredential"
>;
type CredentialAction =
  | { action: "status" }
  | { action: "set"; credential: "openai_api_key"; value: string }
  | { action: "clear"; credential: "openai_api_key" };

const originalLocksDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "locks",
);

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  vi.resetModules();
  if (originalLocksDescriptor) {
    Object.defineProperty(window.navigator, "locks", originalLocksDescriptor);
  } else {
    Reflect.deleteProperty(window.navigator, "locks");
  }
});

describe("credential client API across browser contexts", () => {
  it("does not let a stale migration overwrite a newer save", async () => {
    const race = await startTwoContextRace((newerContext) =>
      newerContext.saveCredential("openai_api_key", "replacement-openai"),
    );

    race.finishStaleMigration();
    await race.completion;

    expect(race.actions).toEqual([
      {
        action: "set",
        credential: "openai_api_key",
        value: "legacy-openai",
      },
      {
        action: "set",
        credential: "openai_api_key",
        value: "replacement-openai",
      },
    ]);
    expect(race.getStoredCredential()).toBe("replacement-openai");
    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
  });

  it("does not let a stale migration resurrect a credential after clear", async () => {
    const race = await startTwoContextRace((newerContext) =>
      newerContext.clearCredential("openai_api_key"),
    );

    race.finishStaleMigration();
    await race.completion;

    expect(race.actions).toEqual([
      {
        action: "set",
        credential: "openai_api_key",
        value: "legacy-openai",
      },
      {
        action: "clear",
        credential: "openai_api_key",
      },
    ]);
    expect(race.getStoredCredential()).toBeNull();
    expect(window.localStorage.getItem("openai_api_key")).toBeNull();
  });
});

async function startTwoContextRace(
  runNewerMutation: (context: CredentialModule) => Promise<unknown>,
) {
  const lockRequest = installOriginLockManager();
  window.localStorage.setItem("openai_api_key", "legacy-openai");

  vi.resetModules();
  const staleContext = await import("~/features/credentials/api");
  vi.resetModules();
  const newerContext = await import("~/features/credentials/api");

  const actions: CredentialAction[] = [];
  let storedCredential: string | null = null;
  let staleMigrationResolve!: (response: Response) => void;
  let staleMigrationFinished = false;
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const action = JSON.parse(String(init?.body)) as CredentialAction;
      actions.push(action);

      if (
        action.action === "set" &&
        action.value === "legacy-openai" &&
        !staleMigrationFinished
      ) {
        return new Promise<Response>((resolve) => {
          staleMigrationResolve = resolve;
        });
      }

      storedCredential =
        action.action === "set"
          ? action.value
          : action.action === "clear"
            ? null
            : storedCredential;
      return Promise.resolve(credentialResponse(storedCredential));
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const staleMigration = staleContext.migrateLegacyCredentialStorage();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  const newerMutation = runNewerMutation(newerContext);
  await vi.waitFor(() => expect(lockRequest).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  return {
    actions,
    completion: Promise.all([staleMigration, newerMutation]),
    finishStaleMigration() {
      staleMigrationFinished = true;
      storedCredential = "legacy-openai";
      staleMigrationResolve(credentialResponse(storedCredential));
    },
    getStoredCredential: () => storedCredential,
  };
}

function installOriginLockManager() {
  const queues = new Map<string, Promise<void>>();
  const request = vi.fn(
    (
      name: string,
      _options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => {
      const previous = queues.get(name) ?? Promise.resolve();
      const result = previous.then(() => callback(null));
      queues.set(
        name,
        result.then(
          () => undefined,
          () => undefined,
        ),
      );
      return result;
    },
  );

  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: { request } as unknown as LockManager,
  });
  return request;
}

function credentialResponse(storedCredential: string | null): Response {
  return Response.json({
    ok: true,
    credentials: {
      openaiApiKeyConfigured: storedCredential !== null,
      githubPatConfigured: false,
    },
  });
}
