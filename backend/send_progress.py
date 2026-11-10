"""What the last **send to AFAS** did to a module, beside the figure it stamped.

A send stamps the module's figures in `project_modules.json` (`local_store.py`),
the same fields a validation writes — so the sidebar keeps one source. What those
figures cannot say is *which kind* of stamp they hold, nor what lies behind a send's
figure: the environment it went to, how many rows AFAS refused and why. That is this
store: one entry per module, the **last** send only, overwritten by the next, in
`json_files/state/send_progress.json` (gitignored — AFAS's refusal messages quote the
value they objected to, a BSN or an IBAN as often as a code).

A validation stamp clears the entry again (`clear()`), and the read side
(`main._module_progress_view`) also refuses an entry whose percentage no longer
matches the stamped figure.

Best-effort throughout: a store that can't be written costs the icon and the
detail, never the send, which already happened.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime

import local_store

log = logging.getLogger(__name__)


# How many refusal messages a row keeps. A report shows the largest few; a send
# refused for two hundred different reasons is still read from the top.
MAX_REFUSALS = 10



@dataclass
class Refusal:
    """One AFAS message and how many sheet rows it refused."""

    message: str
    rows: int


@dataclass
class SendProgress:
    project_id: str
    module_id: str
    stage: str
    environment: str
    run_status: str
    # UTC, naive — the moment that was written into `Laatste_controle`.
    sent_at: datetime
    sent_by: str
    completeness: int
    total_rows: int
    in_afas_rows: int
    refused_rows: int
    held_back_rows: int
    refusals: list[Refusal] = field(default_factory=list)


def percentage_of(part: int, total: int) -> int:
    """`percentageOf()` in the frontend's `validation/metrics.ts`, to the letter — a
    rounded figure that never claims 100 for a sheet missing a row, nor 0 for one
    with a row in it."""
    if total <= 0:
        return 100
    value = round(part / total * 100)
    if value == 100 and part < total:
        return 99
    if value == 0 and part > 0:
        return 1
    return value


@dataclass
class Outcome:
    completeness: int
    total_rows: int
    in_afas_rows: int
    refused_rows: int
    held_back_rows: int
    refusals: list[Refusal]
    # This step's own rows in AFAS, before the other steps are held against it —
    # what the run keeps (`SendRunState.step_rows`) for the next send of the step to
    # build on. The whole sheet's reading for a module without steps.
    step_rows: set[int] = field(default_factory=set)

    @property
    def failed_rows(self) -> int:
        """What `Fouten` holds after a send: the rows that did not get through."""
        return self.refused_rows + self.held_back_rows


def outcome(
    *,
    results: list[dict],
    sheet_rows: list[int],
    existing_rows: list[int],
    held_back: list[dict],
    previous_rows: set[int] | None = None,
    other_steps: list[set[int]] | None = None,
) -> Outcome:
    """How much of the sheet is in AFAS once a run has ended.

    Counted in **sheet rows**, like the validation figure, over every row the panel's
    plan covers (`sheet_rows`) — not just the ones this run sent, so a send of the
    first fifty records reads as fifty rows of the sheet, not as 100%. A row is in
    AFAS when a record holding it was accepted now, or when AFAS already held it
    before the run (`existing_rows`, the panel's *Bestaat al* marks for this stage).
    A refusal in this run takes a row out again, whatever was there before: an update
    AFAS refused left the record behind on its old values.

    Held-back records (a debiteur missing for a project) didn't go either, and count
    with the refusals in `Fouten`, but are kept apart in the detail: one is AFAS's
    verdict, the other something to create first.

    For a module sent in **steps** (Medewerkers: *Historie*, then *Actueel*) two
    more. `previous_rows` is where a step that **updates** what an earlier one
    created starts from — the rows its own earlier runs got into AFAS — instead of
    `existing_rows`: once *Historie* is in, every employee exists, so existence says
    nothing about whether *Actueel* reached them. `None` keeps `existing_rows`, as
    for the step that creates, and for an updating step the backend holds no run of
    (a restart) — today's reading, never a lower one. `other_steps` are the rows
    each other step has in AFAS, and a row only counts when **every** step has it:
    an employee whose *Historie* went in but whose *Actueel* AFAS refused is not
    converted, so 100% and 80% make 80%."""
    sheet = set(sheet_rows)
    accepted: set[int] = set()
    refused: set[int] = set()
    by_message: dict[str, set[int]] = {}
    for result in results:
        rows = set(result.get("rows") or []) & sheet
        if result.get("ok"):
            accepted |= rows
        else:
            refused |= rows
            message = str(result.get("message") or "").strip() or "AFAS gaf geen melding terug."
            by_message.setdefault(message, set()).update(rows)
    start = set(existing_rows) if previous_rows is None else set(previous_rows)
    step_rows = (accepted | (start & sheet)) - refused
    in_afas = step_rows.intersection(*(other_steps or []))
    held = set()
    for record in held_back:
        held |= set(record.get("rows") or [])
    held = (held & sheet) - in_afas - refused
    refusals = sorted(
        (Refusal(message=m, rows=len(r)) for m, r in by_message.items()),
        key=lambda r: -r.rows,
    )
    return Outcome(
        completeness=percentage_of(len(in_afas), len(sheet)),
        total_rows=len(sheet),
        in_afas_rows=len(in_afas),
        refused_rows=len(refused),
        held_back_rows=len(held),
        refusals=refusals,
        step_rows=step_rows,
    )


def _row(progress: SendProgress) -> dict:
    return {
        "stage": progress.stage,
        "environment": progress.environment[:256],
        "run_status": progress.run_status,
        "sent_at": progress.sent_at.isoformat(),
        "sent_by": progress.sent_by[:320],
        "completeness": progress.completeness,
        "total_rows": progress.total_rows,
        "in_afas_rows": progress.in_afas_rows,
        "refused_rows": progress.refused_rows,
        "held_back_rows": progress.held_back_rows,
        "refusals": [{"message": r.message, "rows": r.rows} for r in progress.refusals[:MAX_REFUSALS]],
    }


def save(progress: SendProgress) -> None:
    """Store a module's last send, replacing the one before. Never raises."""
    try:
        local_store.save_send_row(progress.project_id, progress.module_id, _row(progress))
    except Exception as exc:
        log.warning("send_progress: not stored for %s/%s: %s", progress.project_id, progress.module_id, exc)


def clear(project_id: str, module_id: str) -> None:
    """Forget a module's send — its figure now comes from somewhere else. Never raises."""
    try:
        local_store.clear_send_row(project_id, module_id)
    except Exception as exc:
        log.warning("send_progress: not cleared for %s/%s: %s", project_id, module_id, exc)


def for_project(project_id: str) -> dict[str, SendProgress]:
    """Every module's last send for one project, by module id. An unreadable store
    answers with none."""
    try:
        rows = local_store.send_rows(project_id)
    except Exception as exc:
        log.warning("send_progress: not read for %s: %s", project_id, exc)
        return {}
    found: dict[str, SendProgress] = {}
    for module_id, row in rows.items():
        try:
            found[module_id] = SendProgress(
                project_id=project_id,
                module_id=module_id,
                stage=str(row["stage"]),
                environment=str(row.get("environment") or ""),
                run_status=str(row["run_status"]),
                sent_at=datetime.fromisoformat(str(row["sent_at"])),
                sent_by=str(row.get("sent_by") or ""),
                completeness=int(row["completeness"]),
                total_rows=int(row["total_rows"]),
                in_afas_rows=int(row["in_afas_rows"]),
                refused_rows=int(row["refused_rows"]),
                held_back_rows=int(row["held_back_rows"]),
                refusals=[
                    Refusal(message=str(r["message"]), rows=int(r["rows"]))
                    for r in row.get("refusals") or []
                ],
            )
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("send_progress: entry %s/%s skipped: %s", project_id, module_id, exc)
    return found
