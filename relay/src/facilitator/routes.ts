import { Hono } from "hono";
import type { AppContext } from "../types";
import { getFacilitator } from "./index";
import { NETWORK } from "../config";

const facilitatorRoutes = new Hono<AppContext>();

/**
 * GET /facilitator/supported
 * Returns the facilitator's supported payment methods.
 * Used by x402 clients to discover capabilities before payment.
 */
facilitatorRoutes.get("/facilitator/supported", (c) => {
  const { facilitator, address, revenueWallet, usdtAddress } = getFacilitator(c.env);

  return c.json({
    facilitatorAddress: address,
    network: NETWORK,
    scheme: "exact",
    asset: usdtAddress,
    payTo: revenueWallet,
  });
});

export default facilitatorRoutes;
