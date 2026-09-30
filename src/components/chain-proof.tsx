"use client";

import { useState } from "react";
import type { ChainRecord } from "@/lib/types";
import { short } from "@/lib/format";
import { addressUrl, isExternal, txUrl } from "@/lib/explorer";
import { NETWORKS } from "@/lib/network";
import { copyText } from "@/lib/clipboard";
import { ArbMark, IconCheck, IconCopy, IconExternal } from "./icons";

function Row({ label, value, href, mono = true }: { label: string; value: string; href?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 border-t border-arb/15 py-2.5 first:border-t-0">
      <dt className="w-[110px] shrink-0 text-[12.5px] text-mute">{label}</dt>
      <dd className={`min-w-0 flex-1 truncate text-[13px] text-paper ${mono ? "font-mono" : ""}`} title={value}>
        {mono && value.startsWith("0x") ? short(value, 10, 6) : value}
      </dd>
      {mono && (
        <button
          onClick={async () => {
            if (!(await copyText(value))) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          aria-label={`Copy ${label}`}
          className="text-mute hover:text-arb"
        >
          {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
        </button>
      )}
      {href && (
        <a href={href} target={isExternal ? "_blank" : undefined} rel="noreferrer" aria-label={`View ${label} on-chain`} className="text-mute hover:text-arb">
          <IconExternal width={15} height={15} />
        </a>
      )}
    </div>
  );
}

/** Where the issue lives on-chain. Blue is reserved for this card and receipts. */
export function ChainProof({ chain }: { chain: ChainRecord }) {
  return (
    <section aria-labelledby="onchain" className="border border-arb/30 bg-[#06111a]">
      <header className="flex items-center justify-between gap-3 border-b border-arb/20 px-4 py-3">
        <h2 id="onchain" className="flex items-center gap-2 font-display text-[17px] uppercase tracking-wide text-arb">
          <ArbMark /> On Arbitrum
        </h2>
        <a href={`/api/tokens/${chain.tokenId}`} className="text-[12px] text-soft hover:text-arb">Token #{chain.tokenId}</a>
      </header>
      <dl className="px-4 py-1">
        <Row label="Network" value={NETWORKS[chain.network].label} mono={false} />
        <Row label="Paid with x402" value={`${chain.paidUsdc} USDC`} mono={false} />
        <Row label="Payment tx" value={chain.paymentTx} href={txUrl(chain.paymentTx)} />
        <Row label="Mint tx" value={chain.mintTx} href={txUrl(chain.mintTx)} />
        <Row label="Contract" value={chain.contract} href={addressUrl(chain.contract) ?? undefined} />
        <Row label="Content hash" value={chain.contentHash} />
      </dl>
    </section>
  );
}
