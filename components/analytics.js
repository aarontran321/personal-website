// Vercel Web Analytics — framework-agnostic entry point, since this is a
// plain Vite multi-page site (no Next.js app/pages router to hook into).
// inject() no-ops safely outside a Vercel deployment, so this is also
// safe to run in local dev.
import { inject } from "@vercel/analytics";

inject();
