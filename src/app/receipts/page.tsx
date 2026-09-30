import Link from "next/link";
import type { Metadata } from "next";
import { allComics } from "@/lib/catalog";
import { ArbMark } from "@/components/icons";
import { ago, short } from "@/lib/format";
import { txUrl } from "@/lib/explorer";

export const metadata: Metadata = {
  title: "Receipts",
  description: "Every KOMA issue, the USDC paid for it over x402, and the Arbitrum transactions that settled and minted it.",
};

export const dynamic = "force-dynamic";

export default async function Receipts() {
  const rows = [...(await allComics())].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = rows.reduce((s, c) => s + Number(c.chain.paidUsdc), 0);
  const pages = rows.reduce((s, c) => s + c.pageCount, 0);

  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
      <h1 className="masthead text-[25vw] text-kapow md:text-[clamp(140px,15vw,216px)]">Receipts</h1>
      <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-soft">
        Each issue on KOMA is one HTTP 402 payment settled in USDC on Arbitrum, then one mint. This is the full ledger.
      </p>

      <dl className="mt-8 grid grid-cols-3 border-y border-rule">
        {[
          ["Issues minted", rows.length.toString()],
          ["USDC settled", total.toFixed(2)],
          ["Pages drawn", pages.toString()],
        ].map(([k, v]) => (
          <div key={k} className="border-l border-rule py-4 pl-4 first:border-l-0 first:pl-0">
            <dt className="text-[12px] text-mute">{k}</dt>
            <dd className="mt-1 font-display text-[34px] leading-none text-paper md:text-[48px]">{v}</dd>
          </div>
        ))}
      </dl>

      {rows.length === 0 && (
        <p className="mt-10 border border-dashed border-rule px-6 py-12 text-center text-[15px] text-mute">
          The ledger is empty. The first payment lands here the moment someone makes an issue.
        </p>
      )}

      {/* Phone: stacked slips. Desktop: a ledger table. */}
      <ul className="mt-6 divide-y divide-rule md:hidden">
        {rows.map((c) => (
          <li key={c.id} className="py-4">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/c/${c.id}`} className="font-display text-[20px] uppercase leading-tight text-paper">{c.title}</Link>
              <span className="font-mono text-[13px] text-arb">{c.chain.paidUsdc} USDC</span>
            </div>
            <p className="mt-1 text-[12.5px] text-mute">
              {c.creator.name} · {ago(c.createdAt)} · token #{c.chain.tokenId}
            </p>
            <a href={txUrl(c.chain.paymentTx)} className="mt-1 flex items-center gap-1.5 font-mono text-[11.5px] text-arb">
              <ArbMark width={12} height={12} /> {short(c.chain.paymentTx, 10, 8)}
            </a>
          </li>
        ))}
      </ul>

      <table className={`mt-8 hidden w-full text-left text-[13.5px] ${rows.length ? "md:table" : ""}`}>
        <thead>
          <tr className="border-b border-rule text-[12px] text-mute">
            <th className="py-3 font-medium">Issue</th>
            <th className="py-3 font-medium">Maker</th>
            <th className="py-3 font-medium">Pages</th>
            <th className="py-3 text-right font-medium">Paid</th>
            <th className="py-3 pl-8 font-medium">Payment tx</th>
            <th className="py-3 font-medium">Token</th>
            <th className="py-3 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-rule/60 hover:bg-stock">
              <td className="py-3.5">
                <Link href={`/c/${c.id}`} className="font-display text-[17px] uppercase tracking-wide text-paper hover:text-kapow">
                  {c.title}
                </Link>
              </td>
              <td className="py-3.5 text-soft">{c.creator.name}</td>
              <td className="py-3.5 text-soft">{c.pageCount}</td>
              <td className="py-3.5 text-right font-mono text-arb">{c.chain.paidUsdc} USDC</td>
              <td className="py-3.5 pl-8 font-mono text-[12.5px] text-soft">
                <a href={txUrl(c.chain.paymentTx)} className="text-arb hover:underline">
                  {short(c.chain.paymentTx, 10, 8)}
                </a>
              </td>
              <td className="py-3.5 font-mono text-[12.5px] text-soft">#{c.chain.tokenId}</td>
              <td className="py-3.5 text-right text-mute">{ago(c.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
