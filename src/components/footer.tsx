"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TornEdge } from "./torn-edge";
import { isImmersive } from "./top-bar";

const cols = [
  {
    title: "Read",
    links: [
      { href: "/", label: "Catalog" },
      { href: "/search", label: "Search" },
      { href: "/series", label: "Series" },
      { href: "/receipts", label: "Receipts" },
    ],
  },
  {
    title: "Make",
    links: [
      { href: "/create", label: "New comic" },
      { href: "/launch", label: "Launch a series" },
      { href: "/shelf", label: "Your shelf" },
      { href: "/how", label: "How payment works" },
    ],
  },
  {
    title: "Chain",
    links: [
      { href: "/how#x402", label: "x402 endpoint" },
      { href: "/how#contract", label: "Comic contract" },
      { href: "/how#facilitator", label: "Facilitator" },
      { href: "/how#launchpad", label: "Launchpad" },
    ],
  },
];

export function Footer() {
  const path = usePathname();
  if (isImmersive(path) || path.startsWith("/create")) return null;

  return (
    <footer className="relative mt-24 overflow-hidden">
      <TornEdge />
      <div className="crumple relative -mt-px pb-28 md:pb-10">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 pt-10 md:grid-cols-[1.2fr_2fr] md:px-8 md:pt-14">
          <div className="max-w-sm">
            <p className="font-display text-2xl uppercase leading-tight text-paper">Comics that pay their own way.</p>
            <p className="mt-3 text-[14px] leading-relaxed text-mute">
              Every issue is paid for with USDC over x402, drawn by AI, and minted to its maker on Arbitrum. No accounts, no
              subscriptions.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {cols.map((c) => (
              <div key={c.title}>
                <p className="mb-3 text-[12px] font-semibold text-mute">{c.title}</p>
                <ul className="space-y-2">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="font-display text-[14px] uppercase tracking-wide text-soft hover:text-kapow">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-[1320px] px-3 md:mt-14 md:px-6">
          <p className="masthead select-none whitespace-nowrap text-[44vw] leading-[0.8] text-paper md:text-[min(43vw,585px)]" aria-hidden>
            KOMA
          </p>
          <div className="mt-4 flex flex-wrap justify-between gap-2 px-1 text-[12px] text-mute">
            <span>© 2026 KOMA. Art generated per issue; rights go to the minter.</span>
            <span>Built on Arbitrum · Paid with x402</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
