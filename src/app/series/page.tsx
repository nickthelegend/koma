import type { Metadata } from "next";
import Link from "next/link";
import type { SeriesSummary } from "@/lib/launchpad/types";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { listSeries, recentActivity, sparklines } from "@/lib/server/launchpad/queries";
import { chainNow } from "@/lib/server/launchpad/chain-time";
import { SeriesCard } from "@/components/launchpad/series-card";
import { LiveTape } from "@/components/launchpad/live-tape";
import { AutoRefresh } from "@/components/launchpad/auto-refresh";
import { DemoBadge, GraduatedBadge, RaisedBar, RemixBadge, Sheet } from "@/components/launchpad/sheet";
import { COIN_DISCLAIMER, MAINNET } from "@/components/launchpad/network-note";
import { IconPlus, IconSearch } from "@/components/icons";
import { coinPrice, coinPricePlain, plural, progressLabel, usdAmount } from "@/lib/format";
import { KOMA, LAUNCH_PRICE } from "@/lib/network";

export const metadata: Metadata = {
  title: "Series",
  description: "Back a character and steer its story. Each KOMA series has a Character NFT with its own wallet and a coin on a USDC curve whose holders vote on canon.",
};

export const dynamic = "force-dynamic";

const TABS = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "graduating", label: "About to graduate" },
  { key: "graduated", label: "Graduated (v4)" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const progress = (s: SeriesSummary) => (s.graduated ? -1 : s.complete ? 2 : s.raisedUsdc / Math.max(1e-9, s.targetUsdc));
const activity = (s: SeriesSummary) => s.lastTradeAt ?? s.launchedAt;

/** listSeries is already ordered by latest activity (a trade or the launch). */
function view(list: SeriesSummary[], tab: Tab) {
  if (tab === "new") return [...list].sort((a, b) => b.launchedAt - a.launchedAt);
  if (tab === "graduating") return list.filter((s) => !s.graduated && (s.complete || s.raisedUsdc > 0)).sort((a, b) => progress(b) - progress(a) || activity(b) - activity(a));
  if (tab === "graduated") return list.filter((s) => s.graduated);
  return list;
}

/** The series closest to graduating; if nothing has raised anything, the most recently active one. */
function pickFeatured(list: SeriesSummary[]): { s: SeriesSummary; why: string } | null {
  const live = list.filter((s) => !s.graduated && (s.complete || s.raisedUsdc > 0)).sort((a, b) => progress(b) - progress(a) || activity(b) - activity(a));
  if (live[0]) return { s: live[0], why: live[0].complete ? "Graduating now" : "Closest to graduation" };
  if (list[0]) return { s: list[0], why: list[0].graduated ? "Latest to graduate" : "Latest launch" };
  return null;
}

/** Block time for ages and "3m ago" (a local fork's clock can be far from the server's); the server's when there's no chain. */
async function clock(chain: boolean) {
  const local = () => Math.floor(Date.now() / 1000);
  return chain ? chainNow().catch(local) : local();
}

const tabHref = (tab: Tab, q: string) => {
  const p = new URLSearchParams();
  if (tab !== "trending") p.set("tab", tab);
  if (q) p.set("q", q);
  const s = p.toString();
  return s ? `/series?${s}` : "/series";
};

export default async function SeriesBoard({ searchParams }: PageProps<"/series">) {
  const sp = await searchParams;
  // ?sort= is the old name of ?tab=.
  const raw = typeof sp.tab === "string" ? sp.tab : sp.sort === "graduating" ? "graduating" : typeof sp.sort === "string" ? sp.sort : "";
  const tab = (TABS.find((t) => t.key === raw)?.key ?? "trending") as Tab;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 40) : "";

  const lp = launchpad();
  const all = lp ? listSeries() : [];
  const now = await clock(lp !== null);
  const events = lp ? recentActivity(30) : [];
  const sparks = lp && all.length ? sparklines() : {};
  const names = new Map(all.map((s) => [s.id, s.name]));
  const needle = q.toLowerCase();
  const matches = (s: SeriesSummary) => !needle || [s.name, s.symbol, s.characterName].some((x) => x.toLowerCase().includes(needle));
  const list = view(all, tab).filter(matches);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, view(all, t.key).filter(matches).length])) as Record<Tab, number>;
  const featured = !q ? pickFeatured(all) : null;

  return (
    <>
      {lp && all.length > 0 && <AutoRefresh every={15_000} />}

      {/* ——— Masthead: kept quiet; the featured series is the loud part ——— */}
      <section className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h1 className="masthead text-[24vw] text-kapow sm:text-[clamp(88px,9vw,128px)]">Series</h1>
          <div className="max-w-[460px] md:pb-2">
            <p className="text-[14.5px] leading-relaxed text-soft">
              Back a character and steer its story. Each series mints a Character NFT with its own wallet and opens a coin on a USDC
              curve. Holders vote on which episode becomes canon.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/launch" className="slant h-11 px-6 text-[17px]">
                <IconPlus width={16} height={16} /> Launch a series · ${LAUNCH_PRICE}
              </Link>
              <Link href="/how#launchpad" className="text-[13px] text-soft underline decoration-rule underline-offset-4 hover:text-paper hover:decoration-kapow">
                How series work
              </Link>
            </div>
          </div>
        </div>
      </section>

      {!lp ? (
        <Offline />
      ) : all.length === 0 ? (
        <FirstSeries />
      ) : (
        <>
          {featured && (
            <section className="mx-auto mt-8 grid max-w-[1320px] gap-6 px-4 md:mt-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px]" aria-label="Featured series and live activity">
              <Featured s={featured.s} why={featured.why} parentName={names.get(featured.s.parentSeriesId)} />
              <div className="lg:relative">
                <div className="lg:absolute lg:inset-0">
                  <LiveTape events={events} now={now} />
                </div>
              </div>
            </section>
          )}

          {/* ——— The board ——— */}
          <section className="mx-auto max-w-[1320px] px-4 pt-10 md:px-8 md:pt-14" aria-labelledby="board-h">
            <h2 id="board-h" className="sr-only">All series</h2>
            <div className="flex flex-col gap-4 border-b border-rule md:flex-row md:items-end md:justify-between">
              <nav className="no-scrollbar -mx-4 flex gap-6 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="Filter series">
                {TABS.map((t) => {
                  const active = t.key === tab;
                  return (
                    <Link
                      key={t.key}
                      href={tabHref(t.key, q)}
                      scroll={false}
                      aria-current={active ? "page" : undefined}
                      className={`-mb-px flex shrink-0 items-baseline gap-1.5 border-b-4 pb-2.5 pt-1 font-display text-[16px] uppercase ${
                        active ? "border-kapow text-paper" : "border-transparent text-mute hover:text-paper"
                      }`}
                    >
                      {t.label}
                      <span className="font-mono text-[11px] text-mute">{counts[t.key]}</span>
                    </Link>
                  );
                })}
              </nav>
              <form action="/series" role="search" className="mb-3 flex items-center gap-2 border border-rule bg-stock px-3 focus-within:border-soft md:w-[300px]">
                <IconSearch width={16} height={16} className="shrink-0 text-mute" />
                <label htmlFor="series-q" className="sr-only">Search series by name or ticker</label>
                <input
                  id="series-q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder="Name or $TICKER"
                  autoComplete="off"
                  className="h-10 w-full min-w-0 bg-transparent text-[14px] text-paper placeholder:text-mute focus:outline-none"
                />
                {tab !== "trending" && <input type="hidden" name="tab" value={tab} />}
              </form>
            </div>

            {list.length === 0 ? (
              <NoMatches tab={tab} q={q} closest={pickFeatured(all)?.s ?? null} />
            ) : (
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 md:mt-8 lg:grid-cols-3 lg:gap-6">
                {list.map((s, i) => (
                  <li key={s.id}>
                    <SeriesCard s={s} priority={i < 3} spark={sparks[s.id]} parentName={names.get(s.parentSeriesId)} now={now} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-10 text-[12px] text-mute">{COIN_DISCLAIMER}</p>
          </section>
        </>
      )}
    </>
  );
}

/** The one big moment on the board: the series nearest its graduation, set like a cover. */
function Featured({ s, why, parentName }: { s: SeriesSummary; why: string; parentName?: string }) {
  const symbol = s.symbol.trim();
  return (
    <article aria-labelledby="featured-h" className="relative border border-rule bg-stock">
      <span className="tape -top-3 left-12 hidden rotate-[-4deg] md:block" aria-hidden />
      <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Link href={`/s/${s.id}`} className="relative block border-b border-rule md:border-b-0 md:border-r" tabIndex={-1} aria-hidden>
          <Sheet src={s.sheetUrl} name={s.characterName} priority caption sizes="(min-width: 1024px) 520px, 100vw" />
        </Link>
        <span className="absolute left-3 top-3 z-[1] -rotate-[1.5deg] border-2 border-ink bg-paper px-2.5 py-1.5 font-letter text-[13px] leading-none text-paper-ink shadow-[3px_3px_0_#000] md:left-5 md:top-5 md:text-[15px]">
          {why}
        </span>

        <div className="flex min-w-0 flex-col p-4 md:p-6">
          <div className="flex flex-wrap gap-1.5">
            {s.graduated ? <GraduatedBadge /> : s.demo && !MAINNET && <DemoBadge target={s.targetUsdc} />}
            {s.parentSeriesId > 0 && <RemixBadge of={parentName} />}
          </div>
          <h2 id="featured-h" className="masthead mt-2 break-words text-[clamp(44px,12vw,64px)] leading-[0.86] text-paper lg:text-[clamp(48px,4.4vw,72px)]">
            <Link href={`/s/${s.id}`} className="hover:text-kapow">{s.name}</Link>
          </h2>
          <p className="mt-2 text-[13.5px] text-soft">
            <span className="font-mono text-kapow">${symbol}</span> · starring <span className="text-paper">{s.characterName}</span>
          </p>
          <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 pt-5">
            <div>
              <dt className="text-[11.5px] text-mute">Price per coin</dt>
              <dd className="font-mono text-[20px] text-arb" title={coinPricePlain(s.priceUsdc)}>{coinPrice(s.priceUsdc)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-mute">Market cap</dt>
              <dd className="font-mono text-[20px] text-paper">{usdAmount(s.marketCapUsdc)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-mute">Holders</dt>
              <dd className="font-mono text-[20px] text-paper">{s.holders.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-mute">Canon episodes</dt>
              <dd className="font-mono text-[20px] text-paper">{s.episodes}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Raised → target, as big as the board gets */}
      <div className="grid items-end gap-x-6 gap-y-4 border-t border-rule p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:p-6">
        {s.graduated ? (
          <p className="text-[14px] leading-relaxed text-soft md:col-span-2">
            Raised <span className="font-mono text-paper">{usdAmount(s.raisedUsdc)}</span> and graduated into a locked Uniswap v4 pool, where it
            trades now.
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-2 md:block">
              <span className="masthead block text-[64px] leading-[0.8] text-arb md:text-[84px]">{progressLabel(s.raisedUsdc, s.targetUsdc)}</span>
              <span className="text-[12.5px] text-mute md:mt-1.5 md:block">{s.complete ? "curve complete" : "to graduation"}</span>
            </p>
            <div className="min-w-0">
              <RaisedBar raised={s.raisedUsdc} target={s.targetUsdc} size="lg" />
              <p className="mt-1 text-[12px] text-mute">At ${s.targetUsdc.toLocaleString("en-US")} raised the curve closes and becomes a Uniswap v4 pool.</p>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-3 md:col-start-3 md:justify-end">
          <Link href={`/s/${s.id}#trade`} className="slant slant-arb h-12 flex-1 px-6 text-[19px] md:flex-none">
            Trade ${symbol}
          </Link>
          <Link
            href={`/s/${s.id}#canon`}
            className="flex h-12 flex-1 items-center justify-center border-2 border-paper/80 px-5 font-display text-[17px] uppercase text-paper hover:bg-paper hover:text-ink md:flex-none"
          >
            {s.episodes > 0 ? `Read canon · ${plural(s.episodes, "ep", "eps")}` : "Read canon"}
          </Link>
        </div>
      </div>
    </article>
  );
}

function NoMatches({ tab, q, closest }: { tab: Tab; q: string; closest: SeriesSummary | null }) {
  const message = q
    ? `Nothing on the board matches “${q}”.`
    : tab === "graduated"
      ? "No series has graduated yet."
      : tab === "graduating"
        ? "No series has raised anything yet."
        : "Nothing here yet.";
  return (
    <div role="status" className="mt-8 flex flex-col gap-5 border border-dashed border-rule p-6 md:flex-row md:items-center md:justify-between md:p-8">
      <div>
        <p className="font-display text-[26px] uppercase leading-tight text-paper">{message}</p>
        <p className="mt-1.5 max-w-[56ch] text-[13.5px] leading-relaxed text-mute">
          {q ? (
            <>
              Try another name, or{" "}
              <Link href={tabHref(tab, "")} className="text-paper underline underline-offset-4">clear the search</Link>. If it doesn&rsquo;t exist yet,
              you can launch it.
            </>
          ) : closest && !closest.graduated ? (
            <>
              The closest is{" "}
              <Link href={`/s/${closest.id}`} className="text-paper underline decoration-kapow underline-offset-4">{closest.name}</Link> at{" "}
              {progressLabel(closest.raisedUsdc, closest.targetUsdc)} of its target.
            </>
          ) : (
            "Launch one and it shows up here."
          )}
        </p>
      </div>
      <Link href="/launch" className="slant h-11 shrink-0 self-start px-6 text-[17px] md:self-auto">
        <IconPlus width={16} height={16} /> Launch a series
      </Link>
    </div>
  );
}

function FirstSeries() {
  return (
    <section className="mx-auto mt-8 max-w-[1320px] px-4 md:mt-10 md:px-8">
      <Link
        href="/launch"
        className="group relative flex flex-col gap-6 border-2 border-dashed border-kapow/70 p-6 hover:border-kapow md:flex-row md:items-end md:justify-between md:p-10"
      >
        <p className="masthead text-[18vw] text-kapow md:text-[clamp(96px,10vw,150px)]">Series #1 is yours</p>
        <div className="md:max-w-[380px]">
          <p className="text-[15px] leading-relaxed text-soft">
            Nothing has launched on {KOMA.label} yet. Describe a character and pitch the story: for ${LAUNCH_PRICE} in USDC KOMA draws the
            character sheet, mints the Character NFT to you and opens its coin on the curve.
          </p>
          <span className="slant mt-5 h-11 px-6 text-[17px]">
            <IconPlus width={16} height={16} /> Launch the first series
          </span>
        </div>
      </Link>
    </section>
  );
}

function Offline() {
  return (
    <section className="mx-auto mt-8 max-w-[1320px] px-4 md:mt-10 md:px-8">
      <div role="status" className="border border-dashed border-rule px-6 py-14 text-center">
        <p className="font-display text-3xl uppercase text-paper">The launchpad is offline</p>
        <p className="mx-auto mt-2 max-w-[52ch] text-[14px] leading-relaxed text-mute">
          Its contracts aren&rsquo;t deployed on {KOMA.label} yet, so there are no series to back. Comics are unaffected. You can still read
          what a launch includes and get your character ready.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/launch" className="slant h-11 px-6 text-[17px]">See what a launch includes</Link>
          <Link href="/" className="inline-flex h-11 items-center border-2 border-paper/80 px-5 font-display text-[16px] uppercase hover:bg-paper hover:text-ink">
            Back to the catalog
          </Link>
        </div>
      </div>
    </section>
  );
}
