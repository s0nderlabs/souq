export const hookAbi = [
  {
    type: "function",
    name: "getJobData",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "clientAgentId", type: "uint256" },
          { name: "providerAgentId", type: "uint256" },
          { name: "evaluatorAgentId", type: "uint256" },
          { name: "providerPolicies", type: "bytes32[]" },
          { name: "evaluatorPolicies", type: "bytes32[]" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "escrow",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sigil",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "identityRegistry",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;
