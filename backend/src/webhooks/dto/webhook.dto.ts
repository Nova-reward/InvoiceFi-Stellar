/** Body accepted by `POST /webhooks/subscriptions`. */
export interface CreateWebhookSubscriptionDto {
  url?: string;
  /** Event types to receive, or omit/`["*"]` for all. */
  eventTypes?: string[];
}

/** API representation of a subscription. Never includes `secret` after creation. */
export interface WebhookSubscriptionView {
  id: string;
  ownerId: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Returned once, at creation time only, so the caller can store it. */
export interface WebhookSubscriptionCreatedView extends WebhookSubscriptionView {
  secret: string;
}

/** One logged delivery attempt for a queryable delivery record. */
export interface WebhookDeliveryAttemptView {
  attemptNumber: number;
  attemptedAt: string;
  success: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
}

/** API representation of a queued/completed delivery, for the delivery log. */
export interface WebhookDeliveryView {
  id: string;
  subscriptionId: string;
  eventType: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: WebhookDeliveryAttemptView[];
}
