import { Loader2 } from "lucide-react";
import type { MetricText } from "@/lib/validation/metrics";

/**
 * One headline figure, laid out **sideways**: the number, then its caption with the
 * quiet denominator under it.
 *
 * The same three strings the validatierapport stacks at `text-4xl` and the PDF
 * prints — neither a bar nor a card above a dropzone has room for that, so the figure
 * is two steps smaller and the caption sits beside it instead of below. Its own file
 * because two surfaces print it now: the [sheet toolbar](./SheetToolbar.tsx) while a
 * file is open, and the [module start card](./ModuleStartCard.tsx) before one is —
 * live figures in the first, the module's last stored check in the second. One
 * renderer, so the module's percentage can't be set one way in one place and another
 * in the other.
 *
 * `busy` marks the detail line as work in progress (a spinner before it) — the
 * toolbar puts the payload view's background read there rather than on a line of
 * its own, so it coming and going never moves what is under the figures.
 */
export default function Metric({ metric, busy = false }: { metric: MetricText; busy?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-k-bg p-[18px] shadow-raised-sm">
      {/* Proportional figures on purpose — tabular-nums makes a standalone
          number at this size look loose. */}
      <span className="shrink-0 text-2xl font-bold leading-none tracking-tight text-k-text-primary">
        {metric.figure}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm leading-snug text-k-text-secondary">{metric.caption}</span>
        {metric.detail && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-snug tabular-nums text-k-text-secondary">
            {busy && (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-k-cloud-deep" strokeWidth={2} />
            )}
            <span className="truncate">{metric.detail}</span>
          </span>
        )}
      </span>
    </div>
  );
}
