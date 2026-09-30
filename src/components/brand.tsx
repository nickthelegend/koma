import Link from "next/link";

/** The KOMA wordmark: a panel-bordered block, the only boxed type in the system. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="KOMA home" className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="grid h-7 w-7 place-items-center bg-kapow font-display text-[19px] leading-none text-ink">K</span>
      <span className="font-display text-[26px] leading-none tracking-tight text-paper">KOMA</span>
    </Link>
  );
}
