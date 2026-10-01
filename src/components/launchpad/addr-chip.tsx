"use client";

import { useState } from "react";
import { short } from "@/lib/format";
import { addressUrl, isExternal } from "@/lib/explorer";
import { copyText } from "@/lib/clipboard";
import { IconCheck, IconCopy } from "../icons";

/** A labelled contract address: links to the explorer when there is one, copies either way. */
export function AddrChip({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  const href = addressUrl(address);
  return (
    <span className="inline-flex max-w-full items-stretch border border-arb/30 text-[12px]">
      <span className="flex items-center px-2 py-1 text-mute">{label}</span>
      {href ? (
        <a href={href} target={isExternal ? "_blank" : undefined} rel="noreferrer" className="flex items-center border-l border-arb/30 px-2 py-1 font-mono text-arb hover:bg-arb hover:text-ink" title={address}>
          {short(address)}
        </a>
      ) : (
        <span className="flex items-center border-l border-arb/30 px-2 py-1 font-mono text-arb" title={address}>{short(address)}</span>
      )}
      <button
        type="button"
        onClick={async () => {
          if (!(await copyText(address))) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        aria-label={`Copy ${label} address`}
        className="grid w-7 place-items-center border-l border-arb/30 text-mute hover:text-arb"
      >
        {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
      </button>
    </span>
  );
}
