"use client";

import { useState } from "react";
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The form pieces the two credential screens share — the project settings dialog
 * and the dossier migration page. One copy, because they carry the rules for a
 * stored secret: it is never shown, an empty field keeps it, and **Wissen** is the
 * only way to remove one. Two copies of that drift, and the drift is a credential
 * sent or wiped by accident.
 */

/** A secret the admin may replace or remove. `value` empty + `clear` false = leave as is. */
export type SecretDraft = { value: string; clear: boolean };

export const UNTOUCHED: SecretDraft = { value: "", clear: false };

/** What to send for a secret: a new one, `""` to remove it, or null to keep it. */
export function secretToSend(draft: SecretDraft): string | null {
  if (draft.value.trim()) return draft.value.trim();
  return draft.clear ? "" : null;
}

/** What a connection test answers with — the same shape on both screens. */
export type ConnectionResult = { ok: boolean; message: string };

/** Where one environment's connection test stands. */
export type ConnectionState = { testing: boolean; result: ConnectionResult | null };

export const UNTESTED: ConnectionState = { testing: false, result: null };

/** The shared input styling; each field adds its own width and top margin. */
export const inputClass =
  "neu-input block rounded-full px-4 py-2 text-sm";

/**
 * Where an environment's connection stands, as a checkbox beside its heading:
 * empty until it is tried, ticked green when AFAS answered, red when it refused.
 * Not a control — nothing here is toggled by hand — so it is rendered as an
 * `img` with a label, and the reason is always spelled out in the strip below.
 */
export function ConnectionMark({ connection }: { connection: ConnectionState }) {
  const t = useT();
  const { testing, result } = connection;
  const label = testing
    ? t("Verbinding wordt getest", "Connection is being tested")
    : !result
      ? t("Verbinding nog niet getest", "Connection not tested yet")
      : result.ok
        ? t("Verbinding gelukt", "Connection succeeded")
        : t("Verbinding mislukt", "Connection failed");
  const box = testing
    ? "bg-k-bg text-k-text-tertiary shadow-inset-sm"
    : !result
      ? "bg-k-bg shadow-inset-sm"
      : result.ok
        ? "bg-k-green-fg text-k-bg shadow-inset-sm"
        : "bg-k-red-fg text-k-bg shadow-inset-sm";

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${box}`}
    >
      {testing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
      ) : result?.ok ? (
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      ) : result ? (
        <X className="h-3.5 w-3.5" strokeWidth={3} />
      ) : null}
    </span>
  );
}

/** A labelled field, with an optional hint under it and a `*` when required. */
export function Field({
  id,
  label,
  hint,
  required = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-k-text-primary">
        {label}
        {required && (
          <span className="ml-0.5 text-k-cloud-deep" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-k-text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A client secret: empty on open whatever is stored, with the hint carrying the
 * state (stored / to be removed / not set) and **Wissen** the only way to remove one.
 */
export function SecretField({
  id,
  stored,
  draft,
  onChange,
}: {
  id: string;
  stored: boolean;
  draft: SecretDraft;
  onChange: (next: SecretDraft) => void;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const replacing = draft.value.trim() !== "";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-k-text-primary">
          Client secret
        </label>
        {stored && !replacing && (
          <button
            type="button"
            onClick={() => onChange({ value: "", clear: !draft.clear })}
            className="cursor-pointer text-xs font-medium text-k-text-secondary transition-colors hover:text-k-cloud-deep"
          >
            {draft.clear ? t("Niet wissen", "Don't clear") : t("Wissen", "Clear")}
          </button>
        )}
      </div>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value, clear: false })}
          placeholder={stored ? t("Laat leeg om te bewaren", "Leave empty to keep") : t("Nog niet ingesteld", "Not set yet")}
          className={`${inputClass} w-full pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("Secret verbergen", "Hide secret") : t("Secret tonen", "Show secret")}
          title={visible ? t("Verbergen", "Hide") : t("Tonen", "Show")}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={1.8} />
          )}
        </button>
      </div>
      <p className={`mt-1 text-xs ${draft.clear ? "text-k-red-fg" : "text-k-text-secondary"}`}>
        {replacing
          ? t("Wordt bij opslaan vervangen.", "Will be replaced on save.")
          : draft.clear
            ? t("Wordt bij opslaan gewist.", "Will be cleared on save.")
            : stored
              ? t("Er is een secret opgeslagen. Vul alleen iets in om het te vervangen.", "A secret is stored. Only fill this in to replace it.")
              : t("Er is nog geen secret opgeslagen.", "No secret is stored yet.")}
      </p>
    </div>
  );
}

/** Inline strip for a failure or a confirmation, in the app's usual two tones. */
export function Notice({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  const error = tone === "error";
  const Icon = error ? AlertCircle : CheckCircle2;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px] ${
        error ? "bg-k-red-bg text-k-red-fg" : "bg-k-green-bg text-k-green-fg"
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}
