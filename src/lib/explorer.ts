import { KOMA, RPC_URL } from "./network";

// Arbiscan only knows public chains. Against a local RPC, links go to KOMA's
// own /tx page, which reads the receipt from that RPC.
const localRpc = /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(RPC_URL);
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || (localRpc ? "" : KOMA.explorer);

export const txUrl = (hash: string) => (EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : `/tx/${hash}`);
export const addressUrl = (addr: string) => (EXPLORER_URL ? `${EXPLORER_URL}/address/${addr}` : null);
export const isExternal = Boolean(EXPLORER_URL);
