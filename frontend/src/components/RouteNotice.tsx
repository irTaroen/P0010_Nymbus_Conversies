import Link from "next/link";

/**
 * What a URL that leads nowhere renders: a project the signed-in user may not open, a
 * module this project can't import, a session without a single project. One centred
 * card that says which address was asked for, why it isn't there, and offers the one
 * way onward.
 *
 * A URL is typed, mailed and bookmarked now, so it can name something the session
 * doesn't have — a client who kept a link to last year's project, an admin pasting an
 * address to a colleague with different access. Answering that with an empty shell
 * would read as a broken app; this says which of the two it is.
 *
 * The link is a plain `<Link>`, not a [`GuardedLink`](./NavigationGuard.tsx): these
 * screens stand in for the page that would have rendered, so there is nothing open
 * behind them to leave and no guard installed to ask.
 */
export default function RouteNotice({
  title,
  description,
  action,
}: {
  title: string;
  description: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-105 flex-col items-center rounded-3xl bg-k-bg px-11 pt-11 pb-9 text-center shadow-raised">
        <h1 className="text-lg font-semibold text-k-text-primary">{title}</h1>
        <p className="mt-2 text-sm text-k-text-secondary">{description}</p>
        {action && (
          <Link
            href={action.href}
            className="neu-action-primary mt-5"
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}
