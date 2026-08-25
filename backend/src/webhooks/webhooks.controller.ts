import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Principal } from '../compliance/principal';
import { CreateWebhookSubscriptionDto, WebhookDeliveryView, WebhookSubscriptionCreatedView, WebhookSubscriptionView } from './dto/webhook.dto';
import { WebhookAccessGuard } from './webhook-access.guard';
import { WebhookDeliveryLogService } from './webhook-delivery-log.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';

interface AuthedRequest {
  principal: Principal;
}

/**
 * Webhook registration & delivery-log API (issue #60). Every route requires
 * a verified wallet-connect JWT (`WebhookAccessGuard`); a caller may only
 * manage their own subscriptions unless their token carries the `admin`
 * role (enforced in `WebhookSubscriptionsService`).
 */
@Controller('webhooks')
@UseGuards(WebhookAccessGuard)
export class WebhooksController {
  constructor(
    private readonly subscriptions: WebhookSubscriptionsService,
    private readonly deliveries: WebhookDeliveryLogService,
  ) {}

  /** Register a new endpoint. The response's `secret` is shown only this once. */
  @Post('subscriptions')
  create(
    @Req() req: AuthedRequest,
    @Body() body: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscriptionCreatedView> {
    return this.subscriptions.register(req.principal, body);
  }

  /** List the caller's subscriptions (or another wallet's, for admins). */
  @Get('subscriptions')
  list(
    @Req() req: AuthedRequest,
    @Query('ownerId') ownerId?: string,
  ): Promise<WebhookSubscriptionView[]> {
    return this.subscriptions.list(req.principal, ownerId);
  }

  /** Deactivate a subscription. Future events stop being enqueued for it. */
  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.subscriptions.revoke(req.principal, id);
  }

  /** Delivery attempt log for a subscription, newest first. */
  @Get('subscriptions/:id/deliveries')
  async listDeliveries(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<WebhookDeliveryView[]> {
    // Ownership/existence check; throws NotFound/Forbidden before we touch deliveries.
    await this.subscriptions.findOwned(req.principal, id);
    return this.deliveries.listForSubscription(id, {
      status,
      limit: limit === undefined ? undefined : Number(limit),
    });
  }
}
