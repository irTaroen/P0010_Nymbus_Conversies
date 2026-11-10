"""A module's payload send as a **background run**, so the browser can stop waiting.

The loop itself is unchanged from the synchronous send this replaces: one AFAS call
per record, sequentially, in the order the records arrived (AFAS rate-limits, and a
burst of a few hundred inserts is the shape it throttles). What changes is who waits
for it — the request starts the run and returns its id, and the panel polls
`run(run_id)` for the results so far.

### Why a job and not a streamed response

A stream would keep the progress but keep the run tied to the request with it: a
refresh, a closed tab, a laptop lid would orphan the loop halfway, with some records
already written into a customer's AFAS and no result anywhere saying which. The
records are not recoverable — AFAS has no transaction across calls and no undo for an
insert — so **the one thing that must survive is the report**, and that means the run
outliving the connection that asked for it.

This is the same shape as `dossier_migration.py`'s run store, deliberately: that is
this backend's other long job, and two different answers to "a long call with
progress" is one more than this app needs. Same known limitation, too — in-memory and
per-process, which the single-instance deploy makes workable (see the note on
`sessions.py` in docs/architecture.md) but a restart still loses. Here that costs the
*report* of a finished run, never the records themselves.

### One run per module, not per project

`dossier_migration` allows one run per project, because it copies a whole environment
and a second would double-upload. The narrower key here is what the screen actually
is: a payload panel is open on one module, and sending Medewerkers while Debiteuren
is still going is two different sheets going to two different connectors — a thing
worth allowing. Two runs of *the same* module would be the double-send, and that is
what this refuses.

Routes live in `main.py` as usual; nothing in here imports FastAPI.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from uuid import uuid4
import logging

import afas_reads
from afas import AfasEnvironment, delete_record, insert_record, update_record
from clock import now_iso

log = logging.getLogger(__name__)

# Called once a run has ended and before it reports so — see `_execute()`.
OnFinish = Callable[["SendRunState", str], Awaitable[None]]


@dataclass
class SendRecordJob:
    """One record as the loop takes it — already validated and verb-checked by the
    route, so nothing in here decides anything about it.

    `ordinal` and `rows` are the record's identity *on screen*, carried through so a
    result lands on the row it belongs to rather than on whatever came back in that
    position."""

    ordinal: int
    connector: str
    rows: list[int]
    title: str
    action: str  # "insert" | "update" | "delete", already re-checked against AFAS
    body: dict
    kind: str = ""
    # A delete's target, resolved by the route from `existing.DeleteTarget` and the
    # key **as AFAS spells it** — never from the browser. Empty for insert/update.
    delete_object: str = ""
    delete_field: str = ""
    delete_key: str = ""


@dataclass
class SendRunState:
    """A run in progress or finished, as the poll route reads it.

    `results` grows as the loop goes: it is the whole progress report, since "how far
    along" is just `len(results)` against `total`. Kept as the same per-record dicts
    the synchronous send returned, so the panel's existing result handling reads them
    unchanged."""

    run_id: str
    project_id: str
    module_id: str
    stage: str
    environment: str
    total: int
    status: str = "running"  # "running" | "done" | "failed" | "stopped"
    # What the run does: `send` (insert/update) or `delete`. One verb family per run,
    # so the panel can word the progress and the notices for what actually happened
    # rather than reporting deleted records as *verstuurd*.
    operation: str = "send"
    started_at: str = ""
    finished_at: str | None = None
    results: list[dict] = field(default_factory=list)
    error: str | None = None
    # Ticked but not sent — already in AFAS under *Alleen nieuwe*, or left out by
    # the phase. Not part of `total`, which is what the loop attempts.
    skipped_existing: int = 0
    skipped_phase: int = 0
    # Ticked but held back because a looked-up value (the debiteur of a project, the
    # project of a voorcalculatieregel) isn't in this environment — listed rather
    # than counted, since each one is something to go and create in AFAS. Each is
    # `{ordinal, rows, title, kind, reason}`, the reason in the panel's words.
    skipped_missing: list[dict] = field(default_factory=list)
    # Which step of a multi-step module this run sent (`aanmaken`, `livegang` for
    # Medewerkers — the panel's `module-phases.ts`), and its label; empty for every
    # other module. Only carried and reported back: it is what lets the panel find
    # each step's last run again (`latest_by_phase()`) for one combined report.
    phase: str = ""
    phase_label: str = ""
    # The rows this run's step has in AFAS once it ended (`send_progress.outcome()`'s
    # `step_rows`), set by the stamp. For a step that updates what an earlier one
    # created, this — not existence — is how far the step got, and the next run of
    # the step builds on it (`latest_step_rows()`). `None` where nothing was measured.
    step_rows: list[int] | None = None
    # Set by `request_stop()`; the loop reads it *between* records, never mid-call —
    # see `_execute()` on why a record already on its way is let through.
    stop_requested: bool = False

    @property
    def sent(self) -> int:
        return sum(1 for row in self.results if row["ok"])

    @property
    def failed(self) -> int:
        return sum(1 for row in self.results if not row["ok"])

    @property
    def inserted(self) -> int:
        return sum(1 for row in self.results if row["ok"] and row["action"] == "insert")

    @property
    def updated(self) -> int:
        return sum(1 for row in self.results if row["ok"] and row["action"] == "update")

    @property
    def deleted(self) -> int:
        return sum(1 for row in self.results if row["ok"] and row["action"] == "delete")


class SendAlreadyInProgress(Exception):
    """This module already has a send running; the route turns this into a 409 rather
    than starting a second one over the top of it. Two runs of one module against one
    environment is the double-send — every record written twice, and AFAS refusing
    the duplicates at best."""

    def __init__(self, run_id: str):
        super().__init__(
            f"Er loopt al een verzending voor deze module ({run_id}). "
            "Wacht tot die klaar is."
        )
        self.run_id = run_id


_runs: dict[str, SendRunState] = {}
_runs_by_project: dict[str, list[str]] = {}
# Keyed by (project, module) — see the module docstring on why not per project.
_active_run: dict[tuple[str, str], str] = {}
# The send tasks still running, held so none is garbage-collected mid-run.
_tasks: set[asyncio.Task] = set()
# How long a cancelled run may spend stamping what it did write onto the deeltaak.
_FINISH_ON_CANCEL_S = 10

# A finished run is kept so the panel can still collect its report after a reload,
# but not forever: the results hold every body's outcome, and a day of sends would
# otherwise sit in memory until the process restarts. Oldest go first, and only ones
# that have finished — a running job is never evicted.
_MAX_RUNS_PER_PROJECT = 20




def run(run_id: str) -> SendRunState | None:
    return _runs.get(run_id)


def active_run(project_id: str, module_id: str) -> SendRunState | None:
    """The run this module has going, if any — what a reopened panel asks for to
    find the send it left behind."""
    run_id = _active_run.get((project_id, module_id))
    return _runs.get(run_id) if run_id else None


def runs_for_project(project_id: str, limit: int = 10) -> list[SendRunState]:
    """This project's most recent sends, newest first — so a page reload doesn't lose
    sight of one still in progress or just finished."""
    ids = _runs_by_project.get(project_id, [])[-limit:]
    return [_runs[run_id] for run_id in reversed(ids) if run_id in _runs]


def latest_by_phase(project_id: str, module_id: str, stage: str) -> list[SendRunState]:
    """The newest **finished send** of each step of this module in this stage, oldest
    step-run first — what the verzendrapport combines into one report for a module
    sent in more than one call per record. Delete runs and runs still going are left
    out; a module without steps has one entry, under the empty phase."""
    latest: dict[str, SendRunState] = {}
    for run_id in _runs_by_project.get(project_id, []):
        state = _runs.get(run_id)
        if (
            state is None
            or state.module_id != module_id
            or state.stage != stage
            or state.operation != "send"
            or state.status == "running"
        ):
            continue
        latest[state.phase] = state  # later in the list is newer
    return sorted(latest.values(), key=lambda state: state.started_at)


def latest_step_rows(
    project_id: str, module_id: str, stage: str, phase: str
) -> set[int] | None:
    """The rows the newest finished run of this step left in AFAS (`step_rows`), or
    `None` when the backend holds no such run — never sent, evicted, or forgotten in
    a restart, which this in-memory store can't tell apart."""
    for state in latest_by_phase(project_id, module_id, stage):
        if state.phase == phase:
            return set(state.step_rows) if state.step_rows is not None else None
    return None


