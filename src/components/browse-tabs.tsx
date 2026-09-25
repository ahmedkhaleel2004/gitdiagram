import Link from "next/link";
import { NewBadge } from "./new-badge";

const VIDEOS_ENABLED = process.env.NEXT_PUBLIC_VIDEO_EXPLAINER === "1";

/** Switches between the diagram catalog and the explainer videos. */
export function BrowseTabs({ active }: { active: "diagrams" | "videos" }) {
  if (!VIDEOS_ENABLED) return null;
  const tab = (current: boolean) =>
    `${current ? "neo-button" : "browse-muted-button"} inline-flex min-h-[44px] items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold`;
  return (
    <nav aria-label="Browse" className="mb-5 flex flex-wrap gap-3">
      <Link
        href="/browse"
        aria-current={active === "diagrams" ? "page" : undefined}
        className={tab(active === "diagrams")}
      >
        Diagrams
      </Link>
      <Link
        href="/videos"
        aria-current={active === "videos" ? "page" : undefined}
        className={tab(active === "videos")}
      >
        Videos
        <NewBadge />
      </Link>
    </nav>
  );
}
