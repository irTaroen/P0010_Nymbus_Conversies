"use client";

import { useIsAdmin } from "@/components/AuthProvider";

/**
 * Show its children to admins only — the one way in this app to gate UI on
 * admin rights, whether that's a single toolbar button, a sidebar row, or a whole
 * page.
 *
 *     <AdminOnly>
 *       <ToolbarButton label="Instellingen" onClick={onConfig}>…</ToolbarButton>
 *     </AdminOnly>
 *
 * It renders no element of its own, so it can sit anywhere — inside a flex row,
 * a grid, or a `<ul>` — without touching the layout around it.
 *
 * `fallback` is what non-admins get instead. Leave it out for something they
 * simply shouldn't see (a button, a menu row); pass it where the absence would
 * be confusing — a page whose whole body is admin-only is better off saying so
 * than rendering an empty shell.
 *
 * Two things it deliberately does *not* do:
 *   - **It is not a security boundary.** Anything a non-admin must not be able to
 *     *do* is checked again on the backend (`_require_admin` in
 *     [main.py](../../../backend/main.py)); this only decides what is on screen.
 *   - **It doesn't gate on data.** "Admins carry every project, so only they see
 *     the project dropdown" is not an admin gate — see `ProjectSelector`, which
 *     branches on how many projects the session has. Use `AdminOnly` when the
 *     rule really is *admins only*, so the two stay tellable apart.
 */
export default function AdminOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const isAdmin = useIsAdmin();
  return <>{isAdmin ? children : fallback}</>;
}
