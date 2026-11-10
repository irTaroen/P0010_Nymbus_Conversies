"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import ManagementReport from "@/components/ManagementReport";
import { NavigationGuardProvider } from "@/components/NavigationGuard";
import RouteNotice from "@/components/RouteNotice";
import { useT } from "@/lib/i18n";
import { parseStatusFilter } from "@/lib/project-filters";
import { HOME_PATH } from "@/lib/routes";

/**
 * `/voortgang` — the managementrapport over several projects. The body is
 * [`ManagementReport`](../../components/ManagementReport.tsx).
 *
 * **A page of its own, beside the project shell**, for the reason
 * `/afas/updateconnectors` is: it is about many projects, so there is no one project
 * to hang it under and no sidebar. A static segment beats `[project]`, so this
 * address can never be read as a project id.
 *
 * For admins and managers (project managers, team leads — the Nymbus logins),
 * with a fallback rather than an empty screen for anyone else. It is a manager's
 * home — `/` forwards them here — and their way into a project, through each
 * card's *Openen*. Cosmetic as
 * everywhere in this app: `GET /api/voortgang/{id}` checks the role itself.
 *
 * `q` and `status` are the project picker's search and filter, carried over by
 * `managementReportPath()` — read behind a `Suspense` boundary, as `useSearchParams`
 * requires.
 */
function ManagementReportPageContent() {
  const searchParams = useSearchParams();
  const { isAdmin, isManager } = useAuth();
  const t = useT();
  if (!isAdmin && !isManager) {
    return (
      <RouteNotice
        title={t("Alleen voor Nymbus", "For Nymbus only")}
        description={t(
          "Het managementrapport geeft de stand van zaken over alle projecten en is alleen zichtbaar voor Nymbus.",
          "The management report shows the status of all projects and is only visible to Nymbus.",
        )}
        action={{ href: HOME_PATH, label: t("Naar mijn projecten", "To my projects") }}
      />
    );
  }
  return (
    <ManagementReport
      initialQuery={searchParams.get("q") ?? ""}
      initialStatus={parseStatusFilter(searchParams.get("status"))}
    />
  );
}

export default function ManagementReportPage() {
  return (
    <NavigationGuardProvider>
      <Suspense fallback={null}>
        <ManagementReportPageContent />
      </Suspense>
    </NavigationGuardProvider>
  );
}
