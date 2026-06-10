export { approvalGateRules } from "./approvalGateRules.js";
export { stateRules } from "./stateRules.js";
export { toolSafetyRules } from "./toolSafetyRules.js";
export { architectureRules } from "./architectureRules.js";
export { graphRules } from "./graphRules.js";

import { approvalGateRules } from "./approvalGateRules.js";
import { stateRules } from "./stateRules.js";
import { toolSafetyRules } from "./toolSafetyRules.js";
import { architectureRules } from "./architectureRules.js";
import { graphRules } from "./graphRules.js";
import type { ReviewRule } from "../types.js";

/** All rules in priority order: blocking rules first, advisory last. */
export const ALL_RULES: ReviewRule[] = [
  ...approvalGateRules,
  ...graphRules,
  ...architectureRules,
  ...stateRules,
  ...toolSafetyRules,
];
