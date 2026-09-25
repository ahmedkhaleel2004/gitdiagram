// Shapes shared by the operator dashboard (/admin) and its API routes.

export type VideoAudience = "priority" | "desktop" | "everyone";

/** Which places count as priority (see features/admin/priority-places.ts). */
export type PriorityPlaces = "cities" | "countries";

export interface LiveControls {
  videoAudience: VideoAudience;
  priorityPlaces: PriorityPlaces;
  videosPaused: boolean;
  videoDailyLimit: number | null;
  videoPersonDailyLimit: number | null;
  /** Videos a day for someone in a priority place. */
  videoPriorityPersonDailyLimit: number | null;
  videoNetworkDailyLimit: number | null;
}

interface DailyBudget {
  used: number;
  limit: number;
  personLimit: number;
  networkLimit: number;
}

interface VideoBudget extends DailyBudget {
  priorityPersonLimit: number;
}

/** Claude API credit: the balance last entered from the Console, and spend since. */
export interface ClaudeCredit {
  setUsd: number | null;
  setAt: number | null;
  spentUsd: number;
}

export interface AdminState {
  now: number;
  controls: LiveControls;
  video: {
    videos: VideoBudget;
    renders: DailyBudget;
  } | null;
  /** When new videos can be voiced again (ms); null when they can now or unknown. */
  voicePausedUntil: number | null;
  /** Null when ANTHROPIC_ADMIN_KEY is missing or a report failed. */
  claudeCredit: ClaudeCredit | null;
  diagramQuota: {
    enabled: boolean;
    usedTokens: number;
    reservedTokens: number;
    limitTokens: number;
  } | null;
  /** Where the dashboard opens its live socket, with a short-lived token. */
  presence: { url: string; token: string } | null;
  deployment: { commit: string | null; region: string | null };
}

/**
 * One open tab, as the presence worker reports it. The worker
 * (workers/presence) imports this type too, so both sides agree on it.
 */
export interface LiveVisitor {
  id: string;
  /**
   * The browser: one id shared by all of a person's tabs, so the dashboard
   * can count people, not tabs.
   */
  b: string;
  /** Current path. */
  p: string;
  /** Tab visible (1) or in the background (0). */
  v: 0 | 1;
  /**
   * When the tab went to the background (ms); 0 while in view, and for a tab
   * that opened in the background (nobody has looked at it yet).
   */
  h: number;
  /** Time zones: the browser's own setting, and where its IP address is. */
  z: string;
  iz: string;
  /** Device: desktop or mobile. */
  d: "d" | "m";
  /** Country, region and city from Cloudflare's IP geolocation. */
  c: string;
  r: string;
  ct: string;
  /** The IP address's coordinates, when Cloudflare knows them. */
  la: number | null;
  lo: number | null;
  /** Referring site, host only. */
  ref: string;
  /** Connected at (ms). */
  t: number;
}

export interface LiveJob {
  id: string;
  kind: string;
  label: string;
  started: number;
}

export interface LiveFeedEvent {
  id: number;
  at: number;
  kind: string;
  repo?: string;
  [detail: string]: unknown;
}

export type PresenceMessage =
  | {
      type: "snapshot";
      now: number;
      visitors: LiveVisitor[];
      events: LiveFeedEvent[];
      jobs: LiveJob[];
      peak: { day: string; count: number; at: number };
    }
  | { type: "join"; visitor: LiveVisitor }
  | { type: "update"; id: string; p?: string; v?: 0 | 1; h?: number }
  | { type: "leave"; id: string }
  | { type: "event"; event: LiveFeedEvent }
  | { type: "jobs"; jobs: LiveJob[] }
  | { type: "peak"; peak: { day: string; count: number; at: number } };
