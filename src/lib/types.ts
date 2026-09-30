import type { NetworkKey } from "./network";

export type Genre = "Manga" | "Superhero" | "Noir" | "Sci-fi" | "Horror" | "Comedy" | "Fantasy";

export type BalloonKind = "speech" | "thought" | "caption" | "sfx";

export type Balloon = {
  kind: BalloonKind;
  text: string;
  /** Anchor, as a percentage of the panel box. */
  x: number;
  y: number;
  /** Max width as a percentage of the panel. */
  w?: number;
  /** Which way a speech tail points. */
  tail?: "left" | "right" | "none";
  /** SFX rotation in degrees. */
  tilt?: number;
};

export type PanelShape = "wide" | "square";

export type Panel = {
  img: string;
  alt: string;
  shape: PanelShape;
  balloons: Balloon[];
};

export type Page = { panels: Panel[] };

export type ChainRecord = {
  network: NetworkKey;
  tokenId: number;
  contract: `0x${string}`;
  mintTx: `0x${string}`;
  paymentTx: `0x${string}`;
  contentHash: `0x${string}`;
  paidUsdc: string;
};

export type Comic = {
  id: string;
  title: string;
  logline: string;
  genre: Genre;
  style: string;
  cover: string;
  /** Poster color used behind the cover on detail pages. */
  tone: string;
  creator: { name: string; address: `0x${string}` };
  pageCount: number;
  priceUsdc: string;
  reads: number;
  remixes: number;
  createdAt: string;
  chain: ChainRecord;
  pages?: Page[];
  remixOf?: { id: string; title: string };
  /** Names of the leads the buyer chose or designed. */
  cast?: string[];
  /** Launchpad series this issue was proposed to as an episode. */
  series?: { id: number; name: string; symbol: string };
};

export type CustomCharacter = { name: string; look: string };

export type Order = {
  prompt: string;
  /** Working title agreed in the chat studio; the writer keeps it. */
  title?: string;
  style: string;
  /** Ready-made cast ids. */
  cast: string[];
  /** Characters the buyer designed in the studio. */
  custom?: CustomCharacter[];
  genre?: Genre;
  pages: number;
  remixOf?: string;
  /** Launchpad series this issue is an episode proposal for. */
  seriesId?: number;
};

export type JobStage = "settling" | "writing" | "drawing" | "lettering" | "minting" | "done" | "error";

/** Server-side progress of one paid issue, polled by the studio. */
export type Job = {
  id: string;
  stage: JobStage;
  order: Order;
  payer: `0x${string}`;
  amountUsdc: string;
  network: ChainRecord["network"];
  paymentTx?: `0x${string}`;
  /** EIP-3009 authorization nonce, to find the settlement on-chain after a crash. */
  nonce?: `0x${string}`;
  validBefore?: number;
  sinceBlock?: number;
  script?: { title: string; logline: string };
  pages: Page[];
  drawn: number;
  total: number;
  tokenId?: number;
  mintTx?: `0x${string}`;
  error?: string;
  failedAt?: JobStage;
  /** Server-only working state so a restarted job continues instead of starting over. */
  work?: { script: unknown; seed: number; cover?: string };
  /** Canon proposal result for series episodes. */
  canon?: { seriesId: number; proposed: boolean; error?: string };
  createdAt: string;
  updatedAt: string;
};

/** A chat-studio pitch: a valid order plus its agreed title and price. */
export type Pitch = Order & { title: string; price: string };
