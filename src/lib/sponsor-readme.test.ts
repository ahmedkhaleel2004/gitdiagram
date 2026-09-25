// @vitest-environment node
import { readFileSync } from "node:fs";
import { format } from "prettier";
import { describe, expect, it } from "vitest";
import { coderabbitCampaign, sentCampaign } from "./sponsor-campaign";
import { sponsorCreatives } from "./sponsor-creative";
import { updateSponsorReadme } from "./sponsor-readme";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("sponsor README block", () => {
  it.each([
    ["Sent", Date.parse(sentCampaign.startsAt)],
    ["CodeRabbit", Date.parse(coderabbitCampaign.startsAt)],
    ["no campaign", Date.parse(coderabbitCampaign.endsAt)],
  ])("is already Prettier-formatted for %s", async (_, now) => {
    const readme = updateSponsorReadme(
      "# Project\n\n<!-- sponsor:start -->\nold ad\n<!-- sponsor:end -->\n\nText\n",
      now,
    );
    expect(await format(readme, { parser: "markdown" })).toBe(readme);
  });

  it("matches the committed README for the current schedule", () => {
    const readme = read("README.md");
    const sponsor = readme.slice(
      readme.indexOf("<!-- sponsor:start -->"),
      readme.indexOf("<!-- sponsor:end -->"),
    );
    const campaign = /\/out\/([a-z0-9-]+)\?/.exec(sponsor)?.[1];
    // Whichever campaign is committed, the block is exactly what the job writes.
    const at =
      campaign === sentCampaign.id
        ? Date.parse(sentCampaign.startsAt)
        : campaign === coderabbitCampaign.id
          ? Date.parse(coderabbitCampaign.startsAt)
          : Date.parse(coderabbitCampaign.endsAt);
    expect(updateSponsorReadme(readme, at)).toBe(readme);
  });

  it("takes the README logo width from the creative", () => {
    const readme = updateSponsorReadme(
      "<!-- sponsor:start --><!-- sponsor:end -->",
      Date.parse(coderabbitCampaign.startsAt),
    );
    expect(readme).toContain(
      `width="${sponsorCreatives[coderabbitCampaign.id].logo.readmeWidth}"`,
    );
  });

  // The workflow runs the script with a bare Bun and no `bun install`.
  it("keeps the README job's import graph free of packages and aliases", () => {
    const files = [
      "scripts/sync-sponsor-readme.ts",
      "src/lib/sponsor-readme.ts",
      "src/lib/sponsor-campaign.ts",
      "src/lib/sponsor-creative.ts",
    ];
    for (const file of files) {
      const specifiers = [
        ...read(file).matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ].map(([, specifier]) => specifier!);
      for (const specifier of specifiers) {
        expect(
          /^(\.{1,2}\/|node:)/.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
        if (specifier.startsWith(".") && !file.startsWith("scripts/")) {
          expect(files).toContain(`src/lib/${specifier.slice(2)}.ts`);
        }
      }
    }
  });
});
