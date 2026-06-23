import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsGateway } from './notifications.gateway';
import { InvoiceEvent } from './invoice-event.dto';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let emitMock: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsGateway],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
    emitMock = jest.fn();
    // Inject mock server
    (gateway as any).server = { emit: emitMock };
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('emitInvoiceEvent broadcasts to all clients', () => {
    const event: InvoiceEvent = {
      invoiceId: 1,
      event: 'created',
      actor: 'GTEST',
      timestamp: new Date().toISOString(),
    };
    gateway.emitInvoiceEvent(event);
    expect(emitMock).toHaveBeenCalledWith('invoice_event', event);
  });

  it('handlePublish re-emits received event', () => {
    const event: InvoiceEvent = {
      invoiceId: 2,
      event: 'funded',
      timestamp: new Date().toISOString(),
    };
    gateway.handlePublish(event);
    expect(emitMock).toHaveBeenCalledWith('invoice_event', event);
  });

  it('emits correct event type for each lifecycle stage', () => {
    const stages: InvoiceEvent['event'][] = [
      'created',
      'submitted',
      'funded',
      'repaid',
      'defaulted',
    ];
    stages.forEach((stage, i) => {
      const event: InvoiceEvent = {
        invoiceId: i,
        event: stage,
        timestamp: new Date().toISOString(),
      };
      gateway.emitInvoiceEvent(event);
      expect(emitMock).toHaveBeenLastCalledWith('invoice_event', event);
    });
    expect(emitMock).toHaveBeenCalledTimes(stages.length);
  });
});
