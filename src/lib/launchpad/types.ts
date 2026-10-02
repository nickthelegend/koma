export type Addr = `0x${string}`;

export type LaunchpadAddresses = {
  chainId: number;
  usdc: Addr;
  komaIssues?: Addr;
  seriesFactory: Addr;
  characterNft: Addr;
  canonRegistry: Addr;
  graduator: Addr;
  swapper: Addr;
  /** Uniswap v4 Quoter on this chain (filled per chain when an older addresses file lacks it). */
  v4Quoter: Addr;
  curveMath: Addr;
  royaltyRouter: Addr;
  engine: "stylus" | "solidity-reference";
  poolManager?: Addr;
  positionManager?: Addr;
  permit2?: Addr;
  erc6551Registry?: Addr;
  accountProxy?: Addr;
  accountImpl?: Addr;
  treasury: Addr;
  relayer: Addr;
  deployBlock: number;
};

export type SeriesSummary = {
  id: number;
  name: string;
  symbol: string;
  characterName: string;
  sheetUrl: string;
  coin: Addr;
  curve: Addr;
  characterId: number;
  characterAccount: Addr;
  creator: Addr;
  parentSeriesId: number;
  priceUsdc: number;
  marketCapUsdc: number;
  raisedUsdc: number;
  targetUsdc: number;
  complete: boolean;
  graduated: boolean;
  demo: boolean;
  holders: number;
  episodes: number;
  launchedAt: number;
  lastTradeAt: number | null;
};

export type TradeRow = { tx: string; trader: Addr; isBuy: boolean; usdc: number; coins: number; price: number; at: number };

export type SeriesDetail = SeriesSummary & {
  pitch: string;
  genre?: string;
  vestingContract: Addr;
  characterEarnedUsdc: number;
  characterOwner: Addr | null;
  launchTx: string | null;
  trades: TradeRow[];
  chart: { t: number; price: number }[];
  pool: { poolId: string; usdc: number; coins: number } | null;
  remixes: { id: number; name: string }[];
  parent: { id: number; name: string } | null;
  royalties: { recipient: Addr; kind: number; amountUsdc: number }[];
  /** USDC this character's wallet has received from trades in its remixes. */
  remixRoyaltiesUsdc: number;
  /** Latest block time, so clients count down in chain time. */
  chainTime: number;
};

export type ProposalView = {
  issueId: number;
  proposer: Addr;
  votes: number;
  voters: number;
  issue: { id: string; title: string; cover: string; logline: string } | null;
  proposedAt: number;
};

export type SignedVote = { seriesId: number; episode: number; issueId: number; voter: Addr; weight: string; signature: `0x${string}`; at: number };

export type CanonView = {
  seriesId: number;
  episode: number;
  slot: { snapshot: number; endsAt: number; finalized: boolean; winner: number; open: boolean } | null;
  proposals: ProposalView[];
  canon: { episode: number; issueId: number; issue: ProposalView["issue"]; winnerVotes: number; totalVotes: number; votesRoot: string }[];
  alternates: { episode: number; issueId: number; issue: ProposalView["issue"] }[];
  votes: SignedVote[];
  thresholdCoins: number;
  /** Latest block time, so clients count down in chain time. */
  chainTime: number;
};

export type LaunchStage = "settling" | "sheet" | "launching" | "done" | "error";

export type LaunchJob = {
  id: string;
  stage: LaunchStage;
  payer: Addr;
  nonce: `0x${string}`;
  validBefore: number;
  paymentTx?: `0x${string}`;
  request: { name: string; symbol: string; characterName: string; characterPrompt: string; pitch: string; genre?: string; parentSeriesId: number; demo: boolean };
  sheet?: string;
  sheetHash?: `0x${string}`;
  launchTx?: `0x${string}`;
  seriesId?: number;
  error?: string;
  failedAt?: LaunchStage;
  createdAt: string;
  updatedAt: string;
};

/** One line of the board's live tape: something that happened on-chain, from the index. */
export type ActivityEvent = {
  /** Stable across refreshes: kind, series, transaction and log. */
  id: string;
  kind: "launch" | "buy" | "sell" | "graduated" | "canon";
  seriesId: number;
  name: string;
  symbol: string;
  /** Block time (unix seconds). For canon, when its vote closed; for graduation, the trade that filled the curve. */
  at: number;
  tx: string | null;
  who: Addr | null;
  usdc: number | null;
  episode: number | null;
  /** A trade in the graduated Uniswap v4 pool rather than on the curve. */
  pool: boolean;
};
