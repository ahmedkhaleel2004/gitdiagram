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
  const creative = campaign && sponsorCreatives[campaign.id];
  let block =
    "> **Ad space** · [Advertise your product here.](https://gitdiagram.com/advertise)";
  if (campaign && creative) {
    const href = `https://gitdiagram.com${sponsorClickHref("readme", campaign.id)}`;
    const { logo } = creative;
    const dark = logo.darkSrc
      ? `<source media="(prefers-color-scheme: dark)" srcset="./public${logo.darkSrc}" />`
      : "";
    const width = campaign.id === "coderabbit-2026-10" ? 156 : 104;
    block = `> <a href="${href}"><picture>${dark}<img src="./public${logo.src}" alt="${creative.name}" width="${width}" align="middle" /></picture></a>&nbsp;&nbsp; <sub>Sponsored</sub>\n>\n> ${creative.message} [${creative.action} →](${href})`;
  }
  return (
    readme.slice(0, readme.indexOf(start)) +
    `${start}\n${block}\n${end}` +
    readme.slice(readme.indexOf(end) + end.length)
  );
}
