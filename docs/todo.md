# TODO

Known follow-ups for the local version, highest priority first. The original tool's
long todo (with its decisions and their dates) stays in the hosted version's `docs/todo.md`.

## 1 — Before the first real conversion

- [ ] **Vrije velden in three standard mappings are silently dropped.** The standard
      mappings were made against Multiclean's environment, so `erp-projecten` (4 fields:
      School object, Vakantie regio, Segment, Type project/object), `erp-voorcalculatie`
      (13 fields on `KnQuotationLine`) and `erp-abonnementen` (1 field on
      `FbSubscriptionLines`) map `U…` vrije velden that the pure OAS schema doesn't have.
      Both the body builder (`payloadLines()` in `lib/afas-schema.ts`, which walks the
      schema's fields) and the mapping export (`collectMapped()` in `lib/field-mapping.ts`)
      resolve every mapped field **through the schema** and skip one it can't find — so those fields are left out of every body, without a warning,
      and re-saving one of these mappings in the editor deletes them from the file. Decide
      per field: drop it from the standard mapping, or move it into a client mapping (whose
      schema is the client's own and does carry it). Worth a warning in the editor and the
      payload view for "mapped, but not in the schema" either way.
- [ ] **Client mappings without a project.** `mappings/clients/` holds copies for 501281,
      501342, 501360 and 501399, and `custom_modules.json` a maatwerk module for 501342 —
      projects of the original tool. Re-create a project under the same id to use them, or
      delete the folders.

## 2 — Leftovers of the workflow

- [ ] The managementrapport still has a *Bij Nymbus* column and tone (always 0 — there are
      no tasks); remove it, and the `turnSegments` it is computed from.
- [ ] Types and comments that still describe the AFAS workflow: `WorkflowAction` and the
      deeltaak fields on `ModuleStatus` in `lib/modules.tsx`, the hand-in in
      `lib/project-progress.ts`, the deeltaak shape `_project_deeltaken()` in `main.py`
      keeps for compatibility, `Source.NYMBUS` in `codetabellen.py`.
- [ ] `design-system.md` Part II and `afas-integration.md` still describe screens and
      flows that are gone (see their banners).

## 3 — Nice to have

- [ ] **Install the GetConnectors from the app.** AFAS can import a `.gcn` over SOAP
      (`cmdconnector.asmx`, `DEFINITIEIMPORT`) when the client's app connector has *AFAS
      Remote Cmd* — see [AFAS-Profit-ERP-Kennisbank.md](AFAS-Profit-ERP-Kennisbank.md).
      The *Connectoren* tab only checks today.
- [ ] **OAS `required` vs. a real environment.** The OAS marks fields like `BcId` and
      `AutoNum` required that AFAS fills itself; compare with a client's
      `metainfo/update` once one is connected, and decide whether the mandatory badges
      need a correction list.
- [ ] Tests: there are none; the payload builders (`lib/module-payloads.ts`,
      `lib/field-mapping.ts`) are the first candidates.
