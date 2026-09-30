import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { decodeEventLog, erc20Abi, formatUnits, type Log } from "viem";
import { komaAbi } from "@/lib/koma-abi";
import { KOMA, USDC_DECIMALS } from "@/lib/network";
import { short } from "@/lib/format";
import { config, publicClient } from "@/lib/server/config";
import { getIssueByTx } from "@/lib/server/store";
import { ArbMark, IconCheck } from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/tx/[hash]">): Promise<Metadata> {
  return { title: `Transaction ${short((await params).hash, 8, 6)}` };
}

type Decoded = { label: string; lines: [string, string][] };

function decode(log: Log): Decoded | null {
  const addr = log.address.toLowerCase();
  if (addr === KOMA.usdc.toLowerCase()) {
    try {
      const e = decodeEventLog({ abi: erc20Abi, ...log });
      if (e.eventName === "Transfer") {
        return {
          label: "USDC transfer",
          lines: [
            ["From", e.args.from],
            ["To", e.args.to],
            ["Amount", `${Number(formatUnits(e.args.value, USDC_DECIMALS)).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`],
          ],
        };
      }
    } catch {
      /* AuthorizationUsed and other USDC events */
    }
    return { label: "USDC authorization used", lines: [["Nonce", (log.topics[2] ?? "") as string]] };
  }
  if (config.contract && addr === config.contract.toLowerCase()) {
    try {
      const e = decodeEventLog({ abi: komaAbi, ...log });
      if (e.eventName === "IssueMinted") {
        return {
          label: "Issue minted",
          lines: [
            ["Token", `#${e.args.tokenId}`],
            ["To", e.args.to],
            ["Payment tx", e.args.paymentTx],
            ["Content hash", e.args.contentHash],
            ["Pages", String(e.args.pages)],
            ["Remix of", e.args.remixOf ? `#${e.args.remixOf}` : "Original"],
          ],
        };
      }
    } catch {
      /* ERC-721 Transfer */
    }
    return { label: "KOMA token transfer (ERC-721)", lines: [["Token", `#${BigInt(log.topics[3] ?? "0x0")}`]] };
  }
  return null;
}

/** A plain transaction receipt, read straight from the chain KOMA settles on. */
export default async function TxPage({ params }: PageProps<"/tx/[hash]">) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) notFound();
  const h = hash as `0x${string}`;
  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: h }).catch(() => null),
    publicClient.getTransactionReceipt({ hash: h }).catch(() => null),
  ]);
  if (!tx || !receipt) notFound();
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const events = receipt.logs.map(decode).filter(Boolean) as Decoded[];
  const issue = await getIssueByTx(hash);
  let onchainHash: string | null = null;
  if (issue && config.contract) {
    const rec = await publicClient.readContract({ address: config.contract, abi: komaAbi, functionName: "issue", args: [BigInt(issue.chain.tokenId)] });
    onchainHash = rec.contentHash;
  }
  const ok = receipt.status === "success";

  return (
    <div className="mx-auto max-w-[900px] px-4 pt-6 md:px-8 md:pt-10">
      <p className="flex items-center gap-2 text-[13px] text-soft">
        <ArbMark /> {KOMA.label} · chain {KOMA.chain.id}
      </p>
      <h1 className="masthead mt-2 text-[15vw] text-kapow md:text-[110px]">Transaction</h1>
      <p className="mt-3 break-all font-mono text-[13px] text-soft">{hash}</p>

      <dl className="mt-8 border border-arb/30 bg-[#06111a] px-4 py-1 text-[13.5px]">
        {[
          ["Status", ok ? "Success" : "Reverted"],
          ["Block", `${receipt.blockNumber} · ${new Date(Number(block.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`],
          ["From", tx.from],
          ["To", tx.to ?? "Contract creation"],
          ["Gas used", receipt.gasUsed.toString()],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-4 border-t border-arb/15 py-2.5 first:border-t-0">
            <dt className="w-[110px] shrink-0 text-mute">{k}</dt>
            <dd className={`min-w-0 break-all font-mono ${k === "Status" ? (ok ? "text-[#3ddc84]" : "text-[#ff3b3b]") : "text-paper"}`}>{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 font-display text-[22px] uppercase tracking-wide text-paper">Events</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-[14px] text-mute">No USDC or KOMA events in this transaction.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {events.map((e, i) => (
            <li key={i} className="border border-rule bg-stock p-4">
              <p className="font-display text-[16px] uppercase tracking-wide text-arb">{e.label}</p>
              <dl className="mt-2 text-[13px]">
                {e.lines.map(([k, v]) => (
                  <div key={k} className="flex gap-4 py-1">
                    <dt className="w-[110px] shrink-0 text-mute">{k}</dt>
                    <dd className="min-w-0 break-all font-mono text-paper">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      {issue && (
        <section className="mt-10 border border-rule p-4">
          <p className="text-[13px] text-mute">This transaction belongs to</p>
          <Link href={`/c/${issue.id}`} className="font-display text-[26px] uppercase text-paper hover:text-kapow">
            {issue.title} · #{issue.chain.tokenId}
          </Link>
          {onchainHash && (
            <p className={`mt-2 flex items-center gap-1.5 text-[13px] ${onchainHash === issue.chain.contentHash ? "text-[#3ddc84]" : "text-[#ff3b3b]"}`}>
              {onchainHash === issue.chain.contentHash ? (
                <>
                  <IconCheck width={14} height={14} /> On-chain content hash matches the pages KOMA serves.
                </>
              ) : (
                "On-chain content hash does not match the stored issue."
              )}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
