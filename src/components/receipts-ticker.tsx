import { allComics } from "@/lib/catalog";
import { short } from "@/lib/format";
import { ArbMark } from "./icons";

/** The one ambient motion on the site: settled payments rolling past like a stock tape. */
export async function ReceiptsTicker() {
  const items = (await allComics()).slice(0, 16).map((c) => ({
    who: c.creator.name,
    title: c.title,
    usdc: c.chain.paidUsdc,
    tx: c.chain.paymentTx,
  }));
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((i) => (
        <li key={i.tx} className="flex items-center gap-2 whitespace-nowrap px-5 text-[12.5px]">
          <ArbMark width={13} height={13} />
          <span className="text-paper">{i.who}</span>
          <span className="text-mute">paid</span>
          <span className="font-mono text-arb">{i.usdc} USDC</span>
          <span className="text-mute">for</span>
          <span className="font-display uppercase tracking-wide text-paper">{i.title}</span>
          <span className="font-mono text-[11px] text-mute">{short(i.tx, 6, 4)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="relative overflow-hidden border-y border-arb/25 bg-[#07131d] py-2.5" role="marquee" aria-label="Recent payments on Arbitrum">
      <div className="flex w-max animate-ticker motion-reduce:animate-none">
        {row(false)}
        {row(true)}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[#07131d]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#07131d]" />
    </div>
  );
}