def request_stop(run_id: str) -> SendRunState | None:
    """Ask a running send to stop after the record it is on. Returns the run (or
    `None` when there is none); asking a run that already ended is a no-op, so a
    press that races the last record simply finds it done."""
    state = _runs.get(run_id)
    if state is not None and state.status == "running":
        state.stop_requested = True
    return state


def _evict(project_id: str) -> None:
    """Drop this project's oldest *finished* runs past the cap."""
    ids = _runs_by_project.get(project_id, [])
    finished = [rid for rid in ids if rid in _runs and _runs[rid].status != "running"]
    while len(ids) > _MAX_RUNS_PER_PROJECT and finished:
        oldest = finished.pop(0)
        ids.remove(oldest)
        _runs.pop(oldest, None)


async def start_run(
    project_id: str,
    module_id: str,
    stage: str,
    env: AfasEnvironment,
    records: list[SendRecordJob],
    *,
    skipped_existing: int = 0,
    skipped_phase: int = 0,
    skipped_missing: list[dict] | None = None,
    operation: str = "send",
    phase: str = "",
    phase_label: str = "",
    on_finish: OnFinish | None = None,
) -> SendRunState:
    """Post every record in the background and return the run right away — the caller
    polls `run(run_id)` for progress. Refuses a second concurrent run of the same
    module.

    Everything that can be decided up front already has been by the time this is
    called: the session may open the project, the connectors belong to the module,
    the environment is complete, and each record's verb has been re-checked against
    AFAS. This only sends."""
    key = (project_id, module_id)
    if key in _active_run:
        raise SendAlreadyInProgress(_active_run[key])

    state = SendRunState(
        run_id=uuid4().hex,
        project_id=project_id,
        module_id=module_id,
        stage=stage,
        environment=env.name,
        total=len(records),
        started_at=now_iso(),
        skipped_existing=skipped_existing,
        skipped_phase=skipped_phase,
        skipped_missing=skipped_missing or [],
        operation=operation,
        phase=phase,
        phase_label=phase_label,
    )
    _runs[state.run_id] = state
    _runs_by_project.setdefault(project_id, []).append(state.run_id)
    _active_run[key] = state.run_id
    _evict(project_id)
    # Held until it finishes: the event loop keeps only a weak reference to a task,
    # and a send nobody holds can be garbage-collected halfway through the records.
    task = asyncio.create_task(_execute(state, env, records, on_finish))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return state


