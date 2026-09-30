"use client";

import { useState } from "react";
import { short } from "@/lib/format";
import { addressUrl, isExternal } from "@/lib/explorer";
import { copyText } from "@/lib/clipboard";
import { ArbMark, IconCheck, IconCopy, IconExternal } from "../icons";

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const href = value.startsWith("0x") && value.length === 42 ? addressUrl(value) : null;
  return (
    <div className="flex items-center gap-3 border-t border-arb/15 py-2.5 first:border-t-0">
      <dt className="w-[122px] shrink-0 text-[12.5px] leading-tight text-mute">
        {label}
        {note && <span className="block text-[11px] text-mute/80">{note}</span>}
      </dt>
      <dd className="min-w-0 flex-1 truncate font-mono text-[13px] text-paper" title={value}>
        {value.startsWith("0x") ? short(value, 8, 6) : value}
      </dd>
      {value.startsWith("0x") && (
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
        <a href={href} target={isExternal ? "_blank" : undefined} rel="noreferrer" aria-label={`View ${label} on the explorer`} className="text-mute hover:text-arb">
          <IconExternal width={15} height={15} />
        </a>
      )}
    </div>
  );
}

/** The series' contracts, in the on-chain card style of ChainProof. */
export function AddressList({ title, rows }: { title: string; rows: { label: string; value: string; note?: string }[] }) {
  return (
    <section aria-label={title} className="border border-arb/30 bg-[#06111a]">
      <header className="border-b border-arb/20 px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-[17px] uppercase tracking-wide text-arb">
          <ArbMark /> {title}
        </h2>
      </header>
      <dl className="px-4 py-1">
        {rows.map((r) => <Row key={r.label} {...r} />)}
      </dl>
    </section>
  );
}
