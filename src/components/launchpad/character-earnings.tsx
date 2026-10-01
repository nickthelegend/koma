"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { formatUnits, type Hex } from "viem";
import { usdcAbi } from "@/lib/launchpad/abi";
import { landed, withdrawCharacterUsdc } from "@/lib/launchpad/client";
import type { Addr } from "@/lib/launchpad/types";
import { txUrl } from "@/lib/explorer";
import { short, usdAmount } from "@/lib/format";
import { KOMA } from "@/lib/network";
import { useWallet, walletErrorMessage } from "../wallet";

type Phase = { step: "idle" | "signing" | "confirming" | "done" | "error"; tx?: Hex; message?: string };

/**
 * The character's own wallet (ERC-6551): what it holds, what it has earned,
 * and, for the Character NFT's owner, a way to move the USDC out.
 */
export function CharacterEarnings({
  account,
  owner,
  characterName,
  characterId,
  earnedUsdc,
}: {
  account: Addr;
  owner: Addr | null;
  characterName: string;
  characterId: number;
  earnedUsdc: number;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const me = wallet.address ?? undefined;
  const isOwner = Boolean(me && owner && owner.toLowerCase() === me.toLowerCase());

  const bal = useReadContract({
    address: KOMA.usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [account],
    chainId: KOMA.chain.id,
    query: { refetchInterval: 15_000 },
  });
  const eth = useBalance({ address: me, chainId: KOMA.chain.id, query: { enabled: isOwner, refetchInterval: 30_000 } });
  const raw = bal.data ?? null;
  const usdc = raw === null ? null : Number(formatUnits(raw, 6));
  const hasGas = (eth.data?.value ?? BigInt(0)) > BigInt(0);
  const busy = phase.step === "signing" || phase.step === "confirming";

  async function withdraw() {
    if (!raw || raw === BigInt(0)) return;
    setPhase({ step: "signing" });
    try {
      const w = await wallet.walletClient();
      const tx = await withdrawCharacterUsdc(w, { account, amount: raw });
      setPhase({ step: "confirming", tx });
      await landed(tx);
      setPhase({ step: "done", tx });
      void bal.refetch();
      wallet.refreshBalance();
      router.refresh();
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? "";
      setPhase((p) => ({
        step: "error",
        tx: p.tx,
        message: /reject|denied/i.test(msg)
          ? walletErrorMessage(e)
          : /NotAuthorized|0xea8e4eb5/i.test(msg)
            ? "Only the Character NFT's current owner can move this money, and this wallet isn't it."
            : msg.length > 200
              ? `${msg.slice(0, 200)}…`
              : msg,
      }));
    }
  }

  return (
    <section id="character-wallet" aria-labelledby="cw-h" className="scroll-mt-24 border border-arb/30 bg-[#06111a]">
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-8 md:p-6">
        <div className="min-w-0">
          <h2 id="cw-h" className="font-display text-[24px] uppercase leading-none text-paper">
            {characterName}&rsquo;s wallet
          </h2>
          <p className="mt-1.5 text-[12.5px] text-mute">
            ERC-6551 account of Character NFT #{characterId} · <span className="font-mono">{short(account)}</span>
          </p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[34px] leading-none text-arb">{usdc === null ? "…" : usdAmount(usdc)}</span>
            <span className="text-[13px] text-soft">USDC in the wallet now</span>
          </p>
          <p className="mt-2 text-[12.5px] text-mute">
            Earned from trading fees since launch: <span className="font-mono text-soft">{usdAmount(earnedUsdc)}</span>
          </p>
        </div>

        <div className="md:w-[300px]">
          {isOwner ? (
            <>
              <button
                onClick={withdraw}
                disabled={busy || !hasGas || !raw || raw === BigInt(0)}
                className="slant slant-arb w-full py-3 text-[18px]"
              >
                {phase.step === "signing" ? "Confirm in your wallet…" : phase.step === "confirming" ? "Landing on Arbitrum…" : "Withdraw to my wallet"}
              </button>
              <p className="mt-2.5 text-[12px] leading-snug text-mute">
                {!raw || raw === BigInt(0)
                  ? "Nothing to withdraw yet. Fees land here as people trade."
                  : !hasGas
                    ? `Your wallet has no ETH on ${KOMA.label} to pay gas. Add a little, then withdraw.`
                    : "You own the character, so you can move its USDC. It's a normal transaction from your wallet; you pay the gas in ETH."}
              </p>
            </>
          ) : (
            <p className="border-l-2 border-arb/50 pl-3 text-[12.5px] leading-relaxed text-soft">
              Only the holder of the Character NFT can withdraw
              {owner ? (
                <>
                  , currently <span className="font-mono text-paper">{short(owner)}</span>
                </>
              ) : null}
              .{" "}
              {!me && (
                <button onClick={wallet.connect} className="text-paper underline decoration-arb underline-offset-4 hover:text-arb">
                  Own it? Connect your wallet.
                </button>
              )}
            </p>
          )}
          {phase.step !== "idle" && phase.step !== "signing" && (
            <div
              role={phase.step === "error" ? "alert" : "status"}
              className={`mt-3 border px-3 py-2 text-[12.5px] leading-snug ${phase.step === "error" ? "border-kapow/60 bg-kapow/10 text-paper" : "border-arb/30 text-soft"}`}
            >
              {phase.step === "error" ? phase.message : phase.step === "done" ? "Withdrawn. The USDC is in your wallet." : "Waiting for the block…"}
              {phase.tx && (
                <a href={txUrl(phase.tx)} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-arb hover:underline">
                  tx {short(phase.tx, 10, 6)}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
