// Turns a week of panel answers into the /admin "Prompt gaps" report: per
// engine, how often GitDiagram is named; per missed prompt, one diagnosis and
// one fix; and the external pages cited across the misses (the outreach
// list). Pure, so it is tested on fixed answers.

import {
  PANEL_ENGINES,
  type GapDiagnosis,
  type PanelAnswer,
  type PanelEngine,
  type PanelEngineStats,
  type PanelReport,
  type PromptGap,
} from "~/features/admin/ai-panel";
import type { PanelPrompt } from "./ai-panel-prompts";

const SITE = "https://gitdiagram.com";

// Sites where tools get listed, reviewed or discussed by other people: being
// absent from them is a third-party gap, not something a page of ours fixes.
const THIRD_PARTY_HOSTS = [
  "reddit.com",
  "news.ycombinator.com",
  "medium.com",
  "dev.to",
  "hashnode.dev",
  "hashnode.com",
  "stackoverflow.com",
  "stackexchange.com",
  "youtube.com",
  "producthunt.com",
  "g2.com",
  "capterra.com",
  "alternativeto.net",
  "saashub.com",
  "slashdot.org",
  "sourceforge.net",
  "quora.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "substack.com",
  "freecodecamp.org",
  "dzone.com",
  "hackernoon.com",
  "geeksforgeeks.org",
  "theresanaiforthat.com",
  "futurepedia.io",
  "toolify.ai",
];
const LISTICLE_PATH =
  /(?:^|[/_-])(?:best|top|alternatives?|vs|versus|tools|reviews)(?:[/_.-]|$)/i;

/** A URL without tracking, fragment, `www.` or trailing slash; null if not a URL. */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const key of [...url.searchParams.keys()])
    if (/^(?:utm_|ref$|source$|srsltid$)/i.test(key))
      url.searchParams.delete(key);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.searchParams.toString();
  return `https://${host}${path}${query ? `?${query}` : ""}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isOurs(url: string): boolean {
  const host = hostOf(url);
  return host === "gitdiagram.com" || host.endsWith(".gitdiagram.com");
}

export function isThirdParty(url: string): boolean {
  const host = hostOf(url);
  if (
    THIRD_PARTY_HOSTS.some((site) => host === site || host.endsWith(`.${site}`))
  )
    return true;
  try {
    const path = new URL(url).pathname;
    // A repository or its docs is a product page; an awesome-list is a list.
    if (host === "github.com") return /awesome/i.test(path);
    return LISTICLE_PATH.test(path);
  } catch {
    return false;
  }
}

function emptyStats(): PanelEngineStats {
  return {
    asked: 0,
    answered: 0,
    mentioned: 0,
    cited: 0,
    positionSum: 0,
    costUsd: 0,
  };
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function rank<K>(counts: Map<K, number>, limit: number): Array<[K, number]> {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit);
}

function diagnose(
  prompt: PanelPrompt,
  missed: PanelAnswer[],
  citedInstead: Array<[string, number]>,
): { diagnosis: GapDiagnosis; fix: string } {
  const page = prompt.page ? `${SITE}${prompt.page}` : null;
  if (missed.some((answer) => answer.inSources || answer.ourUrls.length)) {
    const seen = [...new Set(missed.flatMap((answer) => answer.ourUrls))];
    return {
      diagnosis: "weak page",
      fix: `Search found gitdiagram.com${seen.length ? ` (${seen.slice(0, 2).join(", ")})` : ""} but the answer left it out: make ${page ?? "that page"} answer "${prompt.text}" in its title, first heading and first paragraph.`,
    };
  }
  if (!prompt.page)
    return {
      diagnosis: "missing page",
      fix: `No page answers this. Build ${prompt.wanted ?? "a page"} that answers "${prompt.text}" honestly, put it in the sitemap and ping IndexNow.`,
    };
  const external = citedInstead.reduce((sum, [, count]) => sum + count, 0);
  const listed = citedInstead
    .filter(([url]) => isThirdParty(url))
    .reduce((sum, [, count]) => sum + count, 0);
  const topListed = citedInstead.find(([url]) => isThirdParty(url));
  if (external > 0 && listed / external >= 0.25 && topListed)
    return {
      diagnosis: "third-party gap",
      fix: `Engines answer from lists and forums: get GitDiagram on ${topListed[0]} (cited ${topListed[1]}×${citedInstead.length > 1 ? `, then ${citedInstead.find(([url]) => url !== topListed[0] && isThirdParty(url))?.[0] ?? "the next one below"}` : ""}).`,
    };
  return {
    diagnosis: "inaccessible page",
    fix: `${page} exists but no engine's search retrieved it: check it is indexed (Search Console and Bing URL inspection), in the sitemap, and that its title says what this question asks.`,
  };
}

