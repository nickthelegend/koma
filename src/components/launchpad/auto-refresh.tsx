"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server parts of the page now and then, so other people's trades show up. */
export function AutoRefresh({ every = 20_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    // Returning to the tab refreshes at once.
    const onShow = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [router, every]);
  return null;
}
