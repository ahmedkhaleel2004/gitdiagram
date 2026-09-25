"use client";

import { useState } from "react";

import type { AdminState } from "~/features/admin/types";
import { ConfirmButton } from "./confirm-dialog";
import { compact, number, Since, Tile } from "./ui";

// Today's budgets and the balances behind them, with the two actions they
// offer: starting a count over and recording the Claude balance.

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

async function post(
  path: string,
  body: unknown,
  fallback: string,
): Promise<string | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response?.ok) return null;
  const parsed = (await response?.json().catch(() => null)) as {
    error?: string;
  } | null;
  return parsed?.error ?? fallback;
}

/**
 * Starts today's count over for everyone, after the operator confirms in a
 * dialog. Nothing changes until "Yes, reset" is pressed.
 */
function ResetUsage({
  target,
  used,
  onDone,
}: {
  target: "videos" | "renders";
  used: number;
  onDone: () => void;
}) {
  const noun = target === "videos" ? "videos" : "MP4 downloads";
  const counted =
    used === 1 ? (target === "videos" ? "video" : "MP4 download") : noun;
  return (
    <ConfirmButton
      label="Reset today's count"
      ariaLabel={`Reset today's ${target === "videos" ? "video" : "MP4"} count`}
      title={`Reset today's ${noun}?`}
      description={
        <>
          This sets today&apos;s {used} {counted} back to 0 and clears every
          person&apos;s and connection&apos;s count for today, so everyone can
          make {noun} again right away. It cannot be undone.
        </>
      }
      confirmLabel="Yes, reset"
      busyLabel="Resetting…"
      onConfirm={() =>
        post(
          "/api/admin/reset",
          { target },
          "The reset did not go through. Try again.",
        )
      }
      onDone={onDone}
    />
  );
}

/**
 * Records the Claude credit balance the Console shows, after a top-up. The
 * dashboard then counts down from it using the organization's spend since.
 */
function SetClaudeCredit({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const usd = Number(value.replace(/[$,\s]/g, ""));
  const valid = value.trim() !== "" && Number.isFinite(usd) && usd >= 0;
  return (
    <ConfirmButton
      label="Update balance"
      ariaLabel="Update the Claude balance"
      title="Update the Claude balance"
      description={
        <>
          Anthropic has no API for the balance, so copy it from the{" "}
          <a
            href="https://platform.claude.com/settings/billing"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Console billing page
          </a>{" "}
          after each top-up. From then on, spend is taken off it every minute.
          Keep auto-reload off, or the number drifts low.
        </>
      }
      confirmLabel="Save balance"
      busyLabel="Saving…"
      canConfirm={valid}
      onConfirm={() =>
        post(
          "/api/admin/claude-credit",
          { usd },
          "The balance was not saved. Try again.",
        )
      }
      onDone={() => {
        setValue("");
        onDone();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Balance in the Console (USD)
        <input
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="50.46"
          className="h-11 rounded-md border-2 border-black bg-white px-3 text-base font-normal text-black tabular-nums"
        />
      </label>
    </ConfirmButton>
  );
}

export function BudgetTiles({
  state,
  onChanged,
}: {
  state: AdminState | null;
  onChanged: () => void;
}) {
  const video = state?.video;
  const quota = state?.diagramQuota;
  const credit = state?.claudeCredit;
  const creditSet = credit?.setUsd != null && credit.setAt != null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:col-span-2">
      <Tile
        label="Videos today"
        value={video ? `${video.videos.used} / ${video.videos.limit}` : "–"}
        meter={
          video ? video.videos.used / Math.max(1, video.videos.limit) : null
        }
        sub={
          video
            ? `${video.videos.personLimit} per person · ${video.videos.networkLimit} per connection`
            : undefined
        }
        action={
          video ? (
            <ResetUsage
              target="videos"
              used={video.videos.used}
              onDone={onChanged}
            />
          ) : null
        }
      />
      <Tile
        label="MP4s today"
        value={video ? `${video.renders.used} / ${video.renders.limit}` : "–"}
        meter={
          video ? video.renders.used / Math.max(1, video.renders.limit) : null
        }
        action={
          video ? (
            <ResetUsage
              target="renders"
              used={video.renders.used}
              onDone={onChanged}
            />
          ) : null
        }
      />
      <div className="col-span-2">
        <Tile
          label="Voice credits"
          value={
            state?.voiceCredits == null
              ? "–"
              : compact.format(state.voiceCredits)
          }
          sub={
            state?.voiceCredits == null
              ? "Balance unreadable"
              : `≈ ${number.format(Math.floor(state.voiceCredits / 800))} videos left`
          }
        />
      </div>
      <div className="col-span-2">
        <Tile
          label={
            quota?.enabled
              ? "Free diagram tokens today"
              : "Free diagram tokens today (cap off)"
          }
          value={
            quota
              ? `${compact.format(quota.usedTokens)} / ${compact.format(quota.limitTokens)}`
              : "–"
          }
          meter={
            quota?.enabled
              ? quota.usedTokens / Math.max(1, quota.limitTokens)
              : null
          }
          sub={
            quota
              ? `${compact.format(quota.reservedTokens)} held by runs in progress`
              : undefined
          }
        />
      </div>
      <div className="col-span-2">
        <Tile
          label="Claude API credit"
          value={
            credit && creditSet
              ? dollars.format(credit.setUsd! - credit.spentUsd)
              : "–"
          }
          meter={
            credit && creditSet
              ? credit.spentUsd / Math.max(0.01, credit.setUsd!)
              : null
          }
          sub={
            !state ? undefined : !credit ? (
              "Unreadable. Needs ANTHROPIC_ADMIN_KEY."
            ) : creditSet ? (
              <>
                {dollars.format(credit.spentUsd)} spent since{" "}
                {dollars.format(credit.setUsd!)} was entered{" "}
                <Since ms={credit.setAt!} /> ago · updates each minute
              </>
            ) : (
              "Enter the balance from the Console to start counting."
            )
          }
          action={credit ? <SetClaudeCredit onDone={onChanged} /> : null}
        />
      </div>
    </div>
  );
}
