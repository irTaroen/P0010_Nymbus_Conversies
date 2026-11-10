import { useT } from "@/lib/i18n";

/**
 * The app's hero: the bold heading with its italic cloud-blue accent, and whatever copy
 * belongs beside it on this page.
 *
 * Its own component because both top-level screens open with it and they have nothing
 * else in common: the **project** page has it over the projectrapport
 * ([`ProjectLanding`](./ProjectLanding.tsx)), a **module** page over its toolbar and
 * dropzone ([`ExcelUploader`](./ExcelUploader.tsx)). Only `intro` differs — the
 * project's word about the conversion, a module's word about itself.
 *
 * **Side by side, not stacked.** It was a centred column with the copy underneath,
 * which cost the better part of a screen: on the project page that pushed the report
 * under the fold, on a module page the dropzone. Beside each other the two cost one
 * block of height instead of two, and the height a hero doesn't take is height the
 * thing the page is actually for does.
 *
 * The widths live here rather than at the call site because they are about the
 * *heading*: the line break is hand-placed, so the column has to hold the line placed
 * for it. `max-w-3xl` halved into two columns leaves too little for "Van Excel naar
 * AFAS", hence the break after *naar* and a heading one size down from the `text-5xl`
 * of the centred original — which is also why the width stayed here when the
 * projectrapport underneath outgrew it: two paragraphs and a six-column table want
 * different widths, and the table's module names lose more to a shared edge than the
 * hero gains from one.
 *
 * Two columns from `lg`, not `sm`: the sidebar takes `w-68` out of the viewport before
 * this container sees it, and half of what a tablet has left doesn't hold "AFAS zonder
 * gedoe" at `text-4xl`. Under `lg` the two cells stack — heading first, as before,
 * left-aligned.
 *
 * `intro` starts level with the heading, so it brings no top margin of its own.
 *
 * On a phone the heading scales with the screen (`clamp()`, reaching `text-3xl` at
 * about 430px) and the gap under it shrinks, so what the page is for starts higher.
 */
export default function Hero({ intro }: { intro: React.ReactNode }) {
  const t = useT();
  return (
    <section className="mx-auto mb-8 grid w-full max-w-3xl shrink-0 items-center gap-x-8 gap-y-4 max-sm:mb-5 max-sm:gap-y-3 lg:grid-cols-2">
      <h1 className="text-[clamp(1.625rem,7vw,1.875rem)] font-bold leading-[1.15] tracking-[-0.8px] text-k-text-primary lg:text-[32px]">
        {t("Van Excel naar", "From Excel to")}
        <br />
        {/* The English as short as the Dutch: the column is sized for "AFAS zonder
            gedoe", and "without the hassle" wrapped into a third line. */}
        {/* The headline's one accent: the key word in italic cloud-deep (nymbus-styling.md §4). */}
        <span className="italic text-k-cloud-deep">AFAS</span>
        {t(<> zonder gedoe</>, <>, <span className="whitespace-nowrap">hassle-free</span></>)}
      </h1>
      <div className="min-w-0">{intro}</div>
    </section>
  );
}
