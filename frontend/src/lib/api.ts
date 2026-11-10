import { tr } from "@/lib/i18n";

/**
 * Base URL of the FastAPI backend. Empty by default: the browser calls `/api/*` on
 * this origin and Next rewrites it to the backend (`next.config.ts`), so there is no
 * CORS and no second address to configure. Set `NEXT_PUBLIC_API_URL` to call the
 * backend directly instead.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Absolute URL for a backend path, e.g. `apiUrl("/api/health")`. */
export function apiUrl(path: string): string {
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

/** Raised when a backend call fails; `message` is meant for the user. */
export class ApiError extends Error {}

/** `RequestInit` for a JSON body, e.g. `jsonBody("PUT", settings)`. */
export function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * One call to the backend, up to an answer that went well: everything
 * {@link requestJson} and {@link requestBlob} share, so the two can't drift.
 *
 * Every failure — no connection, a non-2xx status — becomes an `ApiError` carrying
 * the backend's own `detail` when it sent one and `fallbackMessage` otherwise, so
 * callers only ever have to show `err.message`. A failure is read as JSON whatever
 * the caller wanted, because every error this backend raises is an
 * `HTTPException` with a `detail` string.
 *
 */
async function send(
  path: string,
  init: RequestInit | undefined,
  fallbackMessage: string
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(
      tr("Geen verbinding met de server. Probeer het later opnieuw.", "No connection to the server. Please try again later.")
    );
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(typeof data?.detail === "string" ? data.detail : fallbackMessage);
  }
  return response;
}

/** Call a backend endpoint and read the JSON it answers with — see {@link send}. */
export async function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  fallbackMessage: string
): Promise<T> {
  const response = await send(path, init, fallbackMessage);
  // A 2xx with an unreadable body (a 204, say) reads as null, as it always has.
  return (await response.json().catch(() => null)) as T;
}

/**
 * Call a backend endpoint and read its body as a `Blob` — a file tile's download,
 * where {@link requestJson} always reads JSON. Same error handling ({@link send}); only the success path differs.
 */
export async function requestBlob(path: string, fallbackMessage: string): Promise<Blob> {
  const response = await send(path, undefined, fallbackMessage);
  return response.blob();
}
