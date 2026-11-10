/**
 * *Herstellen* — sending a record AFAS already holds **again**, with an action per
 * object instead of one for the whole body.
 *
 * A record that went in can still be wrong or incomplete: a medewerker whose salary
 * is missing, a debiteur whose address never arrived. Deleting and re-inserting is
 * mostly not on offer (AFAS refuses to delete an employee with history, and most
 * modules have no delete at all), and the *Alles* mode re-sends the whole body as an
 * update — every object, whether or not it needed touching.
 *
 * AFAS can already say what is meant here: a PUT on the record's key, with an
 * `@Action` per nested object — `insert` adds a record beside what is there, `update`
 * changes the one there — validated and committed as one transaction
 * (docs/AFAS-Profit-API-Referentie.md §4.1). This file is that choice, made by the
 * admin per object:
 *
 * | Choice      | In the body                      |
 * | ----------- | -------------------------------- |
 * | `skip`      | the object is left out entirely  |
 * | `update`    | `"@Action": "update"`            |
 * | `insert`    | `"@Action": "insert"`            |
 *
 * The root is always `update`: it carries the key the PUT addresses, and the mode is
 * only offered for records marked *Bestaat al*.
 *
 * ### A narrowing, not a second body
 *
 * A repair is applied **on top of** the body `buildModulePayloads` already builds —
 * the mapping, the fills and the active phase's dates and overrides all run
 * unchanged underneath — so a repaired salary carries exactly the values and begin
 * date the phase would have written. The repair only decides which objects go and
 * what AFAS is told to do with each. See docs/existing-records.md §6a.
 */

import type {
  AfasSchemaObject,
  AfasUpdateSchema,
  FieldValueResolver,
  PayloadAction,
} from "@/lib/afas-schema";
import { objectPath, objectsOf } from "@/lib/afas-schema";

/** What a repair does with one nested object. */
export type ObjectAction = "skip" | "update" | "insert";

/** A repair: the action per nested object path. An absent path is `skip`. */
export interface RepairPlan {
  actions: Readonly<Record<string, ObjectAction>>;
}

/** The default — nothing but the root, so the admin chooses what changes. */
export const EMPTY_REPAIR: RepairPlan = { actions: {} };

/** One row of the chooser: an object the bodies can carry, and where it sits. */
export interface RepairObject {
  /** `AfasEmployee.AfasSalary` — what the plan is keyed by. */
  path: string;
  /** The AFAS object name, `AfasSalary`. */
  name: string;
  /** 0 for a child of the root, 1 for its children, … */
  depth: number;
}

/**
 * The nested objects of a (narrowed) schema, depth first — the chooser's rows.
 *
 * Called on the schema **after** the phase and the *Alleen gevuld* scope have pruned
 * it, so it offers exactly the objects a body can carry and never one the mapping
 * fills nothing in.
 */
export function repairObjectsOf(schema: AfasUpdateSchema): RepairObject[] {
  const rows: RepairObject[] = [];
  const walk = (object: AfasSchemaObject, path: string, depth: number) => {
    for (const child of objectsOf(object)) {
      const childPath = objectPath(path, child.name);
      rows.push({ path: childPath, name: child.name, depth });
      walk(child, childPath, depth + 1);
    }
  };
  walk(schema, schema.name, 0);
  return rows;
}

/**
 * The rows of several schemas as one list — a split module's two variants share
 * most of their objects, and the chooser should offer each once.
 */
export function mergeRepairObjects(lists: RepairObject[][]): RepairObject[] {
  const seen = new Set<string>();
  return lists.flat().filter((row) => {
    if (seen.has(row.path)) return false;
    seen.add(row.path);
    return true;
  });
}

/** The action a plan gives an object path; absent is `skip`. */
export function actionOf(plan: RepairPlan, path: string): ObjectAction {
  return plan.actions[path] ?? "skip";
}

/**
 * Whether a nested object is in the body: it and **every ancestor** below the root
 * must be chosen. A child of a skipped object can't be sent on its own — AFAS nests
 * it inside its parent's `Element`, so without the parent there is nowhere for it to
 * go. The chooser greys such a child out (`repairBlockedBy`).
 *
 * Called by `filterSchema`'s `keepObject`, which never asks about the root.
 */
export function repairKeepsObject(plan: RepairPlan, path: string): boolean {
  return repairBlockedBy(plan, path) === null && actionOf(plan, path) !== "skip";
}

/** The skipped ancestor that keeps this object out, or null when none does. */
export function repairBlockedBy(plan: RepairPlan, path: string): string | null {
  const parts = path.split(".");
  // `parts[0]` is the root, which is never skipped; walk from its first child down
  // to this object's parent.
  for (let end = 2; end < parts.length; end += 1) {
    const ancestor = parts.slice(0, end).join(".");
    if (actionOf(plan, ancestor) === "skip") return ancestor;
  }
  return null;
}

/**
 * The `@Action` per object for {@link payloadLines}: `update` on the root (the PUT's
 * key), the chosen action on every object the body still carries.
 */
export function repairActions(plan: RepairPlan, rootName: string): PayloadAction {
  return (path) => {
    if (path === rootName) return "update";
    const action = actionOf(plan, path);
    return action === "skip" ? undefined : action;
  };
}

/**
 * A resolver that leaves out every field resolving to nothing.
 *
 * On a PUT a field sent empty is **cleared** in AFAS (AFAS-Profit-API-Referentie §4),
 * while a field left out is left alone. The column mapping already omits an empty
 * cell (`fieldValues` in [`field-mapping.ts`](./field-mapping.ts)); this catches what
 * reaches a body by another road — a fill without a value, an override or a
 * `valueMap` that produced `""` — because a repair is exactly the send where an
 * accidental clear would erase data that was right.
 */
export function withoutEmpty(resolve: FieldValueResolver): FieldValueResolver {
  return (path, field) => {
    const resolved = resolve(path, field);
    if (!resolved || resolved.omit) return resolved;
    if (resolved.value === null || resolved.value === "") {
      return { omit: true, note: "leeg — niet meegestuurd" };
    }
    return resolved;
  };
}

/** What the chooser and the send label call each action. */
export const ACTION_LABELS: Record<ObjectAction, string> = {
  skip: "Overslaan",
  update: "Bijwerken",
  insert: "Toevoegen",
};

/**
 * The plan in a few words — *AfasSalary toevoegen, KnPerson bijwerken* — for the
 * send button's tooltip and the confirm dialog. Only the objects that will be in the
 * body, in chooser order.
 */
export function describeRepair(plan: RepairPlan, objects: RepairObject[]): string {
  const parts = objects
    .filter((row) => repairKeepsObject(plan, row.path))
    .map((row) => `${row.name} ${ACTION_LABELS[actionOf(plan, row.path)].toLowerCase()}`);
  return parts.length ? parts.join(", ") : "alleen hoofdrecord bijwerken";
}
