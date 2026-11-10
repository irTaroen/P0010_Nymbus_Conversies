# Nymbus Conversies

Converts customer Excel exports into validated data and sends it to the customer's AFAS
Profit environment. Next.js frontend (`frontend/`), FastAPI backend (`backend/`), local JSON
files for everything it stores. No login, no database, no Docker.

- What the app does and how to work on it: [CLAUDE.md](CLAUDE.md)
- How it fits together: [docs/architecture.md](docs/architecture.md)

## Running it

Needs **Node 24** (`.node-version`; with [fnm](https://github.com/Schniz/fnm) it is picked
up automatically) and **Python 3.14**.

```sh
make dev        # installs what's missing, then backend :8010 + frontend :3010
```

Open http://localhost:3010. `Ctrl-C` stops both.

Other targets: `make install`, `make backend`, `make frontend`, `make check` (type check,
lint, help/template gates), `make oas` (re-pull the AFAS OAS schemas).

## First project

1. *Nieuw project* in the sidebar — id, name, AFAS environment number, modules.
2. *Projectinstellingen → AFAS-omgeving* — client id and secret for test and live. They
   are stored in `backend/json_files/client_tokens.json`, which is gitignored.
3. *Projectinstellingen → Connectoren* — check that the client's environment has every
   GetConnector from `connectoren/` imported and added to the app connector.
4. Open a module, drop the client's Excel file, fix what validation flags, and send it from
   the *Payloads* tab.
