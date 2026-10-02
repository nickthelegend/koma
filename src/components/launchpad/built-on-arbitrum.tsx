import type { Addr, LaunchpadAddresses } from "@/lib/launchpad/types";
import { FEE_SPLIT, GASLESS_MIN_USDC, GRADUATION_FEE_PCT, KOMA, LAUNCH_PRICE, TRADE_FEE_PCT } from "@/lib/network";
import { ArbMark } from "../icons";
import { AddrChip } from "./addr-chip";

type Row = { title: string; text: React.ReactNode; chips: { label: string; address?: Addr | null }[] };

/**
 * What runs where. Plain statements about this deployment, with the contract
 * addresses to check them against. `character` narrows the wallet row to one
 * series' character.
 */
export function BuiltOnArbitrum({
  lp,
  facilitator,
  character,
  id = "built-on-arbitrum",
}: {
  lp: LaunchpadAddresses | null;
  facilitator: Addr | null;
  character?: { name: string; account: Addr };
  id?: string;
}) {
  const stylus = lp?.engine === "stylus";
  const rows: Row[] = [
    {
      title: stylus ? "Curve math and fee split: Stylus" : "Curve math and fee split",
      text: stylus ? (
        <>
          Every quote and trade prices through a Rust contract compiled to WebAssembly and run by Arbitrum Stylus. A second Stylus
          contract splits each {TRADE_FEE_PCT}% fee in the same transaction: {FEE_SPLIT.character}% to the character, {FEE_SPLIT.remix}% up the
          remix tree, {FEE_SPLIT.treasury}% to KOMA.
        </>
      ) : (
        <>
          This deployment runs the Solidity reference versions of the curve math and the royalty router. KOMA&rsquo;s public
          deployments run the same logic as Rust compiled to WebAssembly on Stylus, behind the same interfaces and checked against the
          same test vectors. The router splits each {TRADE_FEE_PCT}% fee as it&rsquo;s paid: {FEE_SPLIT.character}% to the character,{" "}
          {FEE_SPLIT.remix}% up the remix tree, {FEE_SPLIT.treasury}% to KOMA.
        </>
      ),
      chips: [
        { label: stylus ? "Curve math (Stylus)" : "Curve math", address: lp?.curveMath },
        { label: stylus ? "Royalty router (Stylus)" : "Royalty router", address: lp?.royaltyRouter },
      ],
    },
    {
      title: "Character wallet: ERC-6551",
      text: (
        <>
          Each Character NFT owns a Tokenbound account, a wallet controlled by whoever holds the NFT. Its share of trading fees lands
          there in USDC, and the owner can move it out.
        </>
      ),
      chips: character
        ? [
            { label: `${character.name}’s wallet`, address: character.account },
            { label: "Character NFT", address: lp?.characterNft },
          ]
        : [
            { label: "Character NFT", address: lp?.characterNft },
            { label: "ERC-6551 registry", address: lp?.erc6551Registry },
          ],
    },
    {
      title: "Payments: USDC over x402",
      text: (
        <>
          Launching (${LAUNCH_PRICE}) and drawing pages are paid in USDC with x402. You sign a transfer authorization (EIP-3009); KOMA&rsquo;s
          facilitator settles it on-chain and pays that gas.
        </>
      ),
      chips: [
        { label: "USDC", address: KOMA.usdc },
        { label: "Facilitator", address: facilitator },
      ],
    },
    {
      title: "Gasless trades",
      text: (
        <>
          Trades of ${GASLESS_MIN_USDC} or more are signatures, not transactions: a USDC authorization to buy, a permit plus a sell intent to
          sell. KOMA&rsquo;s relayer submits them and pays the gas. Smaller trades go through your own wallet.
        </>
      ),
      chips: [{ label: "Relayer", address: lp?.relayer }],
    },
    {
      title: "Graduation: Uniswap v4",
      text: (
        <>
          When a curve reaches its target, {GRADUATION_FEE_PCT}% of the USDC raised goes to KOMA and the rest, with the unsold coins, seeds a
          full-range Uniswap v4 pool. The liquidity position goes to a dead address, so it can&rsquo;t be pulled.
        </>
      ),
      chips: [
        { label: "Graduator", address: lp?.graduator },
        { label: "v4 PoolManager", address: lp?.poolManager },
      ],
    },
    {
      title: "Canon",
      text: <>Holders vote with free EIP-712 signatures. The winning episode and a Merkle root of every vote are written to the canon registry.</>,
      chips: [{ label: "Canon registry", address: lp?.canonRegistry }],
    },
  ];

  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border border-arb/30 bg-[#06111a]">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-arb/20 px-4 py-4 md:px-6">
        <h2 id={`${id}-h`} className="flex items-center gap-2.5 font-display text-[26px] uppercase leading-none text-arb md:text-[30px]">
          <ArbMark width={22} height={22} /> Built on Arbitrum
        </h2>
        <p className="text-[12.5px] text-mute">
          {lp ? (
            <>
              What runs where on {KOMA.label}. {stylus ? "Engine: Stylus (Rust/WASM)." : "Engine: Solidity reference."}
            </>
          ) : (
            <>The launchpad contracts aren&rsquo;t deployed on {KOMA.label} yet.</>
          )}
        </p>
      </header>
      <dl className="grid md:grid-cols-2">
        {rows.map((r, i) => (
          <div key={r.title} className={`border-arb/15 px-4 py-4 md:px-6 ${i > 0 ? "border-t" : ""} ${i === 1 ? "md:border-t-0" : ""} ${i % 2 === 1 ? "md:border-l" : ""}`}>
            <dt className="font-display text-[17px] uppercase leading-tight text-paper">{r.title}</dt>
            <dd className="mt-1.5 text-[13px] leading-relaxed text-soft">{r.text}</dd>
            {lp && r.chips.some((c) => c.address) && (
              <dd className="mt-3 flex flex-wrap gap-2">
                {r.chips.map((c) => c.address && <AddrChip key={c.label} label={c.label} address={c.address} />)}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
