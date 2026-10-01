import { parseAbi } from "viem";

// The parts of the launchpad contracts (contracts/LAUNCHPAD_SPEC.md) the app calls.
// Shared by the browser and the server.

export const factoryAbi = parseAbi([
  "struct LaunchParams { address creator; string name; string symbol; string characterName; bytes32 sheetHash; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; }",
  "struct Series { address coin; address curve; address vesting; uint256 characterId; address characterAccount; address creator; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; uint64 launchedAt; }",
  "function launch(LaunchParams p) returns (uint256 seriesId)",
  "function series(uint256 id) view returns (Series)",
  "function seriesCount() view returns (uint256)",
  "event SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)",
  "error AccessControlBadConfirmation()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error EmptyName()",
  "error InvalidBounds()",
  "error InvalidVotingWindow(uint64 window)",
  "error TargetTooLow(uint256 target, uint256 min)",
  "error UnknownParent(uint256 parentSeriesId)",
  "error ZeroAddress()",
]);

export const curveAbi = parseAbi([
  "function quoteBuy(uint256 usdcIn) view returns (uint256 coinOut, uint256 fee, uint256 usdcUsed)",
  "function quoteSell(uint256 coinIn) view returns (uint256 usdcOut, uint256 fee)",
  "function buy(uint256 usdcIn, uint256 minCoinOut, address recipient) returns (uint256 coinOut)",
  "function sell(uint256 coinIn, uint256 minUsdcOut, address recipient) returns (uint256 usdcOut)",
  "function buyWithAuthorization(address buyer, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (uint256 coinOut)",
  "function sellWithPermit(address seller, uint256 coinIn, uint256 minUsdcOut, uint256 deadline, uint8 pv, bytes32 pr, bytes32 ps, bytes intentSig) returns (uint256 usdcOut)",
  "function sellNonces(address seller) view returns (uint256)",
  "function graduate() returns (bytes32 poolId)",
  "function state() view returns (uint256 vU, uint256 vC, uint256 raised, uint256 target, bool complete, bool graduated, uint256 launchedAt)",
  "function spotPrice() view returns (uint256)",
  "function coin() view returns (address)",
  "function seriesId() view returns (uint256)",
  "event Trade(address indexed trader, bool indexed isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 vU, uint256 vC, uint256 raised)",
  "event Completed(uint256 raised)",
  "event Graduated(address pool, bytes32 poolId, uint256 usdcToPool, uint256 coinToPool)",

  "function unroutedFees() view returns (uint256)",
  "function flushFees()",
  "function invalidateSellNonce()",
  "error AlreadyGraduated()",
  "error CoinAlreadySet()",
  "error CoinNotSet()",
  "error CurveComplete()",
  "error Expired(uint256 deadline)",
  "error FeeRoutingOutOfGas()",
  "error InsufficientAllowance(uint256 allowance, uint256 needed)",
  "error InsufficientReserve(uint256 gross, uint256 raised)",
  "error InvalidIntentSignature()",
  "error InvalidShortString()",
  "error InvalidTarget(uint256 target)",
  "error NotComplete()",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error Slippage(uint256 out, uint256 minOut)",
  "error SnipeCap(uint256 balanceAfter, uint256 cap)",
  "error StringTooLong(string str)",
  "error Unauthorized(address caller)",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error CheckpointUnorderedInsertion()",
  "error ECDSAInvalidSignature()",
  "error ECDSAInvalidSignatureLength(uint256 length)",
  "error ECDSAInvalidSignatureS(bytes32 s)",
  "error ERC20ExceededSafeSupply(uint256 increasedSupply, uint256 cap)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidSpender(address spender)",
  "error ERC2612ExpiredSignature(uint256 deadline)",
  "error ERC2612InvalidSigner(address signer, address owner)",
  "error ERC5805FutureLookup(uint256 timepoint, uint48 clock)",
  "error ERC6372InconsistentClock()",
  "error InvalidAccountNonce(address account, uint256 currentNonce)",
  "error PoolLockedUntilGraduation()",
  "error SafeCastOverflowedUintDowncast(uint8 bits, uint256 value)",
  "error VotesExpiredSignature(uint256 expiry)",
]);