/** The week's report from every answer so far. */
export function buildPanelReport(params: {
  week: string;
  startedAt: string;
  finishedAt: string | null;
  prompts: ReadonlyArray<PanelPrompt>;
  answers: PanelAnswer[];
}): PanelReport {
  const engines = Object.fromEntries(
    PANEL_ENGINES.map((engine) => [engine, emptyStats()]),
  ) as Record<PanelEngine, PanelEngineStats>;
  const models: Partial<Record<PanelEngine, string>> = {};
  const byPrompt = new Map<string, PanelAnswer[]>();
  const competitors = new Map<string, number>();
  let costUsd = 0;
  for (const answer of params.answers) {
    costUsd += answer.costUsd;
    const stats = engines[answer.engine];
    stats.costUsd += answer.costUsd;
    if (answer.error) {
      stats.asked += 1;
      continue;
    }
    models[answer.engine] = answer.model;
    stats.asked += 1;
    stats.answered += 1;
    if (answer.mentioned) stats.mentioned += 1;
    if (answer.ourUrls.length) stats.cited += 1;
    if (answer.position !== null) stats.positionSum += answer.position;
    for (const name of answer.competitors)
      competitors.set(name, (competitors.get(name) ?? 0) + 1);
    const list = byPrompt.get(answer.promptId) ?? [];
    list.push(answer);
    byPrompt.set(answer.promptId, list);
  }
  for (const stats of Object.values(engines))
    stats.costUsd = round(stats.costUsd);

  const gaps: PromptGap[] = [];
  const topCited = new Map<string, number>();
  const topHosts = new Map<string, number>();
  let covered = 0;
  for (const prompt of params.prompts) {
    const answered = byPrompt.get(prompt.id) ?? [];
    if (!answered.length) continue;
    const missed = answered.filter((answer) => !answer.mentioned);
    if (!missed.length) {
      covered += 1;
      continue;
    }
    const cited = new Map<string, number>();
    const named = new Map<string, number>();
    for (const answer of missed) {
      const hosts = new Set<string>();
      for (const url of new Set(answer.otherUrls)) {
        cited.set(url, (cited.get(url) ?? 0) + 1);
        topCited.set(url, (topCited.get(url) ?? 0) + 1);
        hosts.add(hostOf(url));
      }
      for (const host of hosts)
        topHosts.set(host, (topHosts.get(host) ?? 0) + 1);
      for (const name of answer.competitors)
        named.set(name, (named.get(name) ?? 0) + 1);
    }
    const citedInstead = rank(cited, 10);
    gaps.push({
      promptId: prompt.id,
      group: prompt.group,
      text: prompt.text,
      missedBy: missed.map((answer) => answer.engine),
      namedBy: answered
        .filter((answer) => answer.mentioned)
        .map((answer) => answer.engine),
      page: prompt.page,
      ...diagnose(prompt, missed, citedInstead),
      citedInstead,
      competitors: rank(named, 6).map(([name]) => name),
    });
  }
  // Worst first: missed by the most engines, then the most-cited elsewhere.
  gaps.sort(
    (a, b) =>
      b.missedBy.length - a.missedBy.length ||
      a.namedBy.length - b.namedBy.length ||
      b.citedInstead.length - a.citedInstead.length,
  );
  return {
    week: params.week,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    costUsd: round(costUsd),
    prompts: params.prompts.length,
    models,
    engines,
    covered,
    gaps,
    topCited: rank(topCited, 40),
    topHosts: rank(topHosts, 25),
    competitors: rank(competitors, 20),
  };
}
