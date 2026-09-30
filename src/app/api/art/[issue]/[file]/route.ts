import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { artPath } from "@/lib/server/store";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/art/[issue]/[file]">) {
  const { issue, file } = await ctx.params;
  const p = artPath(issue, file);
  if (!p) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(p);
    return new Response(bytes, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
