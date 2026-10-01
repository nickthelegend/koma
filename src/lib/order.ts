import { GENRES, cast, styles } from "@/lib/studio-config";
import { EPISODE_PRICE_PER_PAGE, PAGE_OPTIONS, PRICE_PER_PAGE } from "@/lib/network";
import type { CustomCharacter, Genre, Order } from "@/lib/types";

/** Validates a studio or API order. Shared so the 402 quote and the handler agree. */
export function parseOrder(body: unknown): { order: Order } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (prompt.length < 12) return { error: "Describe the story in at least one sentence (12+ characters)." };
  if (prompt.length > 600) return { error: "Keep the story idea under 600 characters." };
  const pages = Number(b.pages ?? 2);
  if (!PAGE_OPTIONS.includes(pages as never)) return { error: `pages must be one of ${PAGE_OPTIONS.join(", ")}.` };
  const style = typeof b.style === "string" ? b.style : styles[0].id;
  if (!styles.some((s) => s.id === style)) return { error: `style must be one of ${styles.map((s) => s.id).join(", ")}.` };
  const ids = Array.isArray(b.cast) ? b.cast.filter((c): c is string => typeof c === "string") : [];
  if (ids.some((id) => !cast.some((c) => c.id === id))) return { error: `cast ids must be from: ${cast.map((c) => c.id).join(", ")}.` };
  const rawCustom = Array.isArray(b.custom) ? b.custom : [];
  const custom: CustomCharacter[] = [];
  for (const c of rawCustom) {
    const name = typeof c?.name === "string" ? c.name.trim() : "";
    const look = typeof c?.look === "string" ? c.look.trim() : "";
    if (name.length < 2 || name.length > 30) return { error: "Each custom character needs a name of 2 to 30 characters." };
    if (look.length < 10 || look.length > 200) return { error: `Describe how ${name || "each custom character"} looks in 10 to 200 characters.` };
    custom.push({ name, look });
  }
  if (ids.length + custom.length > 2) return { error: "An issue can star at most two chosen or designed characters." };
  let genre: Genre | undefined;
  if (b.genre !== undefined && b.genre !== null && b.genre !== "") {
    if (!GENRES.includes(b.genre as Genre)) return { error: `genre must be one of ${GENRES.join(", ")}.` };
    genre = b.genre as Genre;
  }
  let title: string | undefined;
  if (typeof b.title === "string" && b.title.trim()) {
    title = b.title.trim();
    if (title.length < 2 || title.length > 28) return { error: "title must be 2 to 28 characters." };
  }
  const remixOf = typeof b.remixOf === "string" && b.remixOf ? b.remixOf : undefined;
  let seriesId: number | undefined;
  if (b.seriesId !== undefined && b.seriesId !== null && b.seriesId !== "") {
    seriesId = Number(b.seriesId);
    if (!Number.isInteger(seriesId) || seriesId < 1) return { error: "seriesId must be a launched series id." };
    if (remixOf) return { error: "An episode proposal can't also be a remix of an issue." };
  }
  return { order: { prompt, title, pages, style, cast: ids, custom: custom.length ? custom : undefined, genre, remixOf, seriesId } };
}

export const pagePrice = (episode: boolean) => (episode ? EPISODE_PRICE_PER_PAGE : PRICE_PER_PAGE);
export const priceFor = (pages: number, episode = false) => (pages * pagePrice(episode)).toFixed(2);
