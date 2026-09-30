"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconBack } from "./icons";
import { ShareButton } from "./share-button";

/** Thin reader header: back, title, which page you're on, and a read-progress rule. */
export function ReaderChrome({ id, title, pages }: { id: string; title: string; pages: number }) {
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-page]")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setPage(Number(e.target.getAttribute("data-page")));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setProgress(max > 0 ? Math.min(1, scrollY / max) : 0);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[900px] items-center gap-3 px-3">
        <Link href={`/c/${id}`} aria-label="Back to issue" className="grid h-10 w-10 place-items-center text-paper hover:text-kapow">
          <IconBack />
        </Link>
        <p className="min-w-0 flex-1 truncate font-display text-[18px] uppercase tracking-wide">{title}</p>
        <p className="font-mono text-[12px] text-soft" aria-live="polite">
          {page} / {pages}
        </p>
        <ShareButton title={title} path={`/c/${id}`} variant="icon" />
      </div>
      <div className="h-[3px] bg-rule">
        <div className="h-full origin-left bg-kapow" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </header>
  );
}
