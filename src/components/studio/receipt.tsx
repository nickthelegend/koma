import { usd } from "@/lib/format";
import { KOMA, PRICE_PER_PAGE } from "@/lib/network";

/** The quote, printed as a till receipt: what you pay, to whom, on which chain. */
export function Receipt({ pages, style, castCount, perPage = PRICE_PER_PAGE }: { pages: number; style: string; castCount: number; perPage?: number }) {
  const total = pages * perPage;
  const line = (a: React.ReactNode, b: React.ReactNode, strong = false) => (
    <div className={`flex justify-between gap-4 ${strong ? "font-bold" : ""}`}>
      <span>{a}</span>
      <span className="tabular-nums">{b}</span>
    </div>
  );
  return (
    <div className="relative bg-paper px-5 pb-8 pt-5 font-mono text-[12.5px] leading-6 text-paper-ink [clip-path:polygon(0_0,100%_0,100%_calc(100%-10px),95%_100%,90%_calc(100%-10px),85%_100%,80%_calc(100%-10px),75%_100%,70%_calc(100%-10px),65%_100%,60%_calc(100%-10px),55%_100%,50%_calc(100%-10px),45%_100%,40%_calc(100%-10px),35%_100%,30%_calc(100%-10px),25%_100%,20%_calc(100%-10px),15%_100%,10%_calc(100%-10px),5%_100%,0_calc(100%-10px))]">
      <p className="text-center font-display text-[26px] uppercase leading-none tracking-wide">KOMA</p>
      <p className="mt-1 text-center text-[11px] text-paper-ink/60">Quote for one new issue</p>
      <div className="my-3 border-t border-dashed border-paper-ink/40" />
      {line(`${pages} page${pages > 1 ? "s" : ""} × ${usd(perPage)}`, usd(total))}
      {line(`Style: ${style}`, "incl.")}
      {line(`Cast: ${castCount ? `${castCount} character${castCount > 1 ? "s" : ""}` : "invented"}`, "incl.")}
      {line("Lettering + mint", "incl.")}
      {line("Gas", "paid by KOMA")}
      <div className="my-3 border-t border-dashed border-paper-ink/40" />
      {line("Total", `${total.toFixed(2)} USDC`, true)}
      <div className="my-3 border-t border-dashed border-paper-ink/40" />
      <p className="text-[11px] leading-5 text-paper-ink/70">
        Paid over HTTP 402 on {KOMA.label}. You sign one USDC authorization; the facilitator settles it and the issue is minted
        to your wallet.
      </p>
    </div>
  );
}
