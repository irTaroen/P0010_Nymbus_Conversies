"use client";

import { useUserType } from "@/components/AuthProvider";

/**
 * Show its children only to a signed-in user of the given type(s) — the
 * employee/client counterpart of [`AdminOnly`](./AdminOnly.tsx), for the rarer
 * case where something should differ by that axis instead of (or alongside)
 * admin rights. The two are independent: a non-admin employee and a customer
 * contact both fail `AdminOnly`, but only one of them passes
 * `<UserTypeOnly type="employee">`.
 *
 *     <UserTypeOnly type="employee">
 *       <SomeInternalOnlyThing />
 *     </UserTypeOnly>
 *
 * Same two caveats as `AdminOnly`: **not a security boundary** — anything that
 * must not be reachable by a client has to be checked again server-side, the
 * same way `_require_admin` backs `AdminOnly` — and it doesn't gate on data,
 * only on the signed-in user's own `type` (`backend/oidc.py`'s
 * `classify_user`, carried on `Session.user.type`).
 */
export default function UserTypeOnly({
  type,
  children,
  fallback = null,
}: {
  type: "employee" | "client" | Array<"employee" | "client">;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const userType = useUserType();
  const allowed = Array.isArray(type) ? type : [type];
  return <>{userType && allowed.includes(userType) ? children : fallback}</>;
}
