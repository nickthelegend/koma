// Subset of contracts/src/KomaIssues.sol the app calls.
export const komaAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "contentHash", type: "bytes32" },
      { name: "paymentTx", type: "bytes32" },
      { name: "pages", type: "uint16" },
      { name: "remixOf", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfPayment",
    stateMutability: "view",
    inputs: [{ name: "paymentTx", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "issue",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "contentHash", type: "bytes32" },
          { name: "paymentTx", type: "bytes32" },
          { name: "remixOf", type: "uint256" },
          { name: "mintedAt", type: "uint64" },
          { name: "pages", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "IssueMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "paymentTx", type: "bytes32", indexed: true },
      { name: "contentHash", type: "bytes32", indexed: false },
      { name: "remixOf", type: "uint256", indexed: false },
      { name: "pages", type: "uint16", indexed: false },
    ],
  },
] as const;
