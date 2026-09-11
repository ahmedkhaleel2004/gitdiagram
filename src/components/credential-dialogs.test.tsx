import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyDialog } from "~/components/api-key-dialog";
import { PrivateReposDialog } from "~/components/private-repos-dialog";

const mocks = vi.hoisted(() => ({
  clearCredential: vi.fn(),
  getCredentialStatus: vi.fn(),
  saveCredential: vi.fn(),
}));

vi.mock("~/features/credentials/api", () => ({
  clearCredential: mocks.clearCredential,
  getCredentialStatus: mocks.getCredentialStatus,
  saveCredential: mocks.saveCredential,
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("credential dialogs", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentialStatus.mockResolvedValue({
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
    });
    mocks.saveCredential.mockResolvedValue({
      openaiApiKeyConfigured: true,
      githubPatConfigured: true,
    });
    mocks.clearCredential.mockResolvedValue({
      openaiApiKeyConfigured: false,
      githubPatConfigured: false,
    });
  });

  it("saves an OpenAI key without ever pre-filling the secret", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<ApiKeyDialog isOpen onClose={onClose} onSaved={onSaved} />);

    await waitFor(() => expect(mocks.getCredentialStatus).toHaveBeenCalled());
    const input = screen.getByLabelText("OpenAI API key");
    expect(input).toHaveValue("");

    fireEvent.change(input, { target: { value: "sk-browser-entry" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    await waitFor(() =>
      expect(mocks.saveCredential).toHaveBeenCalledWith(
        "openai_api_key",
        "sk-browser-entry",
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("does not let a late status response overwrite a successful save", async () => {
    const credentialStatus = createDeferred<{
      githubPatConfigured: boolean;
      openaiApiKeyConfigured: boolean;
    }>();
    mocks.getCredentialStatus.mockReturnValueOnce(credentialStatus.promise);
    render(<ApiKeyDialog isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "sk-browser-entry" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    expect(
      await screen.findByText(
        "An API key is currently saved. Its value cannot be displayed.",
      ),
    ).toBeInTheDocument();

    credentialStatus.resolve({
      githubPatConfigured: false,
      openaiApiKeyConfigured: false,
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "An API key is currently saved. Its value cannot be displayed.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("accepts fine-grained GitHub PATs and clears only through the API", async () => {
    mocks.getCredentialStatus.mockResolvedValueOnce({
      openaiApiKeyConfigured: false,
      githubPatConfigured: true,
    });
    const onClose = vi.fn();
    render(<PrivateReposDialog isOpen onClose={onClose} />);

    await screen.findByText(
      "A GitHub token is currently saved. Its value cannot be displayed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(mocks.clearCredential).toHaveBeenCalledWith("github_pat"),
    );

    fireEvent.change(screen.getByLabelText("GitHub personal access token"), {
      target: { value: "github_pat_fine_grained" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Token" }));
    await waitFor(() =>
      expect(mocks.saveCredential).toHaveBeenCalledWith(
        "github_pat",
        "github_pat_fine_grained",
      ),
    );
  });
});
