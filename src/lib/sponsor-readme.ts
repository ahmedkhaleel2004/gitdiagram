// Runs in the README workflow without `bun install`: keep this file and its
// imports free of packages and path aliases (sponsor-readme.test.ts checks).
import { activeSponsorCampaign, sponsorClickHref } from "./sponsor-campaign";
import { sponsorCreatives } from "./sponsor-creative";

const start = "<!-- sponsor:start -->";
const end = "<!-- sponsor:end -->";

export function updateSponsorReadme(readme: string, now = Date.now()) {
  if (
    readme.split(start).length !== 2 ||
    readme.split(end).length !== 2 ||
    readme.indexOf(end) < readme.indexOf(start)
  ) {
    throw new Error("README must contain exactly one sponsor block.");
  }
  const campaign = activeSponsorCampaign(now);
  let block =
    "> **Ad space** · [Advertise your product here.](https://gitdiagram.com/advertise)";
  if (campaign) {
    const creative = sponsorCreatives[campaign.id];
    const href = `https://gitdiagram.com${sponsorClickHref("readme", campaign.id)}`;
    const { logo } = creative;
    const dark = logo.darkSrc
      ? `<source media="(prefers-color-scheme: dark)" srcset="./public${logo.darkSrc}" />`
      : "";
    block = `> <a href="${href}"><picture>${dark}<img src="./public${logo.src}" alt="${creative.name}" width="${logo.readmeWidth}" align="middle" /></picture></a>&nbsp;&nbsp; <sub>Sponsored</sub>\n>\n> ${creative.message} [${creative.action} →](${href})`;
  }
  // Blank lines inside the markers match Prettier, so formatting never undoes
  // (and re-commits) a scheduled update.
  return (
    readme.slice(0, readme.indexOf(start)) +
    `${start}\n\n${block}\n\n${end}` +
    readme.slice(readme.indexOf(end) + end.length)
  );
}
