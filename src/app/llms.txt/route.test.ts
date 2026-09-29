// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET as full, dynamic as fullDynamic } from "../llms-full.txt/route";
import { GET, dynamic } from "./route";

describe("/llms.txt and /llms-full.txt", () => {
  it("are static Markdown", async () => {
    expect(dynamic).toBe("force-static");
    expect(fullDynamic).toBe("force-static");
    for (const response of [GET(), full()]) {
      expect(response.headers.get("content-type")).toBe(
        "text/markdown; charset=utf-8",
      );
      expect(await response.text()).toMatch(/^# GitDiagram\n/);
    }
  });

  it("puts the guide only in the full file", async () => {
    expect(await GET().text()).not.toContain("### Questions");
    expect(await full().text()).toContain("### Questions");
  });
});
