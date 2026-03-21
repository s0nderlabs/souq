export const sigilAbi = [
  {
    type: "function",
    name: "isCompliant",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "policyId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPolicy",
    inputs: [{ name: "policyId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "isPublic", type: "bool" },
          { name: "isActive", type: "bool" },
          { name: "registeredBy", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getComplianceStatus",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "policyId", type: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "compliant", type: "bool" },
          { name: "score", type: "uint8" },
          { name: "expiresAt", type: "uint256" },
          { name: "lastUpdate", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;
