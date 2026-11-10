"use client";

import { InfoNotice } from "@/components/uploader/Notices";
import { useT } from "@/lib/i18n";

/**
 * The line over an admin tool that was never laid out for a phone — the
 * updateconnector explorer's three panes, the mail editor beside its preview, a
 * dossierconversie's mapping tables. Below `lg` only, and only a word: these are
 * tools Nymbus works in at a desk, so they get no mobile design of their own, but
 * someone who opens one on a phone should hear that from the page rather than
 * conclude from its clipped panes that it is broken.
 */
export default function DesktopOnlyNotice() {
  const t = useT();
  return (
    <div className="shrink-0 px-4 pt-3 lg:hidden">
      <InfoNotice>
        <span className="font-semibold">{t("Gemaakt voor een groot scherm.", "Made for a large screen.")}</span>{" "}
        {t(
          "Op een telefoon past niet alles; open dit onderdeel liever op een laptop.",
          "Not everything fits on a phone; open this part on a laptop instead."
        )}
      </InfoNotice>
    </div>
  );
}
