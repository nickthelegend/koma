"use client";

import { KOMA } from "@/lib/network";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./brand";
import { WalletButton } from "./wallet-button";

const links = [
  { href: "/", label: "Catalog" },
  { href: "/series", label: "Series" },
  { href: "/launch", label: "Launch" },
  { href: "/create", label: "Create" },
  // Tablet widths run out of room first; receipts are also in the footer.
  { href: "/receipts", label: "Receipts", wide: true },
  { href: "/shelf", label: "Shelf" },
];

export function isImmersive(path: string) {
  return /^\/c\/[^/]+\/read/.test(path);
}

export function TopBar() {
  const path = usePathname();
  if (isImmersive(path)) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-rule/70 bg-ink/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-6 px-4 md:h-16 md:px-8 lg:gap-8">
        <Wordmark />
        <nav className="hidden items-center gap-4 md:flex lg:gap-6" aria-label="Main">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : l.href === "/series" ? path.startsWith("/series") || path.startsWith("/s/") : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`font-display text-[15px] uppercase tracking-wide transition-colors ${"wide" in l ? "hidden lg:inline" : ""} ${active ? "text-kapow" : "text-soft hover:text-paper"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-[12px] text-mute lg:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-arb" />
            {KOMA.label}
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
