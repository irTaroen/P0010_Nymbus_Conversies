import type { SendStage } from "@/lib/payload-send";

/**
 * **Where a write lands, stated rather than described** — the block both the send
 * and the delete confirmation carry under their heading.
 *
 * The sentence above it says *test-omgeving*, which is a category; this says which
 * one — the AFAS environment number and the stage, the two facts that together
 * identify a single administration. Set apart from the prose and in mono because
 * that is how the number is read everywhere else in the app (and how it appears in
 * AFAS itself), and because a reader checking "am I about to write into the
 * customer's real books" should find the answer without parsing a sentence.
 *
 * Live wears the alarm here too, not only in the paragraph below it: this block is
 * the thing being checked, so the check has to carry the colour.
 */
export default function EnvironmentTarget({
  stage,
  omgeving,
  host,
  projectName,
  className = "mt-4",
}: {
  stage: SendStage;
  /** The AFAS environment number — `38892`. Empty only when none is stored. */
  omgeving: string;
  /** The full host it resolves to, `38892.resttest.afas.online`. May be empty. */
  host: string;
  projectName: string;
  /** Spacing from its neighbours — `mt-4` under a heading, the default. */
  className?: string;
}) {
  const live = stage === "live";
  return (
    <div
      className={`${className} flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-3 py-2.5 shadow-inset-sm ${
        live ? "bg-k-red-bg" : "bg-k-bg"
      }`}
    >
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide shadow-inset-sm ${
          live ? "bg-k-red-bg text-k-red-fg" : "bg-k-green-bg text-k-green-fg"
        }`}
      >
        {live ? "Live" : "Test"}
      </span>
      {/* The number on its own, at the size of a figure rather than of prose — an
          empty one is the project that has no environment stored, which the call
          would fail on anyway, so it says so here instead of showing a gap. */}
      <span
        className={`font-mono text-base font-bold tabular-nums ${
          live ? "text-k-red-fg" : "text-k-text-primary"
        }`}
      >
        {omgeving || "geen omgevingsnummer"}
      </span>
      {/* The host, which is where the stage becomes visible as a fact rather than a
          label: `.resttest` and `.rest` are the whole difference. */}
      {host && (
        <span
          className={`min-w-0 truncate font-mono text-xs ${
            live ? "text-k-red-fg" : "text-k-text-secondary"
          }`}
        >
          {host}
        </span>
      )}
      {projectName && (
        <span
          className={`ml-auto min-w-0 truncate text-xs ${
            live ? "text-k-red-fg" : "text-k-text-secondary"
          }`}
        >
          {projectName}
        </span>
      )}
    </div>
  );
}
