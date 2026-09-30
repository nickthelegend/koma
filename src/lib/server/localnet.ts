import { parseEther } from "viem";
import { config, publicClient, rpc } from "./config";

/** On the hosted localnet the server funds its own gas (facilitator + minting). */
export async function prepareLocalnet() {
  if (!config.network.faucet || !config.account) return;
  // Mine a block every second even when idle, like a real chain: canon voting
  // windows and the anti-snipe window run on block time. (anvil can drop
  // --block-time when it loads saved state, so set it here as well.)
  await rpc("evm_setIntervalMining", [1]);
  const balance = await publicClient.getBalance({ address: config.account.address });
  if (balance < parseEther("1")) {
    await rpc("anvil_setBalance", [config.account.address, `0x${parseEther("10").toString(16)}`]);
    console.log(`[koma] localnet: topped up server ${config.account.address} with 10 ETH for gas`);
  }
}
