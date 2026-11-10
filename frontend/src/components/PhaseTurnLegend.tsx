import { PHASE_FILL } from "@/lib/modules";
import type { ProjectReport } from "@/lib/project-report";

/** One legend entry: the dot, the word, the count. */
function Entry({ fill, label, value }: { fill: string; label: string; value: number }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${fill}`} />
      {label}
      <span className="font-semibold tabular-nums text-k-text-primary">{value}</span>
    </li>
  );
}

/**
 * The legend under a project's *Fase* meter — the projectrapport's card and each
 * client card on the managementrapport, so both read a project the same way.
 *
 * Two groups on one line. **Fase** names every segment of the meter with its count,
 * so the meter is never read by colour alone. **Aan zet** says who has to move the
 * open modules — bij Nymbus, bij de klant — in the status dot's tones: the same
 * colours the open step wears in each row's stepper, so this explains both. No
 * *niet akkoord* there: a rejected module is still with one of the two, and counted
 * under them (`turnSegments`); its red cross on the row says the rest.
 * A hairline keeps the two apart; the second is not a part of the meter.
 */
export default function PhaseTurnLegend({
  report,
  className = "",
}: {
  report: Pick<ProjectReport, "phaseSegments" | "turnSegments">;
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-k-text-secondary ${className}`}>
      <li className="font-semibold uppercase tracking-wide text-k-text-secondary">Fase</li>
      {report.phaseSegments.map((s) => (
        <Entry key={s.id} fill={PHASE_FILL[s.id]} label={s.label} value={s.value} />
      ))}
    </ul>
  );
}
