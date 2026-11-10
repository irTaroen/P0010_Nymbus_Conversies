"""Which codetabel-connectors each configured project's AFAS actually has.

Run after importing a `.gcn` into a customer environment, to confirm the tool can
see it:

    cd backend && python3 scripts/check_codetabel_connectors.py
    cd backend && python3 scripts/check_codetabel_connectors.py ALG_Cycli

With no arguments it checks every connector the codetabel registry declares —
including the `alternatives`, so a table served by either of two names reports
both. With arguments it checks only those connector names.

A codetabel whose connector is missing is not an error: the check degrades to
"not checked" (`source: "none"`) and the help drawer says *niet gecontroleerd*.
This script exists to tell you *which* projects are in that state, since the
answer is per environment and changes as connectors are rolled out.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import codetabellen  # noqa: E402
import main as app  # noqa: E402
from afas import AfasStage, get_connector, get_metainfo  # noqa: E402


def _wanted(argv: list[str]) -> list[str]:
    """The connector names to check — the registry's own, or the ones asked for."""
    if argv:
        return argv
    names: list[str] = []
    for key in codetabellen.keys():
        for connector, _mapper in codetabellen.table(key).candidates:
            if connector not in names:
                names.append(connector)
    return names


async def main() -> int:
    wanted = _wanted(sys.argv[1:])
    rows = app._settings_rows()
    projects = [
        (r["projectId"], r["projectName"])
        for r in rows
        if r.get("omgeving") and (r.get("live_client_id") or r.get("test_client_id"))
    ]
    if not projects:
        print("Geen projecten met ingevulde AFAS-credentials.")
        return 1

    print(f"{len(wanted)} connector(s) over {len(projects)} project(en)\n")
    missing_anywhere: dict[str, list[str]] = {}

    for pid, name in projects:
        try:
            env = await app.project_environment(pid, AfasStage.LIVE)
        except Exception as exc:  # noqa: BLE001 — report, don't stop the sweep
            print(f"{pid:8} {name:28} overslaan: {exc}")
            continue

        meta = await get_metainfo(env)
        if not meta.succeeded:
            print(f"{pid:8} {name:28} overslaan: {meta.message}")
            continue

        have = {c["id"] for c in meta.payload.get("getConnectors", [])}
        print(f"{pid:8} {name:28} omgeving {env.omgevingnummer}")
        for connector in wanted:
            if connector not in have:
                print(f"             {connector:26} ONTBREEKT")
                missing_anywhere.setdefault(connector, []).append(pid)
                continue
            result = await get_connector(env, connector, take=1, skip=0)
            # `take=1` only proves it answers; the row count comes from the header
            # AFAS returns, so this stays one cheap call per connector.
            state = "OK" if result.succeeded else f"FOUT: {result.message}"
            print(f"             {connector:26} {state}")
        print()

    if missing_anywhere:
        print("Nog te importeren:")
        for connector, pids in missing_anywhere.items():
            print(f"  {connector}: {', '.join(pids)}")
    else:
        print("Alle gevraagde connectoren zijn in elke omgeving aanwezig.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
