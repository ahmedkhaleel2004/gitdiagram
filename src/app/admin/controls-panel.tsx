"use client";

import { useRef, useState } from "react";

import { Switch } from "~/components/ui/switch";
import { setAdminTools, useAdminTools } from "~/features/admin/tools";
import type {
  AdminState,
  LiveControls,
  PriorityPlaces,
  VideoAudience,
} from "~/features/admin/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Panel, TOUCH } from "./ui";

// The live switches for video making. Each applies within about a second.
// The riskiest ones (opening video making to everyone, dropping a limit
// override back to the deployment's default) ask first.

type Change = (patch: Partial<LiveControls>) => Promise<string | null>;

interface Choice<T> {
  value: T;
  label: string;
  hint: string;
}

const AUDIENCES: Array<Choice<VideoAudience>> = [
  {
    value: "priority",
    label: "Priority places",
    hint: "Any device in the priority places below",
  },
  {
    value: "desktop",
    label: "All desktops",
    hint: "Priority places, plus any desktop",
  },
  { value: "everyone", label: "Everyone", hint: "Every device, anywhere" },
];

const PLACES: Array<Choice<PriorityPlaces>> = [
  {
    value: "cities",
    label: "Cities",
    hint: "CA, WA, NY, Ontario, BC, London and Paris",
  },
  {
    value: "countries",
    label: "US, Canada & UK",
    hint: "All of all three, plus Paris",
  },
];

/**
 * A live setting as a radio group. Arrow keys, Home and End move between
 * the choices; Space or Enter picks one. (Moving does not pick, as it would
 * in a form, because each pick goes live at once.)
 */
