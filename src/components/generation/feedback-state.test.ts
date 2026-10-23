import { describe, expect, it } from "vitest";

import { feedbackState } from "./feedback-state";

function failure(errorCode: string) {
  return feedbackState(
    { status: "error", error: "Explained in words.", errorCode },
    false,
    false,
    0,
    0,
  );
}

describe("feedbackState for commit errors", () => {
  it.each([
    ["COMMIT_SHA_INVALID", "That isn’t a valid commit SHA"],
    ["COMMIT_NOT_FOUND", "We couldn’t find that commit"],
    ["COMMIT_AMBIGUOUS", "That short SHA matches several commits"],
  ])("titles %s", (errorCode, title) => {
    expect(failure(errorCode)).toMatchObject({
      failed: true,
      title,
      description: "Explained in words.",
    });
  });

  it("keeps the generic title for other errors", () => {
    expect(failure("SOMETHING_ELSE").title).toBe(
      "Couldn’t generate the diagram",
    );
  });

  it("keeps the access title for a private repository without a token", () => {
    expect(failure("GITHUB_AUTH_REQUIRED").title).not.toMatch(/commit/iu);
  });
});
