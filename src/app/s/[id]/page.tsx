import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { seriesDetail } from "@/lib/server/launchpad/queries";
import type { SeriesDetail } from "@/lib/launchpad/types";
import { txUrl, isExternal } from "@/lib/explorer";
import { agoSec, coinAmount, coinPrice, coinPricePlain, compact, progressLabel, short, usdAmount } from "@/lib/format";
import { Sheet, RaisedBar, DemoBadge, GraduatedBadge } from "@/components/launchpad/sheet";
import { BuiltOnArbitrum } from "@/components/launchpad/built-on-arbitrum";
import { CharacterEarnings } from "@/components/launchpad/character-earnings";
import { COIN_DISCLAIMER, MAINNET } from "@/components/launchpad/network-note";
import { config } from "@/lib/server/config";
import { TOTAL_SUPPLY } from "@/lib/launchpad/abi";
import { PriceChart } from "@/components/launchpad/price-chart";
import { TradeWidget } from "@/components/launchpad/trade-widget";
import { CanonBoard } from "@/components/launchpad/canon-board";
import { AddressList } from "@/components/launchpad/address-list";
import { AutoRefresh } from "@/components/launchpad/auto-refresh";
import { ArbMark, IconBack, IconRemix } from "@/components/icons";
import { FEE_SPLIT, GRADUATION_FEE_PCT, TRADE_FEE_PCT } from "@/lib/network";

export const dynamic = "force-dynamic";

// Metadata and the page share one read per request.
const load = cache(async (raw: string): Promise<SeriesDetail | null> => {
  const id = Number(raw);
  if (!launchpad() || !Number.isInteger(id) || id < 1) return null;
  return seriesDetail(id);
});

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  const s = await load((await params).id);
  if (!s) return {};
  const description = `${s.name} ($${s.symbol.trim()}) starring ${s.characterName}. ${s.pitch}`.slice(0, 200);
  return {
    title: `${s.name} ($${s.symbol.trim()})`,
    description,
    openGraph: { title: `${s.name} — a KOMA series`, description, images: s.sheetUrl ? [s.sheetUrl] : undefined },
    twitter: { card: "summary_large_image" },
  };
}

const KIND = ["Character wallet", "Ancestor character", "KOMA treasury"];

function Stat({ label, value, title, chain = false }: { label: string; value: string; title?: string; chain?: boolean }) {
  return (
    <div className="bg-stock px-4 py-3.5">
      <dt className="text-[12px] text-mute">{label}</dt>
      <dd className={`mt-1 font-mono text-[19px] leading-none md:text-[22px] ${chain ? "text-arb" : "text-paper"}`} title={title}>{value}</dd>
    </div>
  );
}

