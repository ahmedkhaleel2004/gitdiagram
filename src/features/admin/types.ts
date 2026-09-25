// Shapes shared by the operator dashboard (/admin) and its API routes.

export type VideoAudience = "priority" | "desktop" | "everyone";

export interface LiveControls {
  videoAudience: VideoAudience;
  videosPaused: boolean;
  videoDailyLimit: number | null;
  videoPersonDailyLimit: number | null;
  videoNetworkDailyLimit: number | null;
}

export interface DailyBudget {
  used: number;
  limit: number;
  personLimit: number;
  networkLimit: number;
}

export interface AdminState {
  now: number;
  controls: LiveControls;
  video: {
    videos: DailyBudget;
    renders: DailyBudget;
  } | null;
  voiceCredits: number | null;
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

/** One open tab, as the presence worker reports it. */
export interface LiveVisitor {
  id: string;
  /** The browser, shared by one person's tabs. */
  b: string;
  p: string;
  v: 0 | 1;
  /** When the tab went to the background (ms), or 0 while in view. */
  h: number;
  d: "d" | "m";
  c: string;
  r: string;
  ct: string;
  ref: string;
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
