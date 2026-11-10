"use client";

import { useEffect, useMemo, useState } from "react";
import { DatabaseSearch, Loader2 } from "lucide-react";

import Modal, { ModalButton, ModalCloseButton } from "@/components/Modal";
import { useOptionalProject } from "@/components/ProjectProvider";
import type { AfasSchemaField } from "@/lib/afas-schema";
import {
  fetchGetConnectorPreview,
  fetchGetConnectors,
  type AfasLookup,
  type GetConnectorInfo,
  type GetConnectorPreview,
} from "@/lib/afas-lookup";

/** A column of the open sheet, as the dialog offers it. */
export interface LookupColumn {
  index: number;
  header: string;
}

/** What the dialog hands back: the lookup, and the column whose cell it matches. */
export interface LookupChoice {
  lookup: AfasLookup;
  column: LookupColumn;
}

type Listing =
  | { status: "loading" }
  | { status: "ready"; connectors: GetConnectorInfo[]; message: string }
  | { status: "error"; message: string };

type Preview =
  | { key: string; status: "ready"; data: GetConnectorPreview }
  | { key: string; status: "error"; message: string };

const select =
  "neu-input h-9 min-w-0 rounded-full px-4 text-sm";

/** One numbered line of the sentence the lookup is built as. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm text-k-text-secondary">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-k-bg text-xs font-semibold text-k-text-primary shadow-inset-sm">
        {n}
      </span>
      {children}
    </li>
  );
}

/**
 * *Opzoeken in AFAS* — the dialog behind a field's lookup button: fill this field
 * with a value AFAS holds, found by a cell of the sheet (`FieldSource.lookup`, see
 * [`afas-lookup.ts`](../../lib/afas-lookup.ts)).
 *
 * Built as the sentence it stores — *zoek in* a GetConnector, *de rij waar* one of
 * its fields *gelijk is aan* a column of the sheet, *en neem* another field — because
 * that is the whole of the rule and each blank is one choice. Under it, the
 * connector's first rows with the two chosen fields tinted: the field **ids** are
 * regularly not what the labels suggest (`CON_ERP_Projecten`: id `Project_naam`,
 * label `ProjectNaam`), and seeing `VR10004` under *Debiteur* and `1000001` under
 * *Nummer* is what makes a wrong pick visible before it is saved.
 *
 * The connectors and the preview come from the mapping's own group environment — the
 * template, like the schema beside it. The values a payload actually receives are
 * read later, from the project's own environment at the stage being sent to; the
 * dialog says so, since the preview's numbers are not the ones that will be sent.
 *
 * Escape is handled here and stopped: the explorer is itself often inside a `Modal`,
 * and both listen on `document`, so an unstopped Escape would close the mapping
 * editor behind this dialog too.
 */