export default async function SeriesPage({ params }: PageProps<"/s/[id]">) {
  const s = await load((await params).id);
  if (!s) notFound();
  const lp = launchpad()!;
  // Chart runs to the chain's clock (trade times are block times).
  const now = s.chainTime;
  const royaltiesTotal = s.royalties.reduce((t, r) => t + r.amountUsdc, 0);
  const symbol = s.symbol.trim();
  const stylus = lp.engine === "stylus";

  return (
    <>
      <AutoRefresh />
      {/* ——— Header ——— */}
      <section className="mx-auto max-w-[1320px] px-4 pt-5 md:px-8 md:pt-8">
        <Link href="/series" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-soft hover:text-kapow">
          <IconBack width={16} height={16} /> All series
        </Link>
        <div className="mt-5 grid gap-7 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-12">
          <div className="relative md:rotate-[-0.8deg]">
            <span className="tape -top-3 left-10 rotate-[-5deg]" aria-hidden />
            <Sheet src={s.sheetUrl} name={s.characterName} priority caption sizes="(min-width: 768px) 56vw, 100vw" className="shadow-[0_30px_50px_-15px_rgba(0,0,0,0.85)] ring-1 ring-white/5" />
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              {s.graduated ? <GraduatedBadge /> : s.demo && !MAINNET && <DemoBadge target={s.targetUsdc} />}
              {s.genre && <span className="bg-paper px-1.5 py-1 font-display text-[11px] uppercase leading-none text-paper-ink">{s.genre}</span>}
              <a href="#built-on-arbitrum" className="flex items-center gap-1.5 border border-arb/40 px-1.5 py-0.5 text-[11.5px] text-arb hover:border-arb">
                <ArbMark width={12} height={12} />
                {stylus ? "Curve math on Arbitrum Stylus" : "Curve math: Solidity reference"}
              </a>
            </div>
            <h1 className="masthead mt-3 break-words text-[clamp(52px,16vw,84px)] text-paper md:text-[clamp(72px,7.2vw,112px)]">{s.name}</h1>
            <p className="mt-3 text-[14px] text-soft">
              <span className="font-mono text-kapow">${symbol}</span> · starring <span className="font-semibold text-paper">{s.characterName}</span>
            </p>
            {s.pitch && <p className="mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-soft">{s.pitch}</p>}
            {s.parent && (
              <p className="mt-3 flex items-center gap-1.5 text-[13px] text-soft">
                <IconRemix width={14} height={14} /> Remix of{" "}
                <Link href={`/s/${s.parent.id}`} className="font-semibold text-paper underline decoration-kapow underline-offset-4">
                  {s.parent.name}
                </Link>
              </p>
            )}
            <p className="mt-4 border-l-2 border-arb pl-3 text-[13px] leading-relaxed text-soft">
              {s.characterName} has its own wallet (ERC-6551) and has earned{" "}
              <a href="#character-wallet" className="font-mono text-paper underline decoration-arb underline-offset-4 hover:text-arb">
                {usdAmount(s.characterEarnedUsdc)}
              </a>{" "}
              in trading fees so far.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-mute">
              <span>
                Launched by <span className="font-mono text-soft">{short(s.creator)}</span> {agoSec(s.launchedAt, s.chainTime * 1000)}
              </span>
              {s.launchTx && (
                <a href={txUrl(s.launchTx)} target={isExternal ? "_blank" : undefined} rel="noreferrer" className="text-arb hover:underline">
                  Launch tx {short(s.launchTx, 8, 4)}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ——— Numbers ——— */}
        <dl className="mt-9 grid grid-cols-2 gap-px border border-rule bg-rule md:grid-cols-4">
          <Stat label="Price per coin" value={coinPrice(s.priceUsdc)} title={coinPricePlain(s.priceUsdc)} chain />
          <Stat label="Market cap" value={usdAmount(s.marketCapUsdc)} />
          <Stat label="Holders" value={s.holders.toLocaleString("en-US")} />
          <Stat label="Canon episodes" value={String(s.episodes)} />
        </dl>
        <div className="mt-5 grid items-end gap-x-6 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)]">
          {s.graduated ? (
            <p className="text-[13.5px] text-soft md:col-span-2">
              Raised <span className="font-mono text-paper">{usdAmount(s.raisedUsdc)}</span> and graduated into a locked Uniswap v4 pool.
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-2 md:block">
                <span className="masthead block text-[52px] leading-[0.8] text-arb">{progressLabel(s.raisedUsdc, s.targetUsdc)}</span>
                <span className="text-[12px] text-mute md:mt-1 md:block">{s.complete ? "curve complete" : "to graduation"}</span>
              </p>
              <div className="min-w-0">
                <RaisedBar raised={s.raisedUsdc} target={s.targetUsdc} size="lg" />
                <p className="mt-1 text-[12px] text-mute">
                  At ${s.targetUsdc.toLocaleString("en-US")} raised the curve closes and becomes a Uniswap v4 pool
                  {s.demo && !MAINNET ? ". Demo series: canon votes run 5 minutes." : "."}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ——— Trade + story. Phones read: chart, trade, canon, the rest. ——— */}
      <div className="mx-auto mt-10 grid max-w-[1320px] gap-8 px-4 md:grid-cols-[minmax(0,1fr)_380px] md:gap-x-12 md:px-8">
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <PriceChart points={s.chart} now={now} />
        </div>

        <aside id="trade" aria-label={`Trade $${symbol}`} className="scroll-mt-24 md:col-start-2 md:row-span-2 md:row-start-1">
          <div className="flex flex-col gap-4 md:sticky md:top-24">
            <TradeWidget
              s={{ id: s.id, symbol: symbol, curve: s.curve, coin: s.coin, launchedAt: s.launchedAt, chainTime: s.chainTime, complete: s.complete, graduated: s.graduated, pool: s.pool, swapper: lp.swapper, graduator: lp.graduator, quoter: lp.v4Quoter }}
            />
            <p className="text-[12px] leading-relaxed text-mute">
              {s.graduated ? (
                <>
                  Since graduation, trades go through the Uniswap v4 pool and pay its 0.3% fee, which stays locked in the pool with the
                  liquidity.
                </>
              ) : (
                <>
                  Every trade pays a {TRADE_FEE_PCT}% fee: {FEE_SPLIT.character}% to {s.characterName}&rsquo;s wallet, {FEE_SPLIT.remix}% up the
                  remix tree, {FEE_SPLIT.treasury}% to KOMA.
                </>
              )}{" "}
              {COIN_DISCLAIMER}
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-12 md:col-start-1 md:row-start-2">
          <div id="canon" className="scroll-mt-24">
            <CanonBoard
              seriesId={s.id}
              symbol={symbol}
              characterName={s.characterName}
              coin={s.coin}
              canonRegistry={lp.canonRegistry}
              characterOwner={s.characterOwner}
            />
          </div>

          <CharacterEarnings
            account={s.characterAccount}
            owner={s.characterOwner}
            characterName={s.characterName}
            characterId={s.characterId}
            earnedUsdc={s.characterEarnedUsdc}
          />

          {/* ——— Trades ——— */}
          <section aria-labelledby="trades-h">
            <h2 id="trades-h" className="font-display text-[26px] uppercase leading-none text-paper">
              Trades <span className="text-[18px] text-mute">· latest {Math.min(60, s.trades.length)}</span>
            </h2>
            {s.trades.length === 0 ? (
              <p className="mt-3 border border-dashed border-rule px-4 py-6 text-center text-[13.5px] text-mute">
                No trades yet. The first buyer gets the launch price.
              </p>
            ) : (
              <div className="mt-4 border border-rule">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-stock text-[11.5px] text-mute">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-normal">Side</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">USDC</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">${symbol}</th>
                      <th scope="col" className="hidden px-3 py-2 text-right font-normal sm:table-cell">Price</th>
                      <th scope="col" className="hidden px-3 py-2 font-normal md:table-cell">Trader</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">When</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {s.trades.map((t) => (
                      <tr key={`${t.tx}-${t.at}-${t.coins}`} className="border-t border-rule">
                        <td className={`px-3 py-2 font-sans font-semibold ${t.isBuy ? "text-arb" : "text-kapow"}`}>{t.isBuy ? "Buy" : "Sell"}</td>
                        <td className="px-3 py-2 text-right text-paper">{usdAmount(t.usdc)}</td>
                        <td className="px-3 py-2 text-right text-soft">{coinAmount(t.coins)}</td>
                        <td className="hidden px-3 py-2 text-right text-soft sm:table-cell" title={coinPricePlain(t.price)}>{coinPrice(t.price)}</td>
                        <td className="hidden px-3 py-2 text-soft md:table-cell">{short(t.trader)}</td>
                        <td className="px-3 py-2 text-right">
                          <a href={txUrl(t.tx)} target={isExternal ? "_blank" : undefined} rel="noreferrer" className="text-mute hover:text-arb">
                            {agoSec(t.at, s.chainTime * 1000)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ——— Where the fees went ——— */}
          <section aria-labelledby="royalties-h">
            <h2 id="royalties-h" className="font-display text-[26px] uppercase leading-none text-paper">Where the fees went</h2>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-mute">
              The {TRADE_FEE_PCT}% fee is split on-chain as it&rsquo;s paid: {FEE_SPLIT.character}% to this character&rsquo;s wallet,{" "}
              {FEE_SPLIT.remix}% up the remix tree (half to the parent, a quarter to the grandparent, and so on), {FEE_SPLIT.treasury}% to
              KOMA&rsquo;s treasury. With no parent, the character keeps the {FEE_SPLIT.remix}%. At graduation, {GRADUATION_FEE_PCT}% of the USDC
              raised goes to KOMA and the rest seeds the pool.
            </p>
            {s.royalties.length === 0 ? (
              <p className="mt-3 text-[13px] text-mute">Nothing routed yet.</p>
            ) : (
              <ul className="mt-4 border border-rule">
                {s.royalties.map((r) => {
                  const pct = royaltiesTotal > 0 ? Math.round((r.amountUsdc / royaltiesTotal) * 100) : 0;
                  return (
                    <li key={`${r.recipient}-${r.kind}`} className="border-t border-rule px-3 py-2.5 text-[13px] first:border-t-0">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-paper">{r.kind === 0 && r.recipient.toLowerCase() === s.characterAccount.toLowerCase() ? `${s.characterName}’s wallet` : KIND[r.kind] ?? "Other"}</span>{" "}
                          <span className="font-mono text-[11.5px] text-mute">{short(r.recipient)}</span>
                        </span>
                        <span className="font-mono text-paper">{usdAmount(r.amountUsdc)}</span>
                        <span className="w-[40px] text-right font-mono text-[11.5px] text-mute">{pct}%</span>
                      </div>
                      <div className="mt-1.5 h-1 bg-rule" aria-hidden>
                        <div className="h-full bg-arb/70" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {s.remixRoyaltiesUsdc > 0 && (
              <p className="mt-2 text-[12.5px] text-mute">
                Plus <span className="font-mono text-soft">{usdAmount(s.remixRoyaltiesUsdc)}</span> to {s.characterName}&rsquo;s wallet from trades in its remixes.
              </p>
            )}
          </section>

          {/* ——— Remixes ——— */}
          <section aria-labelledby="remix-h" className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 id="remix-h" className="font-display text-[26px] uppercase leading-none text-paper">Remixes</h2>
              {s.remixes.length === 0 ? (
                <p className="mt-2 text-[13px] leading-relaxed text-mute">No remixes yet. A remix is a new series in this world; a share of its fees flows back here.</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {s.remixes.map((r) => (
                    <li key={r.id}>
                      <Link href={`/s/${r.id}`} className="inline-flex items-center gap-1.5 border border-rule px-2.5 py-1.5 text-[13px] text-soft hover:border-paper hover:text-paper">
                        <IconRemix width={13} height={13} /> {r.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/launch?parent=${s.id}`} className="mt-4 inline-flex h-11 items-center gap-2 border-2 border-paper/80 px-4 font-display text-[16px] uppercase text-paper hover:bg-paper hover:text-ink">
                <IconRemix width={16} height={16} /> Remix this series
              </Link>
              <p className="mt-6 text-[12px] leading-relaxed text-mute">
                {compact(TOTAL_SUPPLY)} ${symbol} in total: 95% sold on the curve, 5% to the creator vesting over 30 days.
              </p>
            </div>
            <AddressList
              title="This series on-chain"
              rows={[
                { label: "Coin", value: s.coin, note: `$${symbol} · ERC-20` },
                { label: "Curve", value: s.curve },
                { label: "Character wallet", value: s.characterAccount, note: `NFT #${s.characterId} · ERC-6551` },
                { label: "Character owner", value: s.characterOwner ?? "Unknown" },
                { label: "Creator vesting", value: s.vestingContract, note: "5%, linear over 30 days" },
              ]}
            />
          </section>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-[1320px] px-4 md:px-8">
        <BuiltOnArbitrum lp={lp} facilitator={config.account?.address ?? null} character={{ name: s.characterName, account: s.characterAccount }} />
      </div>
    </>
  );
}