async def _execute(
    state: SendRunState,
    env: AfasEnvironment,
    records: list[SendRecordJob],
    on_finish: OnFinish | None = None,
) -> None:
    """The send loop, one record at a time.

    A record AFAS refuses is a *result*, not an error: it is appended with `ok: False`
    and the loop goes on, because AFAS has no transaction across calls and stopping
    halfway would leave the remaining records unattempted for no gain. Only the run's
    own failure — something outside any single record — ends it early, and then it
    ends in `failed` with the results collected so far intact, since those records
    really were written.

    A stop (`request_stop`) is checked before each record rather than done by
    cancelling the task: a cancel lands mid-`await`, on a call AFAS may already have
    executed, and the result that says so would be lost. Checked between records, the
    one in flight still reports and the run ends as `stopped` with every record that
    was written accounted for.

    `on_finish` runs once the loop has ended and **before** the status leaves
    `running` — what stamps the outcome onto the deeltaak in AFAS. Before, so a
    browser that sees the run end and re-reads the module's figure finds the new
    one; and the module stays locked against a second send while it is written. A
    failing hook costs that stamp, never the report."""
    outcome = "done"
    # Whatever was read from this environment for display is about to stop being
    # true — and is cleared again once the run is over (`afas_reads.py`).
    afas_reads.forget_environment(env)
    try:
        for record in records:
            if state.stop_requested:
                outcome = "stopped"
                break
            # POST inserts, PUT updates (AFAS-Profit-API-Referentie §4); the verb was
            # decided and re-checked by the route. Nothing here invents an upsert.
            # DELETE takes the key from the URL (§4.3), and the route has resolved
            # that URL's parts from the module's own `DeleteTarget`.
            if record.action == "delete":
                result = await delete_record(
                    env,
                    record.connector,
                    record.delete_object,
                    record.delete_field,
                    record.delete_key,
                )
            else:
                write = update_record if record.action == "update" else insert_record
                result = await write(env, record.connector, record.body)
            entry = {
                "ordinal": record.ordinal,
                "rows": record.rows,
                "title": record.title,
                "kind": record.kind,
                "connector": record.connector,
                "action": record.action,
                "ok": result.succeeded,
                "message": result.message,
                # The primary key AFAS just wrote, when it wrote one — the only
                # proof outside AFAS that this particular record landed.
                "keys": result.results,
                "logReference": result.log_reference,
                # When AFAS answered on this record — the verzendrapport's *Tijdstip*,
                # which is what someone matches against Profit's own mutation log.
                "answeredAt": now_iso(),
            }
            # A refused record keeps the body it was refused on. AFAS names the
            # field it objects to by its label ("De ingevulde waarde bij
            # 'Verkooprelatie' bestaat niet") but never the value, and the value is
            # what somebody fixing the sheet needs. The panel's copy of the body can
            # have changed by the time the report is read (an edited cell rebuilds
            # it), so the one that was actually sent travels with the result. Only
            # for refusals: an accepted body is in AFAS already, and keeping every
            # one would put a whole sheet in memory per run.
            if not result.succeeded and record.action != "delete":
                entry["body"] = record.body
            state.results.append(entry)
    except asyncio.CancelledError:
        # A cancelled task must still leave a readable report: the records already in
        # `results` were really written, and a run stuck on "running" forever would
        # also block the next send of this module. Those records are also what the
        # deeltaak's stamp describes, so the hook still runs — bounded, since a cancel
        # usually means the process is going down.
        state.error = "De verzending is afgebroken."
        if on_finish is not None and state.results:
            try:
                await asyncio.wait_for(on_finish(state, "failed"), timeout=_FINISH_ON_CANCEL_S)
            except (Exception, asyncio.CancelledError):
                log.exception("payload_send: on_finish failed for cancelled run %s", state.run_id)
        state.status = "failed"
        afas_reads.forget_environment(env)
        _release(state)
        raise
    except Exception as exc:
        # The job's own failure (a dropped connection, an expired token) must land in
        # the state for the poll route to show, not vanish into an orphaned task.
        outcome = "failed"
        state.error = str(exc)
    try:
        if on_finish is not None:
            try:
                await on_finish(state, outcome)
            except Exception:
                log.exception("payload_send: on_finish failed for run %s", state.run_id)
        state.status = outcome
    finally:
        afas_reads.forget_environment(env)
        _release(state)


def _release(state: SendRunState) -> None:
    """Close the run and free its module for the next send."""
    state.finished_at = now_iso()
    _active_run.pop((state.project_id, state.module_id), None)
