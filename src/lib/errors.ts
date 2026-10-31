/**
 * Invalid input detected deep inside shared logic (segments, custom fields) that may also run
 * in the worker. API routes turn it into a 400 with the message.
 */
export class UserInputError extends Error {
  /** Extra fields for the JSON error response, e.g. { nodeId } so the flow builder can highlight a step */
  details?: Record<string, unknown>;
}

/**
 * The workspace's plan doesn't allow this (limit reached, feature not included) or the
 * workspace is read-only (subscription ended, suspended). API routes answer 402 with `code`.
 */
export class PlanError extends Error {
  constructor(
    message: string,
    public code: "plan_limit" | "plan_feature" | "subscription_inactive" | "suspended",
  ) {
    super(message);
  }
}
