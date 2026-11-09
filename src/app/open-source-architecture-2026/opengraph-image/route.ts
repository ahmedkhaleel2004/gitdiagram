import { REPORT } from "~/features/architecture-report/content";
import { createReportSocialImage } from "~/server/og/cards";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  const lastEra = REPORT.byEra.at(-1)!;
  const firstEra = REPORT.byEra[0]!;
  return createReportSocialImage({
    kicker: "Data report · November 2026",
    title: `How the ${REPORT.sample.size.toLocaleString("en-US")} most-starred open-source repositories are built`,
    figures: [
      {
        value: `${lastEra.agentActor}%`,
        label: "of repos created since 2025 draw an AI agent as a user",
      },
      {
        value: `${firstEra.agentActor}%`,
        label: "of repos created before 2020",
      },
    ],
  });
}
