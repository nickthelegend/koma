import type { Metadata } from "next";
import Link from "next/link";
import { ArbMark } from "@/components/icons";
import { FEE_SPLIT, GASLESS_MIN_USDC, GRADUATION_FEE_PCT, KOMA, LAUNCH_PRICE, TRADE_FEE_PCT } from "@/lib/network";
import { compact } from "@/lib/format";
import { CANON_THRESHOLD, DEMO_TARGET_USDC, GRADUATION_TARGET_USDC, TOTAL_SUPPLY } from "@/lib/launchpad/abi";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { COIN_NOTE, MAINNET } from "@/components/launchpad/network-note";

const BASE = process.env.KOMA_PUBLIC_URL || "http://localhost:4310";

export const metadata: Metadata = {
  title: "How payment works",
  description: "KOMA sells comics over HTTP 402. One USDC signature on Arbitrum, settled by a facilitator, minted to you.",
};

const STEPS = [
  { t: "You ask for a comic", d: "The studio (or any script or AI agent) sends your story to POST /api/comics." },
  { t: "The server quotes a price", d: "It answers 402 Payment Required with the amount, USDC on Arbitrum, and where it goes." },
  { t: "Your wallet signs once", d: "A USDC transfer authorization (EIP-3009) for exactly that amount. Signing costs no gas." },
  { t: "The request is sent again, signed", d: "The same call, now carrying the signature in its PAYMENT-SIGNATURE header." },
  { t: "The facilitator settles it", d: "It checks the signature and submits the transfer on Arbitrum, paying the gas itself." },
  { t: "Your issue is drawn and minted", d: "Script, panels and lettering are generated; a hash of the finished issue is minted to your wallet." },
];

/** The launchpad, step by step. Numbers come from the shared constants; the engine line says what this network runs. */
function launchpadSteps(stylus: boolean) {
  return [
    {
      t: "A series starts with a character",
      d: `You describe a character and pitch the story, and pay $${LAUNCH_PRICE} over x402. KOMA draws a character sheet and launches the series in one transaction.`,
    },
    {
      t: "The character gets its own wallet",
      d: "It's minted to you as a Character NFT, and the NFT owns a wallet of its own (ERC-6551). Owning the character means owning that wallet.",
    },
    {
      t: "Its coin sits on a USDC curve",
      d: `${compact(TOTAL_SUPPLY)} coins: 95% are sold by a bonding curve that raises the price as people buy and lowers it as they sell; 5% go to the creator, released over 30 days. ${
        stylus
          ? "The curve's math runs in an Arbitrum Stylus contract written in Rust."
          : "This deployment runs the curve's math as the Solidity reference; KOMA's public deployments run it in an Arbitrum Stylus contract written in Rust."
      }`,
    },
    {
      t: "Trading costs no gas",
      d: `You sign a USDC authorization (to buy) or a permit (to sell) and KOMA's relayer sends it, for trades of $${GASLESS_MIN_USDC} or more. The signature fixes the amount, the minimum you'll accept and a deadline, so the relayer can't change any of them.`,
    },
    {
      t: "Holders decide what's canon",
      d: `Anyone holding ${CANON_THRESHOLD.toLocaleString("en-US")} coins, or the character's owner, can propose the next episode by making a comic in the studio. Holders vote for free with a signature, weighted by what they held when the episode opened. The winner is written on-chain; the rest become alternate universes.`,
    },
    {
      t: "Fees flow to characters, up the remix tree",
      d: `Each trade pays ${TRADE_FEE_PCT}%: ${FEE_SPLIT.character}% to the character's wallet, ${FEE_SPLIT.remix}% to the series it remixed (and theirs, halving each step), ${FEE_SPLIT.treasury}% to KOMA's treasury. Holders don't receive fees.`,
    },
    {
      t: "Graduation into Uniswap v4",
      d: `When a curve raises its target (${GRADUATION_TARGET_USDC.toLocaleString("en-US")} USDC${MAINNET ? "" : `, or ${DEMO_TARGET_USDC} for a demo series`}) it closes, and KOMA takes ${GRADUATION_FEE_PCT}% of the USDC raised, and the rest plus the remaining coins become a Uniswap v4 pool at the final price. The liquidity is locked for good.`,
    },
  ];
}

const CURL = `$ curl -i -X POST ${BASE}/api/comics \\
    -H 'content-type: application/json' \\
    -d '{"prompt":"a kaiju on its lunch break","pages":2,"style":"pop-art"}'

HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi…   (base64 JSON, decoded below)
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "${KOMA.caip}",
    "asset": "${KOMA.usdc}",
    "amount": "200000",
    "payTo": "0x…",
    "extra": { "name": "USD Coin", "version": "2" }
  }]
}`;

