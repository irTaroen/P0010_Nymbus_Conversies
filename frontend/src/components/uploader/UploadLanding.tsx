"use client";

import Dropzone from "@/components/uploader/Dropzone";

/**
 * What a **module** page looks like below the hero before a sheet is on screen: the
 * module's card and the dropzone.
 *
 * Two things are deliberately *not* here any more. The **hero** moved up into
 * [`ExcelUploader`](../ExcelUploader.tsx), where the project page has it too, so both
 * top-level screens start with the same block. And the **sheet toolbar** no longer
 * stands above this at all — it comes with the sheet it describes — which is what
 * gives the dropzone below its height: it takes whatever the card leaves
 * (`flex-1`), so the page's one action fills the page instead of sitting in a strip
 * with empty space under it.
 *
 * `max-w-3xl`, the hero's own width and the projectrapport's, so every block on the
 * screen shares its edges. It was `max-w-2xl` when a full-width toolbar framed it;
 * without that frame a narrower column just read as an inset.
 *
 * The scroll container holds a `min-h-full` column rather than centring itself, so on
 * a short viewport the content overflows downwards and stays reachable instead of
 * being clipped at the top — and the dropzone's own `min-h` is what stops `flex-1`
 * from squeezing it to nothing there.
 */
export default function UploadLanding({
  intro,
  notice,
  showDropzone = true,
  onFile,
  onOpen,
}: {
  /** Above the dropzone: the module's start card. */
  intro: React.ReactNode;
  /**
   * Reading state, read failures, and the offer to restore a stored draft — **above**
   * the dropzone, not under it. It sat underneath while the zone was a fixed strip;
   * now that the zone fills the page, a failed read would have answered below the
   * fold, which is the same as not answering at all. Beside `intro` rather than under
   * it, see the grid below.
   */
  notice?: React.ReactNode;
  /** False while a modal is deciding what to do with a file — the dropzone steps aside. */
  showDropzone?: boolean;
  onFile: (file: File) => void;
  onOpen: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col pb-2">
        {/* Card and notice stand *beside* each other once both are there, and each
            takes the full width when it is alone — which is the common case, since
            the notice only appears after a session ended mid-sheet. Two columns
            because they are alternatives to one another: restore the stored work, or
            start again from the template below. Stacked, the one that came second
            read as a consequence of the first. `lg:` because at `max-w-3xl` a
            half-column is about 22rem — enough for these two cards' contents, but
            not below the hero's own breakpoint.

            The columns *stretch*: grid's default, left alone, so the two cards end
            up the same height whichever has more in it. Two cards of their own
            heights side by side read as one being unfinished; matched, they read as
            a pair. Each child passes the stretch down with `flex`, since the card
            inside it is what has to grow, not the wrapper around it. */}
        <div
          className={`grid w-full shrink-0 gap-4 ${notice ? "lg:grid-cols-2" : ""}`}
        >
          <div className="flex min-w-0 flex-col">{intro}</div>
          {notice && <div className="flex min-w-0 flex-col gap-3">{notice}</div>}
        </div>

        {showDropzone && (
          <div className="mt-5 flex min-h-72 w-full flex-1 flex-col">
            <Dropzone onFile={onFile} onOpen={onOpen} />
          </div>
        )}
      </div>
    </div>
  );
}
