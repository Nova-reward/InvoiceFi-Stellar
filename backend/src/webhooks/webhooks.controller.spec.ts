import { Principal } from '../compliance/principal';
import { WebhookDeliveryLogService } from './webhook-delivery-log.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhooksController } from './webhooks.controller';

const FARMER: Principal = { userId: '1', walletAddress: 'GFARMER', role: 'farmer' };

function buildController() {
  const subscriptions = {
    register: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    findOwned: jest.fn().mockResolvedValue({ id: 'sub-1' }),
  } as unknown as WebhookSubscriptionsService;
  const deliveries = {
    listForSubscription: jest.fn().mockResolvedValue([]),
  } as unknown as WebhookDeliveryLogService;
  const controller = new WebhooksController(subscriptions, deliveries);
  return { controller, subscriptions, deliveries };
}

describe('WebhooksController', () => {
  it('delegates registration to the subscriptions service', async () => {
    const { controller, subscriptions } = buildController();
    const req = { principal: FARMER };
    const body = { url: 'https://example.com/hook' };

    await controller.create(req, body);

    expect(subscriptions.register).toHaveBeenCalledWith(FARMER, body);
  });

  it('delegates listing to the subscriptions service', async () => {
    const { controller, subscriptions } = buildController();

    await controller.list({ principal: FARMER }, 'GOTHER');

    expect(subscriptions.list).toHaveBeenCalledWith(FARMER, 'GOTHER');
  });

  it('delegates revocation to the subscriptions service', async () => {
    const { controller, subscriptions } = buildController();

    await controller.revoke({ principal: FARMER }, 'sub-1');

    expect(subscriptions.revoke).toHaveBeenCalledWith(FARMER, 'sub-1');
  });

  it('checks ownership before returning a delivery log, and forwards status/limit', async () => {
    const { controller, subscriptions, deliveries } = buildController();

    await controller.listDeliveries({ principal: FARMER }, 'sub-1', 'ABANDONED', '10');

    expect(subscriptions.findOwned).toHaveBeenCalledWith(FARMER, 'sub-1');
    expect(deliveries.listForSubscription).toHaveBeenCalledWith('sub-1', {
      status: 'ABANDONED',
      limit: 10,
    });
  });

  it('propagates a Forbidden/NotFound from the ownership check instead of returning deliveries', async () => {
    const { controller, subscriptions, deliveries } = buildController();
    const err = new Error('not owned');
    (subscriptions.findOwned as jest.Mock).mockRejectedValue(err);

    await expect(controller.listDeliveries({ principal: FARMER }, 'sub-1')).rejects.toBe(err);
    expect(deliveries.listForSubscription).not.toHaveBeenCalled();
  });
});
