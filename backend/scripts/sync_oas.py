"""Pull AFAS's public OpenAPI specs and write every UpdateConnector schema to
`json_files/schemas/` — the **general** schemas the mapping editor and the payload
view build on.

Source: https://github.com/AFASSoftware/OASContent (`OpenApiSpecs/profit/nl/*.json`),
the content behind https://docs.afas.help/profit. Those specs describe a *pure*
Profit environment: no vrije velden, no environment-specific mandatory settings. A
client whose inrichting deviates gets a client-specific mapping instead, whose schema
is read from that client's own environment (`metainfo/update/<connector>`).

The OAS is converted into the shape AFAS's own `metainfo/update/<connector>` answers
with, because that is what the frontend (`lib/afas-schema.ts`) and the client schemas
already speak:

    { id, description, name, fields: [...], objects: [{ name, fields, objects }] }

    field: { fieldId, label, dataType, mandatory, primaryKey, length, decimals,
             notzero, controlType, values: [{ id, description }] | null }

What the OAS cannot say and is therefore left at a neutral value: `notzero` (false),
`controlType` (0), and `primaryKey` below the root object (the root's keys are read
off the connector's DELETE path, `/connectors/X/Root/@A,@B/{A},{B}`).

Run from `backend/`:   python scripts/sync_oas.py           (writes the files)
                       python scripts/sync_oas.py --check   (reports, writes nothing)

Commit the result: the app reads these files and never the internet.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO = "AFASSoftware/OASContent"
BRANCH = "main"
SPEC_DIR = "OpenApiSpecs/profit/nl"
RAW = f"https://raw.githubusercontent.com/{REPO}"
API = f"https://api.github.com/repos/{REPO}"

OUT = Path(__file__).resolve().parent.parent / "json_files" / "schemas"

_ENUM_LINE = re.compile(r"^\s*([^=]+?)\s*=\s*(.*?);?\s*$")
_DELETE_KEYS = re.compile(r"^/connectors/[^/]+/[^/]+/(@[^/]+)/")


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "nymbus-conversies-oas-sync"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def _get_json(url: str):
    return json.loads(_get(url).decode("utf-8"))


def _data_type(prop: dict) -> str:
    kind = prop.get("type")
    fmt = prop.get("format") or ""
    if kind == "boolean":
        return "boolean"
    if kind == "integer":
        return "int"
    if kind == "number":
        return "decimal"
    if fmt in ("date", "date-time"):
        return "date"
    if fmt in ("byte", "binary"):
        return "blob"
    return "string"


def _decimals(prop: dict) -> int:
    step = prop.get("multipleOf")
    if not isinstance(step, (int, float)) or step <= 0 or step >= 1:
        return 0
    text = f"{step:.10f}".rstrip("0")
    return len(text.split(".")[1]) if "." in text else 0


def _values(prop: dict) -> list[dict] | None:
    """`enum` with each code's description, read off the `code = text;` lines AFAS
    puts under the label in `description`."""
    enum = prop.get("enum")
    if not enum:
        return None
    described: dict[str, str] = {}
    for line in str(prop.get("description") or "").splitlines()[1:]:
        match = _ENUM_LINE.match(line)
        if match:
            described[match.group(1).strip()] = match.group(2).strip()
    return [{"id": str(code), "description": described.get(str(code), str(code))} for code in enum]


def _field(field_id: str, prop: dict, required: set[str], keys: set[str]) -> dict:
    description = str(prop.get("description") or "")
    return {
        "fieldId": field_id,
        "label": description.splitlines()[0].strip() if description else field_id,
        "dataType": _data_type(prop),
        "mandatory": field_id in required,
        "primaryKey": field_id in keys,
        "length": int(prop.get("maxLength") or 0),
        "decimals": _decimals(prop),
        "notzero": False,
        "controlType": 0,
        "values": _values(prop),
    }


def _element(node: dict) -> dict:
    element = node.get("properties", {}).get("Element", {})
    return element.get("items", element)


def _object(name: str, node: dict, keys: set[str] = frozenset()) -> dict:
    element = _element(node)
    props = element.get("properties", {})
    fields_node = props.get("Fields", {})
    required = set(fields_node.get("required") or [])
    fields = [
        _field(field_id, prop, required, keys)
        for field_id, prop in (fields_node.get("properties") or {}).items()
    ]
    objects_node = props.get("Objects") or {}
    objects_node = objects_node.get("items", objects_node)
    objects = [
        _object(child, child_node)
        for child, child_node in (objects_node.get("properties") or {}).items()
    ]
    return {"name": name, "fields": fields, "objects": objects}


def _root_keys(paths: dict, connector: str) -> set[str]:
    for path, operations in paths.items():
        if not path.startswith(f"/connectors/{connector}/") or "delete" not in operations:
            continue
        match = _DELETE_KEYS.match(path)
        if match:
            return {key.lstrip("@") for key in match.group(1).split(",")}
    return set()


def convert(spec: dict, descriptions: dict[str, str]) -> dict[str, dict]:
    """Every UpdateConnector in one spec file, converted. POST schema first (an
    insert names every field), PUT when a connector only has an update."""
    schemas = spec.get("components", {}).get("schemas", {})
    paths = spec.get("paths", {})
    found: dict[str, dict] = {}
    for key in sorted(schemas, key=lambda k: (not k.endswith("_POST"), k)):
        connector, _, verb = key.rpartition("_")
        if verb not in ("POST", "PUT") or not connector or connector in found:
            continue
        props = schemas[key].get("properties") or {}
        if len(props) != 1:
            continue
        root, node = next(iter(props.items()))
        converted = _object(root, node, _root_keys(paths, connector))
        found[connector] = {
            "id": connector,
            "description": descriptions.get(connector, ""),
            **converted,
        }
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="report only, write nothing")
    args = parser.parse_args()

    commit = _get_json(f"{API}/commits/{BRANCH}")["sha"]
    listing = _get_json(f"{API}/contents/{SPEC_DIR}?ref={commit}")
    endpoints = _get_json(f"{RAW}/{commit}/OpenApiSpecs/endpointpaths.json")
    descriptions = {
        name: next((op.get("descriptionNl", "") for op in ops.values() if op.get("descriptionNl")), "")
        for name, ops in endpoints.items()
        if isinstance(ops, dict)
    }

    connectors: dict[str, dict] = {}
    files: dict[str, str] = {}
    for entry in listing:
        if entry.get("type") != "file" or not entry["name"].endswith(".json"):
            continue
        url = f"{RAW}/{commit}/{SPEC_DIR}/{urllib.parse.quote(entry['name'])}"
        print(f"  {entry['name']}", file=sys.stderr)
        spec = json.loads(_get(url).decode("utf-8"))
        for connector, schema in convert(spec, descriptions).items():
            if connector not in connectors:
                connectors[connector] = schema
                files[connector] = entry["name"][: -len(".json")]

    print(f"{len(connectors)} UpdateConnectors uit {REPO}@{commit[:7]}", file=sys.stderr)
    if args.check:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.json"):
        if stale.stem != "_index" and stale.stem not in connectors:
            stale.unlink()
    for connector, schema in connectors.items():
        (OUT / f"{connector}.json").write_text(
            json.dumps(schema, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
    index = {
        "source": f"https://github.com/{REPO}",
        "commit": commit,
        "connectors": [
            {"id": c, "description": connectors[c]["description"], "category": files[c]}
            for c in sorted(connectors)
        ],
    }
    (OUT / "_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"Geschreven naar {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