export default function AfasLookupDialog({
  field,
  group,
  columns,
  initial,
  onSave,
  onRemove,
  onClose,
}: {
  /** The UpdateConnector field being filled — `BcId`. */
  field: AfasSchemaField;
  /** The environment group the connectors are listed from — `modules`. */
  group: string;
  /** The open sheet's columns; empty when no template is open. */
  columns: LookupColumn[];
  /** The field's current column and lookup, when it has them. */
  initial: { column: LookupColumn | null; lookup: AfasLookup | null };
  onSave: (choice: LookupChoice) => void;
  /** Take the lookup off, keeping the column. Absent when there is none. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  // The open project's environment when there is one; otherwise the backend picks
  // the first project with AFAS details (the explorer page has no project).
  const projectId = useOptionalProject()?.selectedProject.id ?? null;
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [connector, setConnector] = useState(initial.lookup?.connector ?? "");
  // What the text box holds when the list can't be read — committed to `connector`
  // on *Ophalen*, so a half-typed name doesn't fetch on every key.
  const [typed, setTyped] = useState(initial.lookup?.connector ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [matchField, setMatchField] = useState(initial.lookup?.matchField ?? "");
  const [valueField, setValueField] = useState(initial.lookup?.valueField ?? "");
  // Every column the dialog can offer: the sheet's, plus the field's own when no
  // sheet is open (a saved mapping opened without its template).
  const offered = useMemo(() => {
    const own = initial.column;
    if (!own || columns.some((column) => column.index === own.index)) return columns;
    return [own, ...columns];
  }, [columns, initial.column]);
  const [columnIndex, setColumnIndex] = useState<number | null>(
    initial.column?.index ?? null,
  );

  useEffect(() => {
    let live = true;
    fetchGetConnectors(group, projectId)
      .then(({ connectors, message }) => {
        if (live) setListing({ status: "ready", connectors, message });
      })
      .catch((error: unknown) => {
        if (live)
          setListing({
            status: "error",
            message: error instanceof Error ? error.message : "De lijst kon niet worden gelezen.",
          });
      });
    return () => {
      live = false;
    };
  }, [group, projectId]);

  useEffect(() => {
    if (!connector) return;
    let live = true;
    const key = `${group}/${connector}`;
    fetchGetConnectorPreview(group, connector, projectId)
      .then((data) => {
        if (live) setPreview({ key, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (live)
          setPreview({
            key,
            status: "error",
            message: error instanceof Error ? error.message : `${connector} kon niet worden gelezen.`,
          });
      });
    return () => {
      live = false;
    };
  }, [group, connector, projectId]);

  // A preview for another connector is stale — derived, so a switch reads as loading.
  const current = preview?.key === `${group}/${connector}` ? preview : null;
  const fields = current?.status === "ready" ? current.data.fields : [];
  const fieldIds = fields.map((f) => f.id);

  // The list, `CON_*` first: those are the connectors made for this tool, and a
  // customer environment lists a hundred standard ones besides.
  const connectors = useMemo(() => {
    if (listing.status !== "ready") return [];
    const all = [...listing.connectors];
    if (connector && !all.some((c) => c.id === connector)) all.unshift({ id: connector });
    return all.sort(
      (a, b) =>
        Number(!a.id.startsWith("CON_")) - Number(!b.id.startsWith("CON_")) ||
        a.id.localeCompare(b.id),
    );
  }, [listing, connector]);
  const listed = listing.status === "ready" && listing.connectors.length > 0;

  const chosenColumn = offered.find((column) => column.index === columnIndex) ?? null;

  function chooseConnector(next: string) {
    setConnector(next);
    setTyped(next);
  }

  // Free text only when the connector's fields can't be read (not in this
  // environment): then the ids are typed, and checked for shape by the backend.
  const typedFields = current?.status === "error";
  // The choices as they stand against the fields that arrived — derived rather than
  // reconciled in an effect. A field the new connector lacks reads as unchosen, and an
  // unchosen match field is guessed from the column's header: *Debiteur* against
  // *Debiteur* is the ordinary case.
  const guess = chosenColumn
    ? (fieldIds.find((id) => id.toLowerCase() === chosenColumn.header.trim().toLowerCase()) ?? "")
    : "";
  const match = typedFields ? matchField : fieldIds.includes(matchField) ? matchField : guess;
  const value = typedFields ? valueField : fieldIds.includes(valueField) ? valueField : "";
  const ready =
    connector !== "" &&
    match.trim() !== "" &&
    value.trim() !== "" &&
    chosenColumn !== null &&
    (typedFields || (fieldIds.includes(match) && fieldIds.includes(value)));

  function save() {
    if (!ready || !chosenColumn) return;
    onSave({
      lookup: {
        connector,
        matchField: match.trim(),
        valueField: value.trim(),
        // The stored wording belongs to the connector it describes — kept when the
        // admin re-edits the fields, dropped once another connector is chosen.
        ...(initial.lookup?.noun && initial.lookup.connector === connector
          ? { noun: initial.lookup.noun }
          : {}),
      },
      column: chosenColumn,
    });
  }

  function fieldPicker(value: string, onChange: (next: string) => void, label: string) {
    if (typedFields) {
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="veld-id"
          aria-label={label}
          className={`${select} w-40 font-mono`}
        />
      );
    }
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={fields.length === 0}
        aria-label={label}
        className={`${select} w-48 cursor-pointer font-mono`}
      >
        <option value="">Kies veld…</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id}
            {f.label && f.label !== f.id ? ` — ${f.label}` : ""}
          </option>
        ))}
      </select>
    );
  }

  const rows = current?.status === "ready" ? current.data.rows : [];

  return (
    <Modal onDismiss={onClose} className="flex max-h-[88vh] max-w-3xl flex-col">
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-k-bg text-k-text-primary shadow-inset-sm">
              <DatabaseSearch className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-k-text-primary">Waarde opzoeken in AFAS</h2>
              <p className="mt-1 text-sm text-k-text-secondary">
                Vul <code className="font-mono font-semibold text-k-text-primary">{field.fieldId}</code>
                {field.label ? ` (${field.label})` : ""} met een waarde die AFAS zelf heeft,
                gevonden via een kolom uit het bestand.
              </p>
            </div>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-k-divider px-6 py-5">
          <ol className="space-y-3">
            <Step n={1}>
              <span>Zoek in</span>
              {listed ? (
                <select
                  autoFocus
                  value={connector}
                  onChange={(e) => chooseConnector(e.target.value)}
                  aria-label="GetConnector"
                  className={`${select} w-72 cursor-pointer font-mono`}
                >
                  <option value="">Kies GetConnector…</option>
                  {connectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}
                    </option>
                  ))}
                </select>
              ) : (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    chooseConnector(typed.trim());
                  }}
                >
                  <input
                    autoFocus
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={listing.status === "loading" ? "Lijst ophalen…" : "CON_ERP_Debiteuren"}
                    aria-label="GetConnector"
                    className={`${select} w-64 font-mono`}
                  />
                  <button
                    type="submit"
                    disabled={typed.trim() === ""}
                    className="neu-button inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium"
                  >
                    Ophalen
                  </button>
                </form>
              )}
            </Step>
            <Step n={2}>
              <span>de rij waar</span>
              {fieldPicker(match, setMatchField, "Veld in de connector dat moet overeenkomen")}
              <span>gelijk is aan kolom</span>
              <select
                value={columnIndex ?? ""}
                onChange={(e) => setColumnIndex(e.target.value === "" ? null : Number(e.target.value))}
                disabled={offered.length === 0}
                aria-label="Kolom uit het bestand"
                className={`${select} w-48 cursor-pointer`}
              >
                <option value="">Kies kolom…</option>
                {offered.map((column) => (
                  <option key={column.index} value={column.index}>
                    {column.header}
                  </option>
                ))}
              </select>
            </Step>
            <Step n={3}>
              <span>en neem</span>
              {fieldPicker(value, setValueField, "Veld in de connector waarvan de waarde wordt verstuurd")}
              <span>
                als <code className="font-mono font-semibold text-k-text-primary">{field.fieldId}</code>
              </span>
            </Step>
          </ol>

          {offered.length === 0 && (
            <p className="mt-3 text-xs text-k-amber-fg">
              Open eerst het Excel-sjabloon links: de opzoeking gebruikt een kolom uit het bestand.
            </p>
          )}
          {listing.status === "error" && (
            <p className="mt-3 text-xs text-k-text-secondary">
              De lijst met GetConnectors kon niet worden gelezen ({listing.message}). Typ de naam
              van de connector.
            </p>
          )}

          {/* The sentence as it will behave, once it is complete — and what happens
              when a cell has no answer, which is the part that is easy to assume. */}
          {ready && chosenColumn && (
            <div className="mt-4 rounded-xl bg-k-bg px-3 py-2.5 text-sm text-k-text-primary shadow-inset-sm">
              <p>
                <code className="font-mono font-semibold">{field.fieldId}</code> ={" "}
                <code className="font-mono font-semibold">{value}</code> uit{" "}
                <code className="font-mono">{connector}</code>, in de rij waar{" "}
                <code className="font-mono font-semibold">{match}</code> = kolom{" "}
                <span className="font-semibold">“{chosenColumn.header}”</span>.
              </p>
              <p className="mt-1 text-xs text-k-text-secondary">
                Bij het versturen wordt dit opgezocht in de omgeving waarnaar je verstuurt (test
                of live). Vindt AFAS geen of meerdere rijen, dan wordt dat record niet verstuurd.
              </p>
            </div>
          )}

          <div className="mt-5">
            <p className="text-xs font-medium text-k-text-secondary">
              Voorbeeld uit {connector || "de connector"} — de eerste rijen, uit de
              sjabloonomgeving
            </p>
            {!connector ? (
              <p className="mt-2 text-sm text-k-text-secondary">Kies eerst een connector.</p>
            ) : !current ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-k-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Ophalen…
              </p>
            ) : current.status === "error" ? (
              <p className="mt-2 text-sm text-k-text-secondary">
                {current.message} Staat de connector niet in deze omgeving, typ de veld-id’s dan
                zelf.
              </p>
            ) : rows.length === 0 ? (
              <p className="mt-2 text-sm text-k-text-secondary">
                {current.data.rowsMessage || "Deze connector heeft hier geen rijen."}
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl bg-k-bg shadow-raised-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-k-tint text-k-text-secondary">
                    <tr>
                      {fields.map((f) => (
                        <th
                          key={f.id}
                          className={`whitespace-nowrap px-3 py-2 font-mono font-semibold ${
                            f.id === value
                              ? "bg-k-cloud-light/40 text-k-cloud-deep"
                              : f.id === match
                                ? "bg-k-text-primary/5 text-k-text-primary"
                                : ""
                          }`}
                        >
                          {f.id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-k-divider">
                        {fields.map((f) => (
                          <td
                            key={f.id}
                            className={`whitespace-nowrap px-3 py-1.5 tabular-nums text-k-text-primary ${
                              f.id === value
                                ? "bg-k-cloud-light/40 font-semibold"
                                : f.id === match
                                  ? "bg-k-text-primary/5 font-semibold"
                                  : ""
                            }`}
                          >
                            {row[f.id] === null || row[f.id] === undefined ? "" : String(row[f.id])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-k-divider px-6 py-4">
          {onRemove ? (
            <ModalButton tone="danger" onClick={onRemove}>
              Opzoeking verwijderen
            </ModalButton>
          ) : (
            <span />
          )}
          <ModalButton tone="primary" onClick={save} disabled={!ready}>
            Opslaan
          </ModalButton>
        </div>
      </div>
    </Modal>
  );
}
