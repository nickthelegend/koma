import Link from "next/link";
import type { ActivityEvent } from "@/lib/launchpad/types";
import { txUrl, isExternal } from "@/lib/explorer";
import { agoSec, short, usdAmount } from "@/lib/format";

const TAG: Record<ActivityEvent["kind"], { label: string; cls: string }> = {
  buy: { label: "Buy", cls: "text-arb" },
  sell: { label: "Sell", cls: "text-kapow" },
  launch: { label: "Launch", cls: "text-paper" },
  graduated: { label: "Graduated", cls: "bg-arb px-1 py-0.5 text-ink" },
  canon: { label: "Canon", cls: "bg-bam px-1 py-0.5 text-ink" },
};

function Line({ e }: { e: ActivityEvent }) {
  const coin = (
    <Link href={`/s/${e.seriesId}`} className="font-mono text-paper underline decoration-rule underline-offset-4 hover:text-kapow hover:decoration-kapow">
      ${e.symbol}
    </Link>
  );
  const series = (
    <Link href={`/s/${e.seriesId}`} className="font-semibold text-paper underline decoration-rule underline-offset-4 hover:text-kapow hover:decoration-kapow">
      {e.name}
    </Link>
  );
  const who = e.who ? <span className="font-mono text-soft">{short(e.who)}</span> : "Someone";
  const amount = <span className="font-mono text-paper">{usdAmount(e.usdc ?? 0)}</span>;
  switch (e.kind) {
    case "buy":
      return <>{who} bought {amount} of {coin}{e.pool && " in its v4 pool"}</>;
    case "sell":
      return <>{who} sold {amount} of {coin}{e.pool && " into its v4 pool"}</>;
    case "launch":
      return <>{series} launched as {coin}</>;
    case "graduated":
      return <>{coin} filled its curve at {amount} and graduated into Uniswap v4</>;
    case "canon":
      return <>Episode {e.episode} of {series} became canon</>;
  }
}

/**
 * The board's one moving part: the latest on-chain events, newest on top. Rows
 * are keyed, so when the page refreshes only new events mount and print in;
 * existing rows stay put. Still under reduced motion.
 */
export function LiveTape({ events, now }: { events: ActivityEvent[]; now: number }) {
  return (
    <section aria-labelledby="tape-h" className="flex h-full min-h-0 flex-col border border-rule bg-stock">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule px-4 py-3">
        <h2 id="tape-h" className="font-display text-[22px] uppercase leading-none text-paper">Live tape</h2>
        <p className="text-[11.5px] text-mute">Launches, trades, graduations and canon, from the chain</p>
      </header>
      {events.length === 0 ? (
        <p className="px-4 py-8 text-[13px] leading-relaxed text-mute">Nothing on the tape yet. The first launch shows up here.</p>
      ) : (
        <ol className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          {events.map((e, i) => {
            const tag = TAG[e.kind];
            return (
              <li
                key={e.id}
                className="print-in grid grid-cols-[62px_minmax(0,1fr)] items-baseline gap-x-2.5 border-t border-rule/70 px-4 py-2.5 first:border-t-0 max-lg:[&:nth-child(n+7)]:hidden"
                style={{ "--i": Math.min(i, 10) } as React.CSSProperties}
              >
                <span className="justify-self-start">
                  <span className={`font-display text-[12px] uppercase leading-none ${tag.cls}`}>{tag.label}</span>
                </span>
                <p className="text-[13px] leading-snug text-soft">
                  <Line e={e} />{" "}
                  {e.tx ? (
                    <a href={txUrl(e.tx)} target={isExternal ? "_blank" : undefined} rel="noreferrer" className="whitespace-nowrap font-mono text-[11px] text-mute hover:text-arb" title="View the transaction">
                      {agoSec(e.at, now * 1000)}
                    </a>
                  ) : (
                    <span className="whitespace-nowrap font-mono text-[11px] text-mute">{agoSec(e.at, now * 1000)}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
