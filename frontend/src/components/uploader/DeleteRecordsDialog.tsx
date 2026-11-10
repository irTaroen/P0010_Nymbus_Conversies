"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import Modal, { ModalButton, ModalWarningHeader } from "@/components/Modal";
import EnvironmentTarget from "@/components/uploader/EnvironmentTarget";
import type { SendStage } from "@/lib/payload-send";

/** One record the dialog lists — what the admin checks before the press. */
export interface DeleteCandidate {
  ordinal: number;
  /** The key as the sheet spells it — `OFF000030`. */
  key: string;
  /** The record's name in AFAS, off the existence read — proof the match is right. */
  name: string;
  rows: number[];
}

/**
 * `rij 39–40` for a run of rows, `rij 39–40, 118` when one key's records sit apart
 * in the sheet — a range over the gap would claim rows that belong to other
 * offertes.
 */
function rowsLabel(rows: number[]): string {
  const runs: string[] = [];
  let start = rows[0];
  let prev = rows[0];
  for (const row of rows.slice(1)) {
    if (row === prev + 1) {
      prev = row;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = row;
  }
  if (start !== undefined) runs.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `rij ${runs.join(", ")}`;
}

/**
 * The prompt in front of a delete — the only guard between the button and a
 * record gone from the customer's AFAS.
 *
 * It is the send's dialog ([`SendPayloadsDialog`](./SendPayloadsDialog.tsx)) turned
 * the other way: same environment block, same red on live, but it **lists** the
 * records rather than only counting them. A send adds records that can be looked at
 * afterwards; a delete leaves nothing to look at, so this list — each key with the
 * name AFAS holds under it — is the last chance to see which ones.
 *
 * **Live asks for the count to be typed.** A delete there is permanent and removes
 * the customer's own data, and a confirm button pressed out of habit is exactly
 * the failure a second, deliberate act prevents. Test keeps the plain confirm:
 * asking for the same ceremony in both teaches people to go through it blind.
 */
export default function DeleteRecordsDialog({
  records,
  noun,
  plural,
  stage,
  moduleLabel,
  omgeving,
  host,
  projectName,
  deleting,
  error,
  onConfirm,
  onClose,
}: {
  records: DeleteCandidate[];
  /** What one record is called — `offerte`. */
  noun: string;
  /** And several — `offertes`. */
  plural: string;
  stage: SendStage;
  moduleLabel: string;
  omgeving: string;
  host: string;
  projectName: string;
  deleting: boolean;
  /** Why the backend refused the run, when it did — nothing was deleted then. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const live = stage === "live";
  const count = records.length;
  const counted = `${count} ${count === 1 ? noun : plural}`;
  const [typed, setTyped] = useState("");
  const confirmed = !live || typed.trim() === String(count);

  return (
    <Modal onDismiss={deleting ? () => {} : onClose} className="max-w-md">
      <div className="px-6 py-5">
        <ModalWarningHeader
          title={
            live
              ? `${counted} uit de live-omgeving verwijderen?`
              : `${counted} uit de testomgeving verwijderen?`
          }
        >
          {counted} van <strong className="font-semibold">{moduleLabel}</strong>{" "}
          {count === 1 ? "wordt" : "worden"} uit de{" "}
          <strong className="font-semibold">
            {live ? "live" : "test"}-omgeving
          </strong>{" "}
          van dit project verwijderd, elk met alle regels die eronder staan.
        </ModalWarningHeader>

        <EnvironmentTarget
          stage={stage}
          omgeving={omgeving}
          host={host}
          projectName={projectName}
        />

        {/* Which records, by key and by the name AFAS holds under it — the key is
            what the sheet says, the name is what proves AFAS means the same one. */}
        <ul className="mt-4 max-h-48 divide-y divide-k-divider overflow-y-auto rounded-xl bg-k-bg shadow-inset-sm">
          {records.map((record) => (
            <li
              key={record.ordinal}
              className="flex items-center gap-3 px-3 py-1.5 text-sm"
            >
              <span className="font-mono font-semibold text-k-text-primary">
                {record.key}
              </span>
              {record.name && (
                <span className="min-w-0 flex-1 truncate text-k-text-secondary">
                  {record.name}
                </span>
              )}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-k-text-secondary">
                {rowsLabel(record.rows)}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-k-red-bg px-3 py-2.5 text-sm text-k-red-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>
            Verwijderen is <strong className="font-semibold">definitief</strong>.
            {live
              ? " Dit is de echte administratie van de klant, en wat hier verdwijnt kan hiervandaan niet worden teruggezet."
              : " Wat hier verdwijnt kan hiervandaan niet worden teruggezet."}
          </span>
        </p>

        {/* A refusal stays here, over the button that raised it — nothing was
            deleted, and the admin needs to read why before trying again. */}
        {error && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl bg-k-red-bg px-3 py-2 text-sm text-k-red-fg"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{error}</span>
          </p>
        )}

        {live && (
          <label className="mt-4 block">
            <span className="block text-sm font-medium text-k-text-primary">
              Typ <span className="font-mono font-bold">{count}</span> om te
              bevestigen
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={deleting}
              className="neu-input mt-2 w-full rounded-full px-4 py-2.5 text-sm"
            />
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-k-divider px-6 py-4">
        <ModalButton onClick={onClose} disabled={deleting}>
          Annuleren
        </ModalButton>
        <ModalButton
          tone="danger"
          onClick={onConfirm}
          disabled={deleting || count === 0 || !confirmed}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.8} />
          ) : (
            <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          )}
          {deleting ? "Verwijderen…" : `${counted} verwijderen`}
        </ModalButton>
      </div>
    </Modal>
  );
}
