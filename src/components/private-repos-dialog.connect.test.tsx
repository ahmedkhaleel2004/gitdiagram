import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrivateReposDialog } from "~/components/private-repos-dialog";
import type * as GitHubConnectModule from "~/features/credentials/github-connect";

const mocks = vi.hoisted(() => ({
  captureAnalyticsEvent: vi.fn(),
  clearCredential: vi.fn(),
  getCredentialStatus: vi.fn(),
  saveCredential: vi.fn(),
}));

vi.mock("~/features/credentials/api", () => ({
  clearCredential: mocks.clearCredential,
  getCredentialStatus: mocks.getCredentialStatus,
  saveCredential: mocks.saveCredential,
}));
vi.mock("~/lib/analytics-client", () => ({
  captureAnalyticsEvent: mocks.captureAnalyticsEvent,
}));
vi.mock("~/features/credentials/github-connect", async (importOriginal) => ({
  ...(await importOriginal<typeof GitHubConnectModule>()),
  GITHUB_CONNECT_ENABLED: true,
}));

const disconnected = {
  openaiApiKeyConfigured: false,
  githubPatConfigured: false,
  githubAppConnected: false,
  githubLogin: null,
};

describe("private repositories dialog with Continue with GitHub", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCredentialStatus.mockResolvedValue(disconnected);
    mocks.clearCredential.mockResolvedValue(disconnected);
  });

  it("leads with Continue with GitHub and folds the token steps away", async () => {
    render(
      <PrivateReposDialog isOpen onClose={vi.fn()} repository="octo/app" />,
    );

    const connect = screen.getByRole("link", { name: "Continue with GitHub" });
    expect(connect).toHaveAttribute(
      "href",
      "/api/github/connect?repo=octo%2Fapp",
    );
    await waitFor(() => expect(connect).toHaveFocus());
    expect(screen.queryByLabelText("GitHub personal access token")).toBeNull();

    fireEvent.click(connect);
    expect(mocks.captureAnalyticsEvent).toHaveBeenCalledWith(
      "github_connect_started",
      { source: "repo", mode: "authorize" },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Use a personal access token instead",
      }),
    );
    expect(
      screen.getByLabelText("GitHub personal access token", {
        selector: "input",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create token on GitHub/u }),
    ).toBeInTheDocument();
  });

  it("keeps the token steps open while a token is saved", async () => {
    mocks.getCredentialStatus.mockResolvedValue({
      ...disconnected,
      githubPatConfigured: true,
    });
    render(<PrivateReposDialog isOpen onClose={vi.fn()} />);

    expect(
      await screen.findByText("Token saved. Paste a new one to replace it."),
    ).toBeInTheDocument();
  });

  it("returns the header's dialog to the page it was opened on", () => {
    render(
      <PrivateReposDialog
        isOpen
        onClose={vi.fn()}
        source="menu"
        returnTo="/browse"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Continue with GitHub" }),
    ).toHaveAttribute("href", "/api/github/connect?from=menu&return=%2Fbrowse");
  });

  it("explains a missing installation and links to pick repositories", () => {
    render(
      <PrivateReposDialog
        isOpen
        onClose={vi.fn()}
        repository="octo/app"
        connectError="no_access"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "GitDiagram can’t see this repository yet.",
    );
    expect(
      screen.getByRole("link", { name: /Choose repositories on GitHub/u }),
    ).toHaveAttribute("href", "/api/github/connect?repo=octo%2Fapp&install=1");
  });

  it("shows the connected account and disconnects it", async () => {
    mocks.getCredentialStatus.mockResolvedValue({
      ...disconnected,
      githubAppConnected: true,
      githubLogin: "octocat",
    });
    render(<PrivateReposDialog isOpen onClose={vi.fn()} />);

    expect(await screen.findByText("@octocat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(mocks.clearCredential).toHaveBeenCalledWith("github_app"),
    );
    await waitFor(() => expect(screen.queryByText("@octocat")).toBeNull());
  });
});
