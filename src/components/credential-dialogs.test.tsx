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
  writeText: vi.fn(),
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    mocks.writeText.mockResolvedValue(undefined);
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
    expect(input.closest(".ph-no-capture")).toBe(screen.getByRole("dialog"));

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

    await screen.findByText("Token saved. Paste a new one to replace it.");
    fireEvent.click(screen.getByRole("button", { name: "Clear token" }));
    await waitFor(() =>
      expect(mocks.clearCredential).toHaveBeenCalledWith("github_pat"),
    );

    const input = screen.getByLabelText("GitHub personal access token");
    expect(input.closest(".ph-no-capture")).toBe(screen.getByRole("dialog"));
    fireEvent.change(input, {
      target: { value: "github_pat_fine_grained" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    await waitFor(() =>
      expect(mocks.saveCredential).toHaveBeenCalledWith(
        "github_pat",
        "github_pat_fine_grained",
      ),
    );
  });

  it("prefills a read-only token and copies repository-specific setup without the secret", async () => {
    render(
      <PrivateReposDialog isOpen onClose={vi.fn()} repository="acme/demo" />,
    );
    const link = screen.getByRole("link", { name: "Create token on GitHub" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/settings/personal-access-tokens/new",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      contents: "read",
      expires_in: "30",
      target_name: "acme",
    });
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.change(screen.getByLabelText("GitHub personal access token"), {
      target: { value: "github_pat_secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt for my AI" }),
    );
    await screen.findByRole("button", {
      name: "Copied! Paste into your AI",
    });
    const prompt = mocks.writeText.mock.calls[0]![0] as string;
    expect(prompt).toContain("https://github.com/acme/demo");
    expect(prompt).toContain("Contents to Read-only");
    expect(prompt).toContain("Do not put the token in chat, logs, or files.");
    expect(prompt).not.toContain("github_pat_secret");
    expect(mocks.saveCredential).not.toHaveBeenCalled();
  });

  it("offers a manually copyable prompt if clipboard access fails", async () => {
    mocks.writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    render(<PrivateReposDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt for my AI" }),
    );
    const fallback = await screen.findByRole("textbox", {
      name: "AI setup prompt",
    });
    expect(fallback).toHaveAttribute("readonly");
    expect((fallback as HTMLTextAreaElement).value).toContain(
      "Ask me which repository",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t copy");
  });

  it("only closes and retries after the token is saved successfully", async () => {
    mocks.saveCredential.mockRejectedValueOnce(new Error("Save failed"));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <PrivateReposDialog
        isOpen
        onClose={onClose}
        onSaved={onSaved}
        repository="acme/demo"
      />,
    );
    fireEvent.change(screen.getByLabelText("GitHub personal access token"), {
      target: { value: "github_pat_test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & retry" }));
    await screen.findByRole("alert");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save & retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
