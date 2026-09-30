import { publicClient } from "../config";

// Voting windows, snapshots and the anti-snipe window are all in block time.
// Compare against the chain's clock, not the server's: they can differ a lot
// (a local fork starts at its fork block's time).
let cached = { at: 0, ts: 0 };

export async function chainNow(): Promise<number> {
  if (Date.now() - cached.at < 2000) return cached.ts + Math.floor((Date.now() - cached.at) / 1000);
  const block = await publicClient.getBlock({ blockTag: "latest" });
  cached = { at: Date.now(), ts: Number(block.timestamp) };
  return cached.ts;
}
