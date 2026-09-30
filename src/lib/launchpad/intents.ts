import { encodeAbiParameters, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { BUY_TAG } from "./abi";

/**
 * The EIP-3009 nonce a gasless buy is signed with. It commits to the curve,
 * amount, minimum out and deadline, so the relayer can't change any of them:
 * the curve recomputes it on-chain and USDC rejects a mismatch.
 */
export function buyNonce(o: { curve: Address; buyer: Address; usdcIn: bigint; minCoinOut: bigint; deadline: bigint; salt: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [keccak256(stringToBytes(BUY_TAG)), o.curve, o.buyer, o.usdcIn, o.minCoinOut, o.deadline, o.salt],
    ),
  );
}

/** Minimum output after slippage, in basis points. */
export const withSlippage = (amount: bigint, bps: number) => (amount * BigInt(10_000 - bps)) / BigInt(10_000);
