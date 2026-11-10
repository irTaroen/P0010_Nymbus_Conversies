"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminOnly from "@/components/AdminOnly";
import DesktopOnlyNotice from "@/components/DesktopOnlyNotice";
import RouteNotice from "@/components/RouteNotice";
import UpdateConnectorExplorer from "@/components/afas/UpdateConnectorExplorer";
import { NavigationGuardProvider } from "@/components/NavigationGuard";
import { HOME_PATH } from "@/lib/routes";

/**
 * `/afas/updateconnectors` — what an AFAS UpdateConnector accepts, read from AFAS's
 * own metainfo. The body is [`UpdateConnectorExplorer`](../../../components/afas/UpdateConnectorExplorer.tsx).
 *
 * **A page of its own, beside the project shell rather than inside it.** A connector
 * schema belongs to an *environment*, not to a project: the dossier connectors are in
 * Nymbus's live environment and the module ones in the template environment every
 * customer environment copies. So there is no project to hang this under and no
 * sidebar here; the explorer carries its own header and its own way back.
 *
 * A static segment beats `[project]` at the same level, so this address is safe from
 * the project route below it: `/afas/...` can never be read as a project id.
 *
 * Admin-only, with a `fallback` rather than an empty screen — a whole page that is
 * admin-only is better off saying so. The gate is cosmetic, as everywhere in this
 * app; the two endpoints behind it check again (`_require_admin` in main.py).
 *
 * `NavigationGuardProvider` because the header links with `GuardedLink` and every
 * in-app link in this app is one. Nothing installs a guard here — there is no open
 * sheet to leave — so the links simply go through.
 *
 * The `from` query param — the project whose sidebar sent us here, added by
 * `updateConnectorsPath` — is read behind its own `Suspense` boundary: reading it
 * is what makes this route dynamic, and `useSearchParams` requires that boundary
 * so the build can still prerender the shell around it.
 */
function UpdateConnectorsPageContent() {
  const searchParams = useSearchParams();
  const fromProjectId = searchParams.get("from");
  // Which connector to open on arrival — see `updateConnectorsPath`.
  const initialConnector = searchParams.get("connector");
  return (
    <AdminOnly
      fallback={
        <RouteNotice
          title="Alleen voor beheerders"
          description="De opbouw van de AFAS-updateconnectors is onderdeel van de koppeling en alleen zichtbaar voor Nymbus."
          action={{ href: HOME_PATH, label: "Naar mijn projecten" }}
        />
      }
    >
      <DesktopOnlyNotice />
      <UpdateConnectorExplorer
        fromProjectId={fromProjectId}
        initialConnector={initialConnector}
      />
    </AdminOnly>
  );
}

export default function UpdateConnectorsPage() {
  return (
    <NavigationGuardProvider>
      <Suspense fallback={null}>
        <UpdateConnectorsPageContent />
      </Suspense>
    </NavigationGuardProvider>
  );
}
