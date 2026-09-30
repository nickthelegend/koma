"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGrid, IconReceipt, IconShelf, IconPen, IconSeries } from "./icons";
import { isImmersive } from "./top-bar";

const left = [
  { href: "/", label: "Catalog", Icon: IconGrid },
  // Search lives in the catalog's search box.
  { href: "/series", label: "Series", Icon: IconSeries },
];
const right = [
  { href: "/receipts", label: "Receipts", Icon: IconReceipt },
  { href: "/shelf", label: "Shelf", Icon: IconShelf },
];

function Item({ href, label, Icon, active }: { href: string; label: string; Icon: typeof IconGrid; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center gap-1 pt-2.5 text-[10.5px] font-medium ${active ? "text-kapow" : "text-mute"}`}
    >
      <Icon width={21} height={21} />
      {label}
    </Link>
  );
}

/** Phone tab bar. The center Create button is the one raised, printed object. */
export function BottomNav() {
  const path = usePathname();
  if (isImmersive(path) || path.startsWith("/create")) return null;
  const is = (h: string) => (h === "/" ? path === "/" : h === "/series" ? path.startsWith("/series") || path.startsWith("/s/") || path.startsWith("/launch") : path.startsWith(h));

  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-ink/95 pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur-md md:hidden"
    >
      <div className="flex items-stretch">
        {left.map((l) => <Item key={l.href} {...l} active={is(l.href)} />)}
        <div className="relative flex w-[92px] justify-center">
          <Link href="/create" className="slant absolute -top-5 h-[52px] w-[84px] text-[17px]" aria-label="Create a comic">
            <IconPen width={17} height={17} />
            Make
          </Link>
        </div>
        {right.map((l) => <Item key={l.href} {...l} active={is(l.href)} />)}
      </div>
    </nav>
  );
}
