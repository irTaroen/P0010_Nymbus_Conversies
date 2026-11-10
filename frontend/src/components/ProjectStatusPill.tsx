import { useT } from "@/lib/i18n";

/**
 * A project's AFAS status as a pill, in AFAS's own words.
 *
 * One component rather than a `statusToneClass` in each picker, which is what
 * this was: the same three lines stood in [`ProjectPickerModal`](./ProjectPickerModal.tsx)
 * and [`UserPickerModal`](./UserPickerModal.tsx), and a project has to read the
 * same whichever of the two an admin meets it in.
 */

/**
 * The two project statuses this tool recognises by name — AFAS's own words,
 * compared case-insensitively since it's free text out of AFAS, not a code, and
 * no other value is documented anywhere. `REALISATIE_STATUS` also decides which
 * grid a project falls into in the project picker (`isWorkable`);
 * `AFGEMELD_STATUS` never has — a deregistered project has no more dossieritem
 * work than any other non-realisatie status. Both colour the pill below and
 * appear as options in that picker's filter.
 */
export const REALISATIE_STATUS = "realisatie";
export const AFGEMELD_STATUS = "afgemeld";

/**
 * Which of the status-badge inks a status word gets. Each is one hue: a tinted
 * inset well with full-strength letters — the same inset pill the HRM/ERP category
 * tags in [`ProjectPickerModal`](./ProjectPickerModal.tsx) are drawn as, so both
 * kinds of badge in a row are made the same way and a status reads as a pressed-in
 * label rather than as a solid marker stamped on the row. All four inks sit at the same
 * strength (the `--k-*-fg` / `--k-*-bg` pairs in `globals.css`), so a column of them reads as
 * one family of answers rather than as badges of differing importance.
 *
 * Only the two statuses above get a hue: green for Realisatie, red for Afgemeld.
 * Everything else gets the **neutral grey**, which is the point of it — it's free
 * text out of AFAS with no documented meaning, so a green or a red on it would be
 * a claim this tool can't make. The module status dot in the sidebar can afford
 * four hues because its eighteen codes are documented (`moduleStatusTone()`); a
 * project's status is a different table this tool has only ever had reason to read
 * two words out of.
 */
function statusToneClass(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === REALISATIE_STATUS)
    return "bg-k-green-bg text-k-green-fg shadow-inset-sm";
  if (normalized === AFGEMELD_STATUS)
    return "bg-k-red-bg text-k-red-fg shadow-inset-sm";
  return "bg-k-grey-bg text-k-grey-fg shadow-inset-sm";
}

export default function ProjectStatusPill({
  status,
  className = "",
}: {
  /** AFAS's own word for it (*Realisatie*). Renders nothing when empty. */
  status: string;
  className?: string;
}) {
  const t = useT();
  if (status.trim() === "") return null;
  return (
    <span
      /* `rounded-full`, the same radius the category tags beside it carry: the
         two are one family of badges, and what tells a verdict at the end of a row
         from a fact in the middle of it is its ink and its place, not its
         silhouette. */
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusToneClass(status)} ${className}`.trim()}
    >
      <span className="sr-only">{t("status: ", "AFAS status: ")}</span>
      {/* Its own element, not text straight in the flex container: an anonymous
          flex item can't take an ellipsis, so a long unrecognised status would
          overrun its column instead of truncating. */}
      <span className="truncate">{status}</span>
    </span>
  );
}
