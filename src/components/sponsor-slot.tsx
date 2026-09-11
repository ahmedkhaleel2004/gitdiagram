import { ArrowUpRight } from "lucide-react";
import { cn } from "~/lib/utils";

type SponsorSurface = "home" | "diagram" | "browse";
type ActiveSponsor = {
  name: string;
  body: string;
  href: string;
  cta: string;
  logoText?: string;
  logoSrc?: string;
};

type SponsorSlotProps = {
  surface: SponsorSurface;
  className?: string;
};

const activeSponsor: ActiveSponsor | null = null;

const sponsorCopy: Record<
  SponsorSurface,
  {
    label: string;
    body: string;
    cta: string;
  }
> = {
  home: {
    label: "Homepage sponsor slot",
    body: "Reach developers before they diagram a repository.",
    cta: "Sponsor",
  },
  diagram: {
    label: "Repo diagram sponsor slot",
    body: "Reach developers while they inspect codebase architecture.",
    cta: "Sponsor this spot",
  },
  browse: {
    label: "Browse catalog sponsor slot",
    body: "Reach developers browsing public repository diagrams.",
    cta: "Sponsor",
  },
};

const placeholderSponsor = {
  name: "Your company",
  logoText: "YC",
};

function getSponsor(surface: SponsorSurface) {
  const copy = sponsorCopy[surface];
  const sponsor = activeSponsor;
  return {
    name: sponsor?.name ?? placeholderSponsor.name,
    body: sponsor?.body ?? copy.body,
    cta: sponsor?.cta ?? copy.cta,
    href: sponsor?.href ?? "/sponsor",
    logoText: sponsor?.logoText ?? placeholderSponsor.logoText,
    logoSrc: sponsor?.logoSrc,
    isActive: Boolean(sponsor),
  };
}

function SponsorLogo({
  name,
  logoText,
  logoSrc,
}: {
  name: string;
  logoText?: string;
  logoSrc?: string;
}) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border-[2px] border-black bg-[hsl(var(--neo-button))] text-sm font-black text-black">
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt="" className="h-full w-full object-cover" />
      ) : (
        (logoText ?? name.slice(0, 2))
      )}
    </span>
  );
}

function linkProps(href: string) {
  const isExternal = href.startsWith("http");

  return {
    href,
    target: isExternal ? "_blank" : undefined,
    rel: isExternal ? "noreferrer" : undefined,
  };
}

export function SponsorSlot({ surface, className }: SponsorSlotProps) {
  const copy = sponsorCopy[surface];
  const sponsor = getSponsor(surface);

  return (
    <a
      {...linkProps(sponsor.href)}
      aria-label={copy.label}
      className={cn(
        "neo-lift group flex items-center gap-3 rounded-md border-[2px] border-black bg-[hsl(var(--neo-input-bg))] px-3 py-2 text-left shadow-[3px_3px_0_0_#000] dark:bg-[hsl(var(--neo-panel-muted))]",
        surface === "diagram" &&
          "w-full border-[3px] bg-[hsl(var(--neo-panel))] p-3 shadow-[4px_4px_0_0_#000] dark:bg-[hsl(var(--neo-panel))]",
        className,
      )}
    >
      <SponsorLogo
        name={sponsor.name}
        logoText={sponsor.logoText}
        logoSrc={sponsor.logoSrc}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] leading-none font-black tracking-[0.16em] text-[hsl(var(--neo-soft-text))] uppercase dark:text-neutral-300">
          {sponsor.isActive ? "Sponsored" : "Sponsor slot"}
        </span>
        <span className="mt-1 block text-sm leading-5 font-semibold text-black dark:text-neutral-100">
          <span className="font-black">{sponsor.name}</span>
          <span className="mx-1.5 text-black/55 dark:text-neutral-400">/</span>
          <span className="text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            {sponsor.body}
          </span>
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-sm font-black text-black sm:inline-flex dark:text-neutral-100">
        {sponsor.cta}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </a>
  );
}

export function SponsorCatalogRow() {
  const copy = sponsorCopy.browse;
  const sponsor = getSponsor("browse");

  return (
    <tr
      aria-label={copy.label}
      className="block border-b border-black/15 bg-[hsl(var(--neo-panel-muted))]/60 align-middle lg:table-row dark:border-white/10"
    >
      <td colSpan={4} className="block p-0 lg:table-cell">
        <a
          {...linkProps(sponsor.href)}
          className="group flex flex-col gap-3 px-4 py-4 text-left sm:flex-row sm:items-center sm:justify-between lg:px-5"
        >
          <span className="flex min-w-0 items-center gap-3">
            <SponsorLogo
              name={sponsor.name}
              logoText={sponsor.logoText}
              logoSrc={sponsor.logoSrc}
            />
            <span className="min-w-0">
              <span className="block text-[10px] leading-none font-black tracking-[0.16em] text-[hsl(var(--neo-soft-text))] uppercase dark:text-neutral-300">
                {sponsor.isActive ? "Sponsored" : "Sponsor slot"}
              </span>
              <span className="mt-1 block text-[1.15rem] leading-tight font-black tracking-tight text-black dark:text-neutral-50">
                {sponsor.name}
              </span>
              <span className="mt-1 block text-sm leading-5 font-semibold text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
                {sponsor.body}
              </span>
            </span>
          </span>
          <p className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-md border-[2px] border-black bg-[hsl(var(--neo-button))] px-4 py-2 text-sm font-black text-black shadow-[3px_3px_0_0_#000]">
            {sponsor.cta}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </p>
        </a>
      </td>
    </tr>
  );
}