function ChoicePicker<T extends string>({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: Array<Choice<T>>;
  value: T;
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((option) => option.value === value);
  const tabStop = focused ?? selected;

  const move = (event: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-2 ${options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(null);
      }}
    >
      {options.map((option, index) => {
        const checked = index === selected;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (option.value !== value) onPick(option.value);
            }}
            onKeyDown={(event) => move(event, index)}
            onFocus={() => setFocused(index)}
            className={`rounded-md border-[3px] border-black p-3 text-left transition-transform active:scale-[0.98] ${
              checked
                ? "bg-purple-400 shadow-[4px_4px_0_0_#000] dark:bg-[hsl(var(--neo-button))] dark:text-black"
                : "bg-white hover:bg-purple-100 dark:bg-black/20 dark:hover:bg-black/30"
            }`}
          >
            <div className="font-bold">{option.label}</div>
            <div className="text-xs opacity-80">{option.hint}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Who can make new videos; opening it to everyone asks first. */
function AudiencePicker({
  value,
  disabled,
  change,
}: {
  value: VideoAudience;
  disabled: boolean;
  change: Change;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ChoicePicker
        label="Who can make new videos"
        options={AUDIENCES}
        value={value}
        disabled={disabled}
        onPick={(option) => {
          if (option === "everyone") setConfirming(true);
          else void change({ videoAudience: option });
        }}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Let everyone make videos?"
        description="Anyone, on any device, anywhere, can start new videos within a second. The daily limits still apply."
        confirmLabel="Yes, open to everyone"
        busyLabel="Saving…"
        onConfirm={() => change({ videoAudience: "everyone" })}
      />
    </>
  );
}

// The highest overrides the server accepts (api/admin/controls).
const MAX_DAILY = 10_000;
const MAX_PER_PERSON = 1_000;

function LimitField({
  label,
  override,
  effective,
  max,
  disabled,
  onSave,
}: {
  label: string;
  override: number | null;
  effective: number | undefined;
  max: number;
  disabled: boolean;
  onSave: (value: number | null) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const parsed = Number.parseInt(draft, 10);
  const tooHigh = Number.isSafeInteger(parsed) && parsed > max;
  const valid = draft !== "" && Number.isSafeInteger(parsed) && !tooHigh;
  const save = async (value: number | null) => {
    setError(null);
    const failure = await onSave(value);
    setError(failure);
    return failure;
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-semibold">{label}</div>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          aria-invalid={tooHigh}
          value={draft}
          placeholder={effective === undefined ? "" : String(effective)}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
          className={`neo-input h-10 w-24 rounded-md bg-white px-3 font-mono tabular-nums ${TOUCH}`}
          aria-label={label}
        />
        <button
          type="button"
          disabled={!valid || disabled}
          aria-label={`Set ${label.toLowerCase()}`}
          onClick={() => {
            void save(parsed);
            setDraft("");
          }}
          className={`neo-button h-10 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${TOUCH}`}
        >
          Set
        </button>
        {override !== null ? (
          <ResetLimit
            label={label}
            override={override}
            disabled={disabled}
            onReset={() => save(null)}
          />
        ) : null}
      </div>
      {tooHigh || error ? (
        <div role="alert" className="text-xs text-red-700 dark:text-red-400">
          {tooHigh ? `At most ${max.toLocaleString("en-US")}` : error}
        </div>
      ) : (
        <div className="text-xs text-[hsl(var(--neo-soft-text))]">
          {override !== null
            ? "Set here, overriding the default"
            : "Default from the deployment"}
        </div>
      )}
    </div>
  );
}

function ResetLimit({
  label,
  override,
  disabled,
  onReset,
}: {
  label: string;
  override: number;
  disabled: boolean;
  onReset: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Reset ${label.toLowerCase()} to the default`}
        onClick={() => setOpen(true)}
        className={`neo-button-muted h-10 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${TOUCH}`}
      >
        Reset
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Go back to the default?"
        description={`${label} goes from ${override} back to the deployment's default, which may be higher, within a second.`}
        confirmLabel="Yes, use the default"
        busyLabel="Saving…"
        onConfirm={onReset}
      />
    </>
  );
}

export function ControlsPanel({
  state,
  saving,
  saveError,
  change,
}: {
  state: AdminState | null;
  saving: boolean;
  saveError: string | null;
  change: Change;
}) {
  const adminTools = useAdminTools();
  const controls = state?.controls;
  const video = state?.video;
  return (
    <Panel
      title="Video making"
      className="lg:col-span-3"
      aside={
        saving ? (
          "Saving…"
        ) : saveError ? (
          <span className="text-red-700 dark:text-red-400">{saveError}</span>
        ) : (
          "Changes are live in about a second"
        )
      }
    >
      {controls ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">Who can make new videos</div>
            <AudiencePicker
              value={controls.videoAudience}
              disabled={saving}
              change={change}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">Priority places</div>
            <p className="text-xs text-[hsl(var(--neo-soft-text))]">
              People here get more videos a day, and their first one each day is
              made wholly with Claude Opus. For everyone else, Opus writes the
              script and GPT-6 Sol designs the scenes, except on repositories
              with 10,000+ stars, which are all Opus.
            </p>
            <ChoicePicker
              label="Priority places"
              options={PLACES}
              value={controls.priorityPlaces}
              disabled={saving}
              onPick={(option) => void change({ priorityPlaces: option })}
            />
          </div>
          <label className="flex items-center justify-between gap-4 rounded-md border-2 border-black bg-white/70 p-3 dark:bg-black/20">
            <span>
              <span className="block font-semibold">Pause all new videos</span>
              <span className="block text-xs text-[hsl(var(--neo-soft-text))]">
                Watching and downloading keep working. You can still make
                videos.
              </span>
            </span>
            <Switch
              checked={controls.videosPaused}
              disabled={saving}
              onCheckedChange={(checked) =>
                void change({ videosPaused: checked })
              }
              aria-label="Pause all new videos"
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-md border-2 border-black bg-white/70 p-3 dark:bg-black/20">
            <span>
              <span className="block font-semibold">
                Show admin controls on video pages
              </span>
              <span className="block text-xs text-[hsl(var(--neo-soft-text))]">
                Adds a Regenerate video button, in this browser only. Turn it
                off to see pages the way visitors do.
              </span>
            </span>
            <Switch
              checked={adminTools}
              onCheckedChange={setAdminTools}
              aria-label="Show admin controls on video pages"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <LimitField
              label="New videos per day"
              override={controls.videoDailyLimit}
              effective={video?.videos.limit}
              max={MAX_DAILY}
              disabled={saving}
              onSave={(value) => change({ videoDailyLimit: value })}
            />
            <LimitField
              label="Per person per day"
              override={controls.videoPersonDailyLimit}
              effective={video?.videos.personLimit}
              max={MAX_PER_PERSON}
              disabled={saving}
              onSave={(value) => change({ videoPersonDailyLimit: value })}
            />
            <LimitField
              label="Per priority person per day"
              override={controls.videoPriorityPersonDailyLimit}
              effective={video?.videos.priorityPersonLimit}
              max={MAX_PER_PERSON}
              disabled={saving}
              onSave={(value) =>
                change({ videoPriorityPersonDailyLimit: value })
              }
            />
            <LimitField
              label="Per connection per day (backstop)"
              override={controls.videoNetworkDailyLimit}
              effective={video?.videos.networkLimit}
              max={MAX_PER_PERSON}
              disabled={saving}
              onSave={(value) => change({ videoNetworkDailyLimit: value })}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--neo-soft-text))]">Loading…</p>
      )}
    </Panel>
  );
}
