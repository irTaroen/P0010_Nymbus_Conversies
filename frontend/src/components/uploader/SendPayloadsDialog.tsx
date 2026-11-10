"use client";

import { AlertTriangle, Loader2, Send } from "lucide-react";
import Modal, { ModalButton, ModalWarningHeader } from "@/components/Modal";
import type { SendStage } from "@/lib/payload-send";
import EnvironmentTarget from "@/components/uploader/EnvironmentTarget";

/**
 * The prompt in front of a send — the one place between reading a payload and
 * AFAS holding it.
 *
 * It exists because the two environments are one click apart and only one of them
 * is reversible in practice: a record posted to a customer's **live** AFAS is a
 * record in their live data, and nothing here can take it back. So the dialog
 * states the things that decide whether this is the send that was meant — how many
 * records, which module, and **which AFAS** — and says the last loudest, since that
 * is the one the switch above could quietly have left wrong.
 *
 * "Which AFAS" is the **omgevingsnummer and the stage**, in a block of their own
 * rather than folded into the sentence: *de testomgeving van dit project* names a
 * category, not an administration, and the number is what tells 38892 from 38690.
 * Both come from `/api/projects/{id}/environment`, read for the open stage before
 * anything is sent — which matters because the two sources this used to draw on are
 * missing exactly when the dialog first opens: the previous send's result doesn't
 * exist yet on a first send, and the existence read only runs for the six modules
 * that have a `CON_*` lookup.
 *
 * Live is styled as the warning it is; test is the same dialog without the alarm,
 * kept rather than skipped because "how many records am I about to insert" is worth
 * a look in either environment, and a flow that sometimes asks and sometimes doesn't
 * teaches people to click through the times it does.
 */
export default function SendPayloadsDialog({
  count,
  updating,
  repair = null,
  stage,
  moduleLabel,
  omgeving,
  host,
  projectName,
  sending,
  onConfirm,
  onClose,
}: {
  count: number;
  /** How many of those are **updates** of records AFAS already holds (PUT). */
  updating: number;
  /**
   * A *Herstellen* send's choice in words — *AfasSalary toevoegen* — or null for
   * an ordinary send. Replaces the "overwrites blank fields" warning, which a
   * repair doesn't earn: it sends only the chosen objects and no empty fields.
   */
  repair?: string | null;
  stage: SendStage;
  moduleLabel: string;
  /**
   * The AFAS environment number this send would reach — `38892`. Empty only when
   * the project has none stored, which is also a send that cannot succeed.
   */
  omgeving: string;
  /** The full host it resolves to, `38892.resttest.afas.online`. May be empty. */
  host: string;
  /** The project's own name, for the line under the number. */
  projectName: string;
  sending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const live = stage === "live";
  const records = `${count} ${count === 1 ? "record" : "records"}`;
  const creating = count - updating;

  return (
    <Modal onDismiss={sending ? () => {} : onClose} className="max-w-md">
      <div className="px-6 py-5">
        {/* Where it lands — the number and the stage, see `EnvironmentTarget`.
            First, above the question: which AFAS is the thing being checked. */}
        <EnvironmentTarget
          stage={stage}
          omgeving={omgeving}
          host={host}
          projectName={projectName}
          className="mb-4"
        />

        <ModalWarningHeader title={`${records} versturen?`}>
          {/* Each fact said once: the count in the title, the environment in the
              block above (number and stage, which the sentence could only name
              as a category), so the sentence carries only what neither does —
              the module, and what the run does to AFAS. Two verbs because a run
              that both creates and updates is the normal case once existing
              records are marked. */}
          <strong className="font-semibold">{moduleLabel}</strong>
          {repair ? (
            <>
              , als <strong className="font-semibold">herstel</strong> van
              bestaande records: {repair}.
            </>
          ) : updating === 0 ? (
            <>, allemaal als nieuw record.</>
          ) : creating === 0 ? (
            <>
              , allemaal als{" "}
              <strong className="font-semibold">bijwerking</strong> van een
              bestaand record.
            </>
          ) : (
            <>
              : <strong className="font-semibold">{creating}</strong> nieuw,{" "}
              <strong className="font-semibold">{updating}</strong> bijgewerkt.
            </>
          )}
        </ModalWarningHeader>


        {/* The thing about PUT that an admin cannot see from the payload on screen.
            AFAS updates every field it is given and **empties one that arrives
            blank** (AFAS-Profit-API-Referentie §4), so a column this sheet leaves
            empty clears whatever AFAS holds there today. Harmless on an insert,
            which is why it is only said when the run actually contains updates. */}
        {repair && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-k-amber-bg px-3 py-2.5 text-sm text-k-amber-fg">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={1.8}
            />
            <span>
              Alleen de gekozen onderdelen gaan mee, en lege velden worden niet
              meegestuurd. Wat <em>Bijwerken</em> wel meestuurt, overschrijft de
              waarde in AFAS.
            </span>
          </p>
        )}
        {updating > 0 && !repair && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-k-amber-bg px-3 py-2.5 text-sm text-k-amber-fg">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={1.8}
            />
            <span>
              Bij bijwerken overschrijft AFAS de gekoppelde velden met wat in
              dit bestand staat — een gekoppelde kolom die hier leeg is,{" "}
              <strong className="font-semibold">
                maakt dat veld in AFAS ook leeg
              </strong>
              .
            </span>
          </p>
        )}

        {/* The sentence that only applies to live, in the tone that matches it.
            AFAS has no transaction across calls and no undo for an insert, so this
            is a statement of fact rather than a caution. */}
        {live && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-k-red-bg px-3 py-2.5 text-sm text-k-red-fg">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={1.8}
            />
            <span>
              Echte klantdata — dit is niet ongedaan te maken.
            </span>
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-k-divider px-6 py-4">
        <ModalButton onClick={onClose} disabled={sending}>
          Annuleren
        </ModalButton>
        <ModalButton
          tone={live ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={sending || count === 0}
        >
          {sending ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin"
              strokeWidth={1.8}
            />
          ) : (
            <Send className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          )}
          {sending ? "Versturen…" : "Versturen"}
        </ModalButton>
      </div>
    </Modal>
  );
}
