// Types for `env` and `exports` from "cloudflare:workers" (used by the tests).
import type { Env as PresenceEnv } from "./index";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "Presence";
    }
    interface Env extends PresenceEnv {}
  }
}
