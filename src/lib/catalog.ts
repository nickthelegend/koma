import type { Comic } from "@/lib/types";
import { bump, getIssue, listIssues } from "@/lib/server/store";

/** Every minted issue, newest first. */
export const allComics = (): Promise<Comic[]> => listIssues();

export const findComic = (id: string): Promise<Comic | null> => getIssue(id);

export const countRead = (id: string) => bump(id, "reads");

/** The spotlight: most-read issue, newest breaking ties. */
export function spotlight(list: Comic[]) {
  return list.reduce<Comic | null>((best, c) => (!best || c.reads > best.reads ? c : best), null);
}