const AGENT = `import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const pay = wrapFetchWithPayment(fetch,
  new x402Client().register("eip155:*", new ExactEvmScheme(privateKeyToAccount(KEY))));

const res = await pay("${BASE}/api/comics", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "two rival racers share one car", pages: 1 }),
});
const { jobId } = await res.json();   // then poll /api/jobs/{jobId}`;

export default function How() {
  const LAUNCHPAD = launchpadSteps(launchpad()?.engine === "stylus");
  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-6 md:px-8 md:pt-10">
      <h1 className="masthead text-[19vw] text-kapow md:text-[clamp(110px,12vw,176px)]">Pay per issue</h1>
      <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-soft">
        No accounts, no credits, no subscription. KOMA uses x402, the HTTP status code the web reserved for payments decades ago, to
        charge a few cents of USDC on Arbitrum for each comic, from a person or an AI agent alike.
      </p>

      <section id="x402" className="mt-14 scroll-mt-24">
        <h2 className="font-display text-[28px] uppercase tracking-wide text-paper">What happens when you press Pay</h2>
        <ol className="mt-6 grid gap-px bg-rule md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.t} className="bg-ink p-5 md:p-6">
              <span className="font-display text-[44px] leading-none text-kapow">{i + 1}</span>
              <p className="mt-3 text-[15.5px] font-semibold text-paper">{s.t}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-[28px] uppercase tracking-wide text-paper">Call it from code</h2>
        <p className="mt-2 max-w-[60ch] text-[14.5px] text-mute">
          Any x402 client can buy a comic. Agents can pay with a wallet and get back a finished issue, no API key needed.
        </p>
        <pre className="mt-5 overflow-x-auto border border-rule bg-stock p-4 font-mono text-[12.5px] leading-relaxed text-soft">
          <code>{CURL}</code>
        </pre>
        <p className="mt-6 text-[14.5px] text-mute">From an agent, with any viem account holding USDC:</p>
        <pre className="mt-3 overflow-x-auto border border-rule bg-stock p-4 font-mono text-[12.5px] leading-relaxed text-soft">
          <code>{AGENT}</code>
        </pre>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-2">
        <div id="facilitator" className="scroll-mt-24 border border-arb/30 bg-[#06111a] p-5">
          <h2 className="flex items-center gap-2 font-display text-[22px] uppercase tracking-wide text-arb">
            <ArbMark /> Facilitator
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-soft">
            KOMA runs its own x402 facilitator for Arbitrum. It exposes the standard /api/facilitator/verify, /settle and
            /supported endpoints, so other apps on Arbitrum can use it to take USDC payments too.
          </p>
        </div>
        <div id="contract" className="scroll-mt-24 border border-arb/30 bg-[#06111a] p-5">
          <h2 className="flex items-center gap-2 font-display text-[22px] uppercase tracking-wide text-arb">
            <ArbMark /> Comic contract
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-soft">
            Each issue is an ERC-721 token that stores the hash of its pages and the payment that bought it. The metadata points
            back to the readable issue on KOMA, so the token and the comic can always be matched.
          </p>
        </div>
      </section>

      <section id="launchpad" className="mt-16 scroll-mt-24" aria-labelledby="launchpad-h">
        <h2 id="launchpad-h" className="masthead text-[16vw] text-kapow md:text-[clamp(84px,9vw,128px)]">The launchpad</h2>
        <p className="mt-4 max-w-[60ch] text-[15.5px] leading-relaxed text-soft">
          Series are comics that keep going. Each one is a character with a coin, and the people holding that coin choose which
          episodes become the story. It all runs on {KOMA.label}
          {MAINNET ? "." : "; here the coins are testnet collectibles."} {COIN_NOTE}
        </p>
        <ol className="mt-8 grid gap-px bg-rule md:grid-cols-2">
          {LAUNCHPAD.map((s, i) => (
            <li key={s.t} className={`bg-ink p-5 md:p-6 ${i === LAUNCHPAD.length - 1 ? "md:col-span-2" : ""}`}>
              <span className="font-display text-[44px] leading-none text-arb">{i + 1}</span>
              <p className="mt-3 text-[15.5px] font-semibold text-paper">{s.t}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/series" className="flex h-12 items-center border-2 border-paper/80 px-5 font-display text-[18px] uppercase text-paper hover:bg-paper hover:text-ink">
            Browse series
          </Link>
          <Link href="/launch" className="slant h-12 px-7 text-[20px]">Launch a series</Link>
        </div>
      </section>

      <div className="mt-14">
        <Link href="/create" className="slant h-12 px-7 text-[20px]">Make a comic</Link>
      </div>
    </div>
  );
}
