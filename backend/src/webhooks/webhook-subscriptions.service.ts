import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WebhookSubscription } from '@prisma/client';
import { Principal, isAdmin } from '../compliance/principal';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookSubscriptionDto, WebhookSubscriptionCreatedView, WebhookSubscriptionView } from './dto/webhook.dto';
import { ALL_EVENTS_WILDCARD, ALL_INVOICE_EVENT_TYPES, InvoiceEventType } from './webhook-event.types';
import { generateWebhookSecret } from './webhook-signing';
import { assertPublicWebhookUrl } from './webhook-url';

const MAX_SUBSCRIPTIONS_PER_OWNER = 20;

@Injectable()
export class WebhookSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Register a new webhook endpoint for the caller. Returns the signing secret once. */
  async register(
    principal: Principal,
    dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscriptionCreatedView> {
    const url = assertPublicWebhookUrl(dto.url ?? '');
    const eventTypes = validateEventTypes(dto.eventTypes);

    const existing = await this.prisma.webhookSubscription.count({
      where: { ownerId: principal.walletAddress, active: true },
    });
    if (existing >= MAX_SUBSCRIPTIONS_PER_OWNER) {
      throw new BadRequestException(
        `A wallet may register at most ${MAX_SUBSCRIPTIONS_PER_OWNER} active webhook subscriptions`,
      );
    }

    const secret = generateWebhookSecret();
    const created = await this.prisma.webhookSubscription.create({
      data: {
        ownerId: principal.walletAddress,
        url: url.toString(),
        secret,
        eventTypes,
      },
    });
    return { ...toView(created), secret };
  }

  /** List subscriptions owned by the caller. Admins may pass `ownerId` to inspect another wallet's. */
  async list(principal: Principal, ownerId?: string): Promise<WebhookSubscriptionView[]> {
    const where = isAdmin(principal)
      ? (ownerId ? { ownerId } : {})
      : { ownerId: principal.walletAddress };
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return subscriptions.map(toView);
  }

  /** Deactivate a subscription. Idempotent: revoking an already-inactive subscription is a no-op. */
  async revoke(principal: Principal, id: string): Promise<void> {
    const subscription = await this.findOwned(principal, id);
    if (!subscription.active) return;
    await this.prisma.webhookSubscription.update({
      where: { id: subscription.id },
      data: { active: false },
    });
  }

  /** Look up a subscription and assert the caller may act on it (owner or admin). */
  async findOwned(principal: Principal, id: string): Promise<WebhookSubscription> {
    const subscription = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!subscription) {
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    }
    if (!isAdmin(principal) && subscription.ownerId !== principal.walletAddress) {
      throw new ForbiddenException('Not the owner of this webhook subscription');
    }
    return subscription;
  }
}

function validateEventTypes(eventTypes: string[] | undefined): string[] {
  if (!eventTypes || eventTypes.length === 0) return [ALL_EVENTS_WILDCARD];
  if (eventTypes.includes(ALL_EVENTS_WILDCARD)) return [ALL_EVENTS_WILDCARD];

  const invalid = eventTypes.filter(
    (type) => !ALL_INVOICE_EVENT_TYPES.includes(type as InvoiceEventType),
  );
  if (invalid.length > 0) {
    throw new BadRequestException(
      `Invalid event types: ${invalid.join(', ')}. Valid types: ${ALL_INVOICE_EVENT_TYPES.join(', ')}, or "${ALL_EVENTS_WILDCARD}"`,
    );
  }
  return Array.from(new Set(eventTypes));
}

function toView(subscription: WebhookSubscription): WebhookSubscriptionView {
  return {
    id: subscription.id,
    ownerId: subscription.ownerId,
    url: subscription.url,
    eventTypes: subscription.eventTypes,
    active: subscription.active,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}
