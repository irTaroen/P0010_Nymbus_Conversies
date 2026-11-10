import type { NextConfig } from "next";

// Where the FastAPI backend listens. The browser only ever talks to this origin
// (http://localhost:3010) and `/api/*` is forwarded to the backend, so there is no
// CORS and no second address to configure. `make dev` starts both.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
  experimental: {
    // Next's rewrite proxy gives up after 30s by default. Some AFAS reads behind
    // /api (existing records, schema metainfo) take longer than that on a big
    // environment, and a cut-off there reads to the user as a failed check.
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return {
      // beforeFiles, so a dynamic route like /[projectId] can never swallow them.
      beforeFiles: [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }],
    };
  },
};

export default nextConfig;
