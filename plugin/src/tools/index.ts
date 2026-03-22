import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupWallet } from "./setup-wallet.js";
import { registerGetWalletInfo } from "./get-wallet-info.js";
import { registerCreateJob } from "./create-job.js";
import { registerSetProvider } from "./set-provider.js";
import { registerSetBudget } from "./set-budget.js";
import { registerFundJob } from "./fund-job.js";
import { registerSubmitWork } from "./submit-work.js";
import { registerCompleteJob } from "./complete-job.js";
import { registerRejectJob } from "./reject-job.js";
import { registerClaimRefund } from "./claim-refund.js";
import { registerGetJob } from "./get-job.js";
import { registerListJobs } from "./list-jobs.js";
import { registerRegisterIdentity } from "./register-identity.js";
import { registerGiveFeedback } from "./give-feedback.js";
import { registerCreatePolicy } from "./create-policy.js";
import { registerTriggerAssessment } from "./trigger-assessment.js";
import { registerCheckCompliance } from "./check-compliance.js";
import { registerGetNotifications } from "./get-notifications.js";
import { registerReadDeliverable } from "./read-deliverable.js";
import { registerApplyForJob } from "./apply-for-job.js";

export function registerTools(server: McpServer): void {
  // Wallet
  registerSetupWallet(server);
  registerGetWalletInfo(server);

  // Job Lifecycle
  registerCreateJob(server);
  registerSetProvider(server);
  registerSetBudget(server);
  registerFundJob(server);
  registerSubmitWork(server);
  registerCompleteJob(server);
  registerRejectJob(server);
  registerClaimRefund(server);
  registerApplyForJob(server);

  // Read
  registerGetJob(server);
  registerListJobs(server);
  registerReadDeliverable(server);

  // Identity & Reputation
  registerRegisterIdentity(server);
  registerGiveFeedback(server);

  // Compliance (Sigil)
  registerCreatePolicy(server);
  registerTriggerAssessment(server);
  registerCheckCompliance(server);

  // Notifications
  registerGetNotifications(server);
}
