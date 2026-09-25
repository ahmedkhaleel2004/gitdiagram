"use client";

import { memo, useMemo, useState } from "react";

import { countryName, flag, tally } from "~/features/admin/format";
import type { LiveVisitor } from "~/features/admin/types";
import { BarList, Panel } from "./ui";

// Where the people here now are: which pages, which countries (open one to
// see its cities), and which sites sent them.
//
// Pages show the path each tab reports, repository pages included. The tab
// cannot tell cheaply whether a repository is private (the GitHub token is
// HttpOnly and the diagram may not have loaded yet), so a private repository
// someone views with their own token can appear here by name. Only the
// operator sees this panel; the live feed, unlike it, never names private
// repositories.

/** Every country on the site now; open one to see its cities. */
function CountryList({
  people,
  mismatched,
}: {
  people: LiveVisitor[];
  mismatched: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const countries = useMemo(() => {
    const byCountry = new Map<string, LiveVisitor[]>();
    for (const person of people) {
      const list = byCountry.get(person.c) ?? [];
      list.push(person);
      byCountry.set(person.c, list);
    }
    return [...byCountry.entries()]
      .map(([code, here]) => ({
        code,
        count: here.length,
        mismatch: here.filter((person) => mismatched.has(person.id)).length,
        cities: tally(
          here,
          (v) => [v.ct, v.r].filter(Boolean).join(", ") || "Unknown",
          Number.POSITIVE_INFINITY,
        ),
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [people, mismatched]);
  if (!countries.length)
    return (
      <p className="text-sm text-[hsl(var(--neo-soft-text))]">Nobody yet.</p>
    );
  const max = Math.max(1, countries[0]!.count);
  const toggle = (code: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  return (
    <ul className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto">
      {countries.map(({ code, count, mismatch, cities }) => {
        const expanded = open.has(code);
        return (
          <li key={code || "unknown"}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(code)}
              className="relative flex w-full cursor-pointer items-center gap-2 text-left text-sm pointer-coarse:min-h-10"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-purple-400/35 dark:bg-purple-400/20"
                style={{ width: `${(count / max) * 100}%` }}
              />
              <span className="relative min-w-0 flex-1 truncate px-1.5 py-0.5">
                <span className="mr-1.5">{flag(code)}</span>
                <span className="font-medium">{countryName(code)}</span>
                {mismatch ? (
                  <span
                    className="ml-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                    title="Browser clock set to a different time zone from this location: often a VPN, sometimes a traveller or a carrier network"
                  >
                    {mismatch} clock/IP mismatch
                  </span>
                ) : null}
                <span className="ml-1.5 text-xs text-[hsl(var(--neo-soft-text))]">
                  {expanded ? "▾" : "▸"}
                </span>
              </span>
              <span className="relative w-12 shrink-0 text-right text-xs text-[hsl(var(--neo-soft-text))] tabular-nums">
                {Math.round((count / people.length) * 100)}%
              </span>
              <span className="relative w-8 shrink-0 text-right font-semibold tabular-nums">
                {count}
              </span>
            </button>
            {expanded ? (
              <ul className="mt-1 mb-1 ml-7 flex flex-col gap-0.5 border-l-2 border-black/15 pl-2 dark:border-white/15">
                {cities.map(([city, here]) => (
                  <li
                    key={city}
                    className="flex items-center justify-between gap-2 text-[13px]"
                  >
                    <span className="min-w-0 truncate">{city}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {here}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export const AudiencePanels = memo(function AudiencePanels({
  people,
  mismatched,
}: {
  people: LiveVisitor[];
  mismatched: ReadonlySet<string>;
}) {
  const pages = useMemo(() => tally(people, (v) => v.p, 8), [people]);
  const sources = useMemo(
    () =>
      tally(
        people,
        (v) => (!v.ref || /gitdiagram\.com$/.test(v.ref) ? "Direct" : v.ref),
        6,
      ),
    [people],
  );
  const countryCount = new Set(people.map((v) => v.c)).size;
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Panel
        title="Pages"
        aside={`${people.length} ${people.length === 1 ? "person" : "people"}`}
      >
        <BarList rows={pages} />
      </Panel>
      <Panel
        title="Countries"
        aside={`${countryCount} ${countryCount === 1 ? "country" : "countries"}`}
      >
        <CountryList people={people} mismatched={mismatched} />
      </Panel>
      <Panel title="Came from">
        <BarList rows={sources} />
      </Panel>
    </div>
  );
});
