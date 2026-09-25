import { type Metadata } from "next";
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE, isAdminSession } from "~/server/admin/operator";
import { AdminDashboard } from "./admin-dashboard";
import { AdminSignIn } from "./admin-sign-in";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live · GitDiagram",
  robots: { index: false, follow: false },
};

/** The operator's live dashboard. Only the owner of the operator token gets in. */
export default async function AdminPage() {
  const session = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return isAdminSession(session) ? <AdminDashboard /> : <AdminSignIn />;
}
