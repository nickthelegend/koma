import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { toFacilitatorEvmSigner } from "@x402/evm";
import type { Job } from "@/lib/types";
import type { LaunchJob } from "@/lib/launchpad/types";
import { config, serverWallet } from "./config";
import { runJob } from "./pipeline";
import { saveJob } from "./store";
import { saveLaunchJob } from "./launchpad/db";
import { runLaunch } from "./launchpad/launch";

const network = config.network.caip as Network;

/**
 * KOMA's own x402 facilitator for Arbitrum: verifies EIP-3009 USDC
 * authorizations and submits them on-chain, paying the gas itself.
 * Also exposed over HTTP at /api/facilitator/* for other apps.
 */
function makeFacilitator() {
  const w = serverWallet;
  if (!w || !config.account) return null;
  const signer = toFacilitatorEvmSigner(
    {
      address: config.account.address,
      readContract: (a) => w.readContract(a as never),
      verifyTypedData: (a) => w.verifyTypedData(a as never),
      writeContract: (a) => w.writeContract(a as never),
      sendTransaction: (a) => w.sendTransaction(a as never),
      waitForTransactionReceipt: (a) => w.waitForTransactionReceipt(a as never),
      getCode: (a) => w.getCode(a),
    },
    { confirmationTimeoutMs: 45_000 },
  );
  const f = new x402Facilitator();
  registerExactEvmScheme(f, { signer, networks: network });
  return f;
}

export const facilitator = makeFacilitator();

/** The resource server talks to the facilitator in-process instead of over HTTP. */
const localFacilitator: FacilitatorClient = {
  verify: (p, r) => facilitator!.verify(p, r),
  settle: (p, r) => facilitator!.settle(p, r),
  getSupported: async () => facilitator!.getSupported() as never,
};

export const resourceServer = new x402ResourceServer(localFacilitator).register(network, new ExactEvmScheme());
export { network };

// ——— Payment → work ———
// The paid handler parks a job under the authorization nonce; it only starts
// once the facilitator has actually moved the USDC on Arbitrum.
type Pending = { job: Job; launch?: undefined } | { launch: LaunchJob; job?: undefined };
const g = globalThis as unknown as { __komaPending?: Map<string, Pending> };
export const pendingByNonce = (g.__komaPending ??= new Map());

const nonceOf = (p: { payload: Record<string, unknown> }) =>
  (p.payload as { authorization?: { nonce?: string } }).authorization?.nonce;

resourceServer.onAfterSettle(async (ctx) => {
  const nonce = nonceOf(ctx.paymentPayload as never);
  const pending = nonce && pendingByNonce.get(nonce);
  if (!pending || !ctx.result.success) return;
  pendingByNonce.delete(nonce);
  if (pending.launch) {
    pending.launch.paymentTx = ctx.result.transaction as `0x${string}`;
    saveLaunchJob(pending.launch);
    void runLaunch(pending.launch);
    return;
  }
  const { job } = pending;
  job.paymentTx = ctx.result.transaction as `0x${string}`;
  await saveJob(job);
  void runJob(job);
});

resourceServer.onSettleFailure(async (ctx) => {
  const nonce = nonceOf(ctx.paymentPayload as never);
  const pending = nonce && pendingByNonce.get(nonce);
  if (!pending) return;
  pendingByNonce.delete(nonce);
  if (pending.launch) {
    pending.launch.stage = "error";
    pending.launch.error = `Payment didn't settle: ${ctx.error.message}`;
    saveLaunchJob(pending.launch);
    return;
  }
  pending.job.stage = "error";
  pending.job.error = `Payment didn't settle: ${ctx.error.message}`;
  await saveJob(pending.job);
});
