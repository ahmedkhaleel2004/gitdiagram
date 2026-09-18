import {
  act,
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
    vi.resetAllMocks();
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
    const input = screen.getByLabelText("OpenAI API key", {
      selector: "input",
    });
    expect(input).toHaveValue("");
    expect(input.closest(".ph-no-capture")).toBe(screen.getByRole("dialog"));

    fireEvent.change(input, { target: { value: "sk-browser-entry" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & retry" }));

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

    fireEvent.change(
      screen.getByLabelText("OpenAI API key", { selector: "input" }),
      {
        target: { value: "sk-browser-entry" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(
      await screen.findByText("Key saved. Paste a new one to replace it."),
    ).toBeInTheDocument();

    credentialStatus.resolve({
      githubPatConfigured: false,
      openaiApiKeyConfigured: false,
    });

    await waitFor(() =>
      expect(
        screen.getByText("Key saved. Paste a new one to replace it."),
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

  it("opens OpenAI setup separately and copies instructions without the entered key", async () => {
    render(<ApiKeyDialog isOpen onClose={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: "Create key on OpenAI" }),
    ).toHaveAttribute("href", "https://platform.openai.com/api-keys");
    expect(
      screen.getByRole("link", { name: "Create key on OpenAI" }),
    ).toHaveAttribute("target", "_blank");
    fireEvent.change(
      screen.getByLabelText("OpenAI API key", { selector: "input" }),
      {
        target: { value: "sk-secret-entry" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt for my AI" }),
    );
    await screen.findByRole("button", { name: "Copied! Paste into your AI" });
    const prompt = mocks.writeText.mock.calls[0]![0] as string;
    expect(prompt).toContain("https://platform.openai.com/api-keys");
    expect(prompt).toContain("billed to my OpenAI API account");
    expect(prompt).toContain("Do not put the key in chat, logs, or files.");
    expect(prompt).not.toContain("sk-secret-entry");
    expect(mocks.saveCredential).not.toHaveBeenCalled();
  });

  describe.each([
    {
      name: "API key",
      Component: ApiKeyDialog,
      inputLabel: "OpenAI API key",
      noun: "key",
      credential: "openai_api_key",
    },
    {
      name: "GitHub token",
      Component: PrivateReposDialog,
      inputLabel: "GitHub personal access token",
      noun: "token",
      credential: "github_pat",
    },
  ])("$name behavior", ({ Component, inputLabel, noun, credential }) => {
    it("keeps failed saves open and only retries after success", async () => {
      mocks.saveCredential.mockRejectedValueOnce(new Error("Save failed"));
      const onClose = vi.fn();
      const onSaved = vi.fn();
      render(<Component isOpen onClose={onClose} onSaved={onSaved} />);
      const saveButton = screen.getByRole("button", { name: "Save & retry" });
      expect(saveButton).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: `Clear ${noun}` }),
      ).not.toBeInTheDocument();
      fireEvent.change(
        screen.getByLabelText(inputLabel, { selector: "input" }),
        {
          target: { value: "test-secret" },
        },
      );
      fireEvent.click(saveButton);
      await screen.findByRole("alert");
      expect(onClose).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(
        screen.getByLabelText(inputLabel, { selector: "input" }),
      ).toHaveValue("test-secret");
      fireEvent.click(saveButton);
      await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("shows clearing feedback and refreshes only after a successful clear", async () => {
      mocks.getCredentialStatus.mockResolvedValueOnce({
        openaiApiKeyConfigured: true,
        githubPatConfigured: true,
      });
      const cleared = createDeferred<{
        openaiApiKeyConfigured: boolean;
        githubPatConfigured: boolean;
      }>();
      mocks.clearCredential.mockReturnValueOnce(cleared.promise);
      const onClose = vi.fn();
      const onSaved = vi.fn();
      render(<Component isOpen onClose={onClose} onSaved={onSaved} />);
      fireEvent.click(
        await screen.findByRole("button", { name: `Clear ${noun}` }),
      );
      expect(
        screen.getByRole("button", { name: "Clearing..." }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Save & retry" }),
      ).toBeDisabled();
      expect(
        screen.getByLabelText(inputLabel, { selector: "input" }),
      ).toBeDisabled();
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () =>
        cleared.resolve({
          openaiApiKeyConfigured: false,
          githubPatConfigured: false,
        }),
      );
      expect(mocks.clearCredential).toHaveBeenCalledWith(credential);
      expect(onClose).toHaveBeenCalledOnce();
      expect(onSaved).toHaveBeenCalledOnce();
    });

    it("does not retry after a pending save is dismissed", async () => {
      const saved = createDeferred<{
        openaiApiKeyConfigured: boolean;
        githubPatConfigured: boolean;
      }>();
      mocks.saveCredential.mockReturnValueOnce(saved.promise);
      const onClose = vi.fn();
      const onSaved = vi.fn();
      const { rerender } = render(
        <Component isOpen onClose={onClose} onSaved={onSaved} />,
      );
      fireEvent.change(
        screen.getByLabelText(inputLabel, { selector: "input" }),
        {
          target: { value: "test-secret" },
        },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save & retry" }));
      expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
      rerender(
        <Component isOpen={false} onClose={onClose} onSaved={onSaved} />,
      );
      await act(async () =>
        saved.resolve({
          openaiApiKeyConfigured: true,
          githubPatConfigured: true,
        }),
      );
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("resets the copied feedback and secret when reopened", async () => {
      const onClose = vi.fn();
      const { rerender } = render(<Component isOpen onClose={onClose} />);
      fireEvent.change(
        screen.getByLabelText(inputLabel, { selector: "input" }),
        {
          target: { value: "test-secret" },
        },
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Copy prompt for my AI" }),
      );
      await screen.findByRole("button", { name: "Copied! Paste into your AI" });
      rerender(<Component isOpen={false} onClose={onClose} />);
      rerender(<Component isOpen onClose={onClose} />);
      expect(
        screen.getByRole("button", { name: "Copy prompt for my AI" }),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(inputLabel, { selector: "input" }),
      ).toHaveValue("");
    });
  });
});
