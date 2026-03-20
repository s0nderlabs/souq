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
] as const;
