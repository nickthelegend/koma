import type { NextRequest } from "next/server";

/**
 * Best-effort client address for rate limits. Behind the Vercel front door the
 * visitor's address arrives in x-vercel-forwarded-for; otherwise the hosting
 * proxy's x-real-ip, or the last x-forwarded-for hop it appended. These can be
 * spoofed by a direct caller, so every limit also has a global cap.
 */
export function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "local"
  );
}
