"use client";

import { useState, type ReactNode } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import Modal, { PickerFooter, PickerHeader } from "@/components/Modal";
import type { MissingGroup, RefusalGroup } from "@/lib/payload-send";

const ICON_BTN =
  "inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md " +
  "text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm";

/**
 * A refusal's heading, rewritable. AFAS's words are what the verzendrapport
 * prints, and for most refusals they name the fix; a bare *AFAS gaf een fout
 * terug (500).* names nothing, and the cause is only found by looking the record
 * up in Profit. The pencil lets whoever did that put the cause in its place — the
 * PDF then leads with it, keeping AFAS's own text small beneath.
 */
function EditableHeading({
  message,
  heading,
  count,
  onChange,
}: {
  message: string;
  heading?: string;
  count: number;
  onChange: (heading: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const tally = count > 1 && (
    <span className="font-normal tabular-nums text-k-text-secondary"> ({count})</span>
  );

  if (draft !== null) {
    const save = () => {
      const text = draft.trim();
      onChange(text && text !== message ? text : null);
      setDraft(null);
    };
    return (
      <div>
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              // Cancels the edit, not the dialog.
              e.stopPropagation();
              setDraft(null);
            }
          }}
          aria-label="Eigen kop voor deze weigering"
          className="neu-input w-full rounded-xl px-4 py-2.5 text-sm"
        />
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p className="text-xs text-k-text-secondary">AFAS: {message}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="neu-button rounded-full px-3 py-1 text-xs font-semibold"
            >
              Annuleren
            </button>
            <button
              type="button"
              onClick={save}
              className="neu-button rounded-full px-3 py-1 text-xs font-semibold"
            >
              Opslaan
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-1">
        <h3 className="min-w-0 flex-1 font-semibold text-k-text-primary">
          {heading ?? message}
          {tally}
        </h3>
        <button
          type="button"
          onClick={() => setDraft(heading ?? message)}
          title="Kop aanpassen voor het verzendrapport"
          aria-label="Kop aanpassen"
          className={ICON_BTN}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        {heading && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Terug naar de melding van AFAS"
            aria-label="Kop herstellen"
            className={ICON_BTN}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
      {heading && <p className="text-xs text-k-text-secondary">AFAS: {message}</p>}
    </div>
  );
}

/** One group: the message once, the rows it applies to under it. */
function Group({
  message,
  items,
  heading,
  onHeadingChange,
}: {
  message: string;
  items: { key: number; rows: string; subject: string; sent: string }[];
  /** Given with `onHeadingChange`, the heading is the user's to rewrite. */
  heading?: string;
  onHeadingChange?: (heading: string | null) => void;
}) {
  return (
    <section>
      {onHeadingChange ? (
        <EditableHeading
          message={message}
          heading={heading}
          count={items.length}
          onChange={onHeadingChange}
        />
      ) : (
        <h3 className="font-semibold text-k-text-primary">
          {message}
          {items.length > 1 && (
            <span className="font-normal tabular-nums text-k-text-secondary"> ({items.length})</span>
          )}
        </h3>
      )}
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item.key} className="pl-3 tabular-nums text-k-text-secondary">
            {item.rows}. {item.subject}
            {item.sent && <span className="font-semibold text-k-text-primary"> {item.sent}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The small caps label over each half, shown only when both halves are there. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-k-text-secondary">{children}</h2>
  );
}

/**
 * Every record AFAS refused in a run, grouped by AFAS's own message
 * (`groupRefusals`): the sentence once, the rows it applies to under it — and,
 * below them, the ticked records the panel never sent because something they look
 * up isn't in AFAS (`groupMissing`): a project whose debiteur is missing, a
 * voorcalculatieregel whose project is. Those were not refused, but they did not
 * land either, and the fix is the same kind: create the missing record, send again.
 *
 * A dialog rather than a list in the refusals notice, which only says how many —
 * forty refusals inline pushed the payload off the screen.
 *
 * A refusal's heading can be rewritten (`headings`, keyed by AFAS's message) for
 * the verzendrapport — see `EditableHeading`. The held-back groups can't: their
 * message is the tool's own, and already says what is missing.
 */
export default function RefusalsDialog({
  groups,
  missing = [],
  environment,
  headings,
  onHeadingChange,
  onClose,
}: {
  groups: RefusalGroup[];
  missing?: MissingGroup[];
  environment: string;
  headings: Map<string, string>;
  onHeadingChange: (message: string, heading: string | null) => void;
  onClose: () => void;
}) {
  const refused = groups.reduce((sum, group) => sum + group.items.length, 0);
  const held = missing.reduce((sum, group) => sum + group.items.length, 0);
  const both = refused > 0 && held > 0;
  const counts = [
    refused > 0 && `${refused} ${refused === 1 ? "weigering" : "weigeringen"}`,
    held > 0 && `${held} niet verstuurd`,
  ].filter(Boolean);
  return (
    <Modal onDismiss={onClose} className="flex max-h-[85vh] max-w-2xl flex-col">
      <PickerHeader title={held > 0 ? "Niet verwerkt" : "Weigeringen"} onClose={onClose}>
        <p className="mt-1 text-sm text-k-text-secondary">
          {both
            ? `Door AFAS geweigerd in ${environment}, of niet verstuurd omdat er iets in AFAS ontbreekt.`
            : held > 0
              ? `Niet verstuurd naar ${environment}: er ontbreekt iets in AFAS.`
              : `Door AFAS geweigerd in ${environment}, gegroepeerd per melding.`}
        </p>
      </PickerHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-k-divider px-6 py-4 text-sm">
        {both && <SectionLabel>Geweigerd door AFAS ({refused})</SectionLabel>}
        {groups.map((group) => (
          <Group
            key={group.message}
            message={group.message}
            heading={headings.get(group.message)}
            onHeadingChange={(heading) => onHeadingChange(group.message, heading)}
            items={group.items.map((item) => ({
              key: item.result.ordinal,
              rows: item.rows,
              subject: item.subject,
              sent: item.sent,
            }))}
          />
        ))}
        {held > 0 && (
          <div className={both ? "space-y-4 border-t border-k-divider pt-4" : "space-y-4"}>
            <SectionLabel>Niet verstuurd — ontbreekt in AFAS ({held})</SectionLabel>
            {missing.map((group) => (
              <Group
                key={group.message}
                message={group.message}
                items={group.items.map((item) => ({ ...item, key: item.ordinal }))}
              />
            ))}
          </div>
        )}
      </div>
      <PickerFooter count={counts.join(" · ")} onClose={onClose} />
    </Modal>
  );
}
