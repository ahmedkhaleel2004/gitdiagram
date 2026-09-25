"use client";

import { useState } from "react";

import { formatCompact } from "~/lib/format";
import type { AdminState, ClaudeCredit } from "~/features/admin/types";
import { ConfirmButton } from "./confirm-dialog";
import { Since, Tile } from "./ui";

// Today's budgets and the balances behind them, with the two actions they
// offer: starting a count over and recording the Claude balance.

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Posts an action. Resolves to the error to show, or null and the answer.
 * Signed out meanwhile: back to the sign-in form.
 */
async function post<T = unknown>(
  path: string,
  body: unknown,
  fallback: string,
): Promise<{ error: string; answer?: undefined } | { error: null; answer: T }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (response?.status === 401) {
    window.location.reload();
    return { error: "Signed out. Sign in again." };
  }
  const parsed = (await response?.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (response?.ok) return { error: null, answer: parsed as T };
  return { error: parsed?.error ?? fallback };
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
      onConfirm={async () =>
        (
          await post(
            "/api/admin/reset",
            { target },
            "The reset did not go through. Try again.",
          )
        ).error
      }
      onDone={onDone}
    />
  );
}

/**
 * Records the Claude credit balance the Console shows, after a top-up. The
 * dashboard then counts down from it using the organization's spend since.
 */
function SetClaudeCredit({
  onSaved,
}: {
  onSaved: (credit: ClaudeCredit) => void;
}) {
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
      onConfirm={async () => {
        const { error, answer } = await post<{ credit?: ClaudeCredit }>(
          "/api/admin/claude-credit",
          { usd },
          "The balance was not saved. Try again.",
        );
        if (answer?.credit) onSaved(answer.credit);
        return error;
      }}
      onDone={() => setValue("")}
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
  onCredit,
}: {
  state: AdminState | null;
  onChanged: () => void;
  /** A Claude balance was just saved: show it without waiting for a read. */
  onCredit: (credit: ClaudeCredit) => void;
}) {
  const video = state?.video;
  const quota = state?.diagramQuota;
  const credit =
    typeof state?.claudeCredit === "object" ? state.claudeCredit : null;
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
          label="Voice balance (OpenRouter)"
          value={
            state?.voiceCreditUsd == null
              ? "–"
              : `$${state.voiceCreditUsd.toFixed(2)}`
          }
          sub={
            state?.voicePausedUntil
              ? `Ran out: new videos paused until ${new Date(state.voicePausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : state?.voiceCreditUsd == null
                ? "Balance unreadable"
                : "Prepaid. New videos pause if it runs out."
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
              ? `${formatCompact(quota.usedTokens)} / ${formatCompact(quota.limitTokens)}`
              : "–"
          }
          meter={
            quota?.enabled
              ? quota.usedTokens / Math.max(1, quota.limitTokens)
              : null
          }
          sub={
            quota
              ? `${formatCompact(quota.reservedTokens)} held by runs in progress`
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
            !state ? undefined : state.claudeCredit === "no-key" ? (
              "Needs ANTHROPIC_ADMIN_KEY."
            ) : !credit ? (
              "Anthropic's spend reports could not be read just now. Trying again each minute."
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
          action={
            state && state.claudeCredit !== "no-key" ? (
              <SetClaudeCredit onSaved={onCredit} />
            ) : null
          }
        />
      </div>
    </div>
  );
}
