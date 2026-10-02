"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, injected, useConnect, useConnection, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { erc20Abi, formatUnits } from "viem";
import type { ClientEvmSigner } from "@x402/evm";
import { KOMA, RPC_URL, USDC_DECIMALS } from "@/lib/network";

export const wagmiConfig = createConfig({
  chains: [KOMA.chain],
  connectors: [injected()],
  transports: { [KOMA.chain.id]: http(RPC_URL) } as Record<typeof KOMA.chain.id, ReturnType<typeof http>>,
  ssr: true,
});

type Wallet = {
  address: `0x${string}` | null;
  usdc: number;
  /** False until the first balance read lands; `usdc` is 0 until then, so don't treat it as empty. */
  usdcLoaded: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => void;
  /** Puts the wallet on KOMA's chain and returns an x402 signer for it. */
  signer: () => Promise<ClientEvmSigner>;
  /** Puts the wallet on KOMA's chain and returns its viem wallet client (typed-data signatures, direct transactions). */
  walletClient: () => Promise<WalletClient>;
};

export type WalletClient = Awaited<ReturnType<typeof getWalletClient<typeof wagmiConfig, typeof KOMA.chain.id>>>;

const Ctx = createContext<Wallet | null>(null);

function friendly(e: unknown) {
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
  if (/provider not found|no provider/i.test(msg)) return "No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet.";
  if (/reject|denied/i.test(msg)) return "Request cancelled in your wallet.";
  return msg || "Wallet error.";
}

function WalletState({ children }: { children: React.ReactNode }) {
  const { address, chainId } = useConnection();
  const connectM = useConnect();
  const disconnectM = useDisconnect();
  const switchM = useSwitchChain();
  const [error, setError] = useState<string | null>(null);

  const balance = useReadContract({
    address: KOMA.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const connect = useCallback(async () => {
    setError(null);
    try {
      await connectM.mutateAsync({ connector: injected(), chainId: KOMA.chain.id });
    } catch (e) {
      setError(friendly(e));
    }
  }, [connectM]);

  const walletClient = useCallback(async (): Promise<WalletClient> => {
    if (chainId !== KOMA.chain.id) await switchM.mutateAsync({ chainId: KOMA.chain.id });
    return getWalletClient(wagmiConfig, { chainId: KOMA.chain.id });
  }, [chainId, switchM]);

  const signer = useCallback(async (): Promise<ClientEvmSigner> => {
    const client = await walletClient();
    return {
      address: client.account.address,
      signTypedData: (m) => client.signTypedData({ account: client.account, ...(m as object) } as never),
    };
  }, [walletClient]);

  const value = useMemo<Wallet>(
    () => ({
      address: address ?? null,
      usdc: balance.data !== undefined ? Number(formatUnits(balance.data, USDC_DECIMALS)) : 0,
      usdcLoaded: balance.data !== undefined,
      connecting: connectM.isPending,
      error,
      connect,
      disconnect: () => disconnectM.mutate(),
      refreshBalance: () => void balance.refetch(),
      signer,
      walletClient,
    }),
    [address, balance, connectM.isPending, error, connect, disconnectM, signer, walletClient],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletState>{children}</WalletState>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export { friendly as walletErrorMessage };
