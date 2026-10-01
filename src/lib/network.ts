import { defineChain } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";

// Shared by the browser and the server. NEXT_PUBLIC_ values are inlined at build.
const RPC_OVERRIDE = process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;
const LOCAL_ID = Number(process.env.NEXT_PUBLIC_KOMA_CHAIN_ID || 4216141);

/**
 * KOMA's hosted localnet: a persistent fork of Arbitrum Sepolia (so USDC is the
 * real Circle contract) with its own chain id, so wallets never confuse it with
 * the public testnet.
 */
const komaLocalnet = defineChain({
  id: LOCAL_ID,
  name: "KOMA Localnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_OVERRIDE || "http://127.0.0.1:18611"] } },
  testnet: true,
});

export const NETWORKS = {
  "arbitrum-one": {
    key: "arbitrum-one",
    chain: arbitrum,
    caip: "eip155:42161",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    explorer: "https://arbiscan.io",
    label: "Arbitrum One",
    faucet: false,
  },
  "arbitrum-sepolia": {
    key: "arbitrum-sepolia",
    chain: arbitrumSepolia,
    caip: "eip155:421614",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorer: "https://sepolia.arbiscan.io",
    label: "Arbitrum Sepolia",
    faucet: false,
  },
  "koma-localnet": {
    key: "koma-localnet",
    chain: komaLocalnet,
    caip: `eip155:${LOCAL_ID}` as `eip155:${number}`,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    explorer: "",
    label: "KOMA Localnet",
    faucet: true,
  },
} as const;

export type NetworkKey = keyof typeof NETWORKS;

const selected = process.env.NEXT_PUBLIC_KOMA_NETWORK as NetworkKey | undefined;
export const KOMA = NETWORKS[selected && selected in NETWORKS ? selected : "arbitrum-sepolia"];

export const RPC_URL = RPC_OVERRIDE || KOMA.chain.rpcUrls.default.http[0];

/** EIP-712 domain of USDC (FiatToken v2) on every network KOMA supports. */
export const USDC_DOMAIN = { name: "USD Coin", version: "2" } as const;

// ——— Pricing (USDC). Comics keep the 10¢ hook; everything that costs KOMA more pays its way.
/** A comic page. The loss leader: about break-even on one page, profitable from two. */
export const PRICE_PER_PAGE = 0.1;
/** A series episode page: drawn with the character sheet as a reference, which costs fal twice as much per panel. */
export const EPISODE_PRICE_PER_PAGE = 0.3;
/** Launching a series (character sheet + a ~5M-gas launch transaction). */
export const LAUNCH_PRICE = 1;
/** Curve trading fee and how it's split on chain (LaunchpadConstants / royalty router). */
export const TRADE_FEE_PCT = 1.5;
export const FEE_SPLIT = { character: 40, remix: 20, treasury: 40 } as const;
/** Share of the USDC raised that goes to KOMA's treasury when a curve graduates. */
export const GRADUATION_FEE_PCT = 5;
/** Smallest trade KOMA's relayer submits for free; below it the trade costs more gas than its fee. */
export const GASLESS_MIN_USDC = 3;
export const PAGE_OPTIONS = [1, 2, 4, 6] as const;
export const USDC_DECIMALS = 6;
