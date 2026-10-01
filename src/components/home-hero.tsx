import Image from "next/image";
import Link from "next/link";
import type { Comic } from "@/lib/types";
import { PRICE_PER_PAGE } from "@/lib/network";
import { IconPen } from "./icons";

// The home page opens on a comic book cover. Old covers carried a price box
// (10¢) and cover lines selling what's inside; KOMA really costs 10¢ a page,
// so the cover is the pitch. The art is the most-read issue's opening panel.

const COVER_LINES = [
  { href: "/launch", text: "Launch a character. It gets its own wallet and earns from every trade of its coin." },
  { href: "/series", text: "Hold the coin and vote on what happens next. The winning episode becomes canon." },
  { href: "/series", text: "Remix any series. Part of every fee flows back to the original." },
];
const TILTS = ["-rotate-[1.4deg]", "rotate-[0.9deg]", "-rotate-[0.6deg]"];

export function HomeHero({ featured, issues, network }: { featured: Comic | null; issues: number; network: string }) {
  const wide = featured?.pages?.[0]?.panels[0]?.img || featured?.cover;
  const cents = Math.round(PRICE_PER_PAGE * 100);
  const month = new Date().toLocaleString("en-US", { month: "short", year: "numeric" });

  return (
    <section aria-labelledby="hero-title" className="mx-auto max-w-[1320px] px-4 pt-5 md:px-8 md:pt-8">
      <div className="relative bg-ink shadow-[0_30px_60px_-30px_rgba(0,0,0,1)] ring-1 ring-rule">
        <span className="tape -top-3 left-10 hidden rotate-[-5deg] md:block" aria-hidden />

        {/* Masthead band: price box, title, issue number */}
        <div className="flex items-stretch gap-3 border-b-4 border-ink bg-kapow p-2.5 md:gap-5 md:p-3.5">
          <div className="flex shrink-0 flex-col items-center justify-center border-[3px] border-ink bg-paper px-2 py-1 text-paper-ink md:px-3.5">
            <span className="font-display text-[34px] leading-none md:text-[52px]">{cents}¢</span>
            <span className="mt-0.5 font-letter text-[11px] leading-none md:text-[13px]">a page</span>
          </div>
          <p className="masthead self-center text-[19vw] leading-[0.78] text-ink md:text-[clamp(96px,11vw,168px)]" aria-hidden>
            Koma
          </p>
          <div className="ml-auto flex flex-col items-end justify-between text-right text-ink">
            <span className="font-display text-[18px] leading-none md:text-[30px]">No. {issues}</span>
            <span className="hidden text-[12px] font-semibold md:block">{month}</span>
            <span className="hidden items-center gap-1.5 whitespace-nowrap bg-ink px-2 py-1 text-[11px] font-semibold text-arb sm:flex md:text-[12px]">
              <span className="h-1.5 w-1.5 rounded-full bg-arb" aria-hidden />
              {network}
            </span>
          </div>
        </div>

        {/* Cover art with the headline set on it */}
        <div className="relative isolate">
          <div className="relative aspect-[16/10] w-full overflow-hidden md:aspect-auto md:h-[clamp(440px,calc(100dvh-300px),640px)]">
            {wide ? (
              <Image
                src={wide}
                alt={featured?.pages?.[0]?.panels[0]?.alt ?? `Cover art of ${featured?.title ?? "a KOMA comic"}`}
                fill
                priority
                sizes="(min-width: 1320px) 1320px, 100vw"
                className="object-cover"
              />
            ) : (
              <div className="halftone absolute inset-0 bg-kapow-deep text-black/30" aria-hidden />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent md:bg-gradient-to-r md:from-black md:via-black/60 md:to-black/0" aria-hidden />
          </div>

          <div className="relative -mt-10 px-5 pb-6 md:absolute md:inset-y-0 md:left-0 md:mt-0 md:flex md:max-w-[640px] md:flex-col md:justify-end md:p-10">
            <h1
              id="hero-title"
              className="masthead text-[16vw] text-paper [text-shadow:4px_4px_0_#000] md:text-[clamp(84px,8.4vw,136px)] md:[text-shadow:5px_5px_0_#000]"
            >
              Write it.
              <br />
              We draw it.
            </h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-soft md:text-[16px]">
              Describe a story and KOMA writes, draws and letters it in about a minute. Pay {cents}¢ a page in USDC, and the issue is
              minted to your wallet on Arbitrum.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/create" className="slant h-12 px-7 text-[20px]">
                <IconPen width={18} height={18} />
                Make a comic
              </Link>
              <Link
                href="/launch"
                className="flex h-12 items-center border-2 border-paper px-5 font-display text-[18px] uppercase text-paper hover:bg-paper hover:text-ink"
              >
                Launch a series
              </Link>
            </div>
          </div>

          {/* Cover lines: what's inside, lettered like caption boxes (desktop: on the art) */}
          <ul className="absolute right-8 top-8 hidden w-[300px] flex-col gap-4 lg:flex xl:w-[340px]">
            {COVER_LINES.map((c, i) => (
              <li key={c.text} className={TILTS[i]}>
                <Link
                  href={c.href}
                  className="block border-2 border-ink bg-paper px-4 py-3 font-letter text-[15px] leading-snug text-paper-ink shadow-[4px_4px_0_#000] hover:bg-bam xl:text-[16px]"
                >
                  {c.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Phones and tablets: the cover lines under the art */}
        <ul className="grid gap-3 border-t border-rule p-4 sm:grid-cols-3 lg:hidden">
          {COVER_LINES.map((c) => (
            <li key={c.text}>
              <Link href={c.href} className="block h-full border-2 border-ink bg-paper px-3.5 py-3 font-letter text-[14px] leading-snug text-paper-ink">
                {c.text}
              </Link>
            </li>
          ))}
        </ul>

        {featured && (
          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-rule px-4 py-3 text-[12.5px] text-mute md:px-6">
            <span>
              Cover art from <span className="text-soft">{featured.title}</span>, {featured.reads > 0 ? "the most-read issue on KOMA" : "the latest issue on KOMA"}.
            </span>
            <span className="flex gap-4">
              <Link href={`/c/${featured.id}/read`} className="text-paper underline decoration-kapow underline-offset-4 hover:text-kapow">
                Read it free
              </Link>
              <Link href={`/create?remix=${featured.id}`} className="text-paper underline decoration-rule underline-offset-4 hover:text-kapow">
                Remix it
              </Link>
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