export const coinAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nonces(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function getVotes(address account) view returns (uint256)",
  "function getPastVotes(address account, uint256 timepoint) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

export const characterAbi = parseAbi([
  "function ownerOf(uint256 id) view returns (address)",
  "function accountOf(uint256 id) view returns (address)",
  "event CharacterMinted(uint256 indexed id, address indexed to, address account, bytes32 sheetHash, string name)",
]);

export const routerAbi = parseAbi([
  "function earned(address recipient) view returns (uint256)",
  "event Routed(uint256 indexed seriesId, address indexed recipient, uint256 amount, uint8 kind)",
]);

export const canonAbi = parseAbi([
  "function propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256 episode)",
  "function finalize(uint256 seriesId, uint256 episode, uint256 winnerIssueId, bytes32 votesRoot, uint256 winnerVotes, uint256 totalVotes)",
  "function nextEpisode(uint256 seriesId) view returns (uint256)",
  "function slot(uint256 seriesId, uint256 episode) view returns (uint64 snapshot, uint64 endsAt, bool finalized, uint256 winner, uint256 proposalCount)",
  "function proposals(uint256 seriesId, uint256 episode) view returns (uint256[])",
  "function canonOf(uint256 seriesId, uint256 episode) view returns (uint256)",
  "function votingPower(uint256 seriesId, uint256 episode, address voter) view returns (uint256)",
  "event SlotOpened(uint256 indexed seriesId, uint256 indexed episode, uint64 snapshot, uint64 endsAt)",
  "event Proposed(uint256 indexed seriesId, uint256 indexed episode, uint256 indexed issueId, address proposer)",
  "event CanonFinalized(uint256 indexed seriesId, uint256 indexed episode, uint256 winnerIssueId, bytes32 votesRoot, uint256 winnerVotes, uint256 totalVotes)",
  "error AccessControlBadConfirmation()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error AlreadyFinalized(uint256 seriesId, uint256 episode)",
  "error AlreadyProposed(uint256 issueId)",
  "error InvalidIssue(uint256 issueId)",
  "error InvalidTally()",
  "error InvalidWindow()",
  "error NotAProposal(uint256 issueId)",
  "error NotEligible(address proposer)",
  "error SeriesExists(uint256 seriesId)",
  "error SlotNotOpen(uint256 seriesId, uint256 episode)",
  "error UnknownSeries(uint256 seriesId)",
  "error VotingClosed(uint256 seriesId, uint256 episode)",
  "error VotingOpen(uint256 seriesId, uint256 episode)",
  "error ZeroAddress()",
]);

export const swapperAbi = parseAbi([
  "function swapExactIn(uint256 seriesId, bool buyCoin, uint256 amountIn, uint256 minOut, address recipient) returns (uint256 amountOut)",
  "function swapWithAuthorization(address buyer, uint256 seriesId, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (uint256 coinOut)",
  "function swapNonce(address buyer, uint256 seriesId, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt) view returns (bytes32)",
  "event Swapped(uint256 indexed seriesId, address indexed payer, address indexed recipient, bool buyCoin, uint256 amountIn, uint256 amountOut)",
  "error Expired(uint256 deadline)",
  "error NotGraduated(uint256 seriesId)",
  "error ReentrancyGuardReentrantCall()",
  "error SafeCastOverflowedIntToUint(int256 value)",
  "error SafeCastOverflowedUintToInt(uint256 value)",
  "error SafeERC20FailedOperation(address token)",
  "error Slippage(uint256 out, uint256 minOut)",
  "error Unauthorized(address caller)",
  "error ZeroAddress()",
  "error ZeroAmount()",
]);

export const graduatorAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function poolKeyOf(uint256 seriesId) view returns (PoolKey)",
  "event PoolCreated(uint256 indexed seriesId, bytes32 poolId, uint160 sqrtPriceX96, uint256 usdcToPool, uint256 coinToPool, uint256 liquidity)",
]);

/** Uniswap v4 Quoter (periphery): prices a swap through a graduated pool. */
export const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
/**
 * Uniswap v4 Quoter per chain (developers.uniswap.org deployments), used when an
 * addresses file predates its `v4Quoter` field. Forks use their parent chain's.
 */
export const V4_QUOTERS: Record<number, `0x${string}`> = {
  42161: "0x3972c00f7ed4885e145823eb7c655375d275a1c5",
  421614: "0x7de51022d70a725b508085468052e25e22b5c4c9",
  4216141: "0x7de51022d70a725b508085468052e25e22b5c4c9",
};

/** EIP-712 vote a holder signs for free; the relayer tallies and finalizes. */
export const voteTypes = {
  Vote: [
    { name: "seriesId", type: "uint256" },
    { name: "episode", type: "uint256" },
    { name: "issueId", type: "uint256" },
    { name: "voter", type: "address" },
  ],
} as const;

/** EIP-712 sell intent, bound to one curve and the seller's nonce. */
export const sellTypes = {
  Sell: [
    { name: "seller", type: "address" },
    { name: "coinIn", type: "uint256" },
    { name: "minUsdcOut", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const receiveAuthTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const BUY_TAG = "KOMA_BUY_V1";
export const TOTAL_SUPPLY = 1_000_000_000;
export const CANON_THRESHOLD = 1_000_000;

/** Graduation targets the factory uses (LaunchpadConstants): a normal series, and a testnet demo series. */
export const GRADUATION_TARGET_USDC = 5_000;
export const DEMO_TARGET_USDC = 25;
/** The curve opens with 1,000 virtual USDC against 1B virtual coins. */
export const START_PRICE_USDC = 1_000 / TOTAL_SUPPLY;

/** Tokenbound AccountV3 (ERC-6551): the character's wallet. Only the Character NFT's owner can call execute. */
export const tokenboundAbi = parseAbi([
  "function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)",
  "function owner() view returns (address)",
  "function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)",
  "error NotAuthorized()",
  "error InvalidOperation()",
]);

/** ERC-20 transfer, encoded as the call the character's wallet makes. */
export const erc20TransferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
