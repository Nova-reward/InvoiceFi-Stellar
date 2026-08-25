import { renderHook, act } from '@testing-library/react';
import { useInvoiceNotifications, InvoiceEvent } from './useInvoiceNotifications';

// Mock socket.io-client
const mockOn = jest.fn();
const mockDisconnect = jest.fn();
const mockSocket = {
  on: mockOn,
  disconnect: mockDisconnect,
};
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));

describe('useInvoiceNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts disconnected with no events', () => {
    const { result } = renderHook(() => useInvoiceNotifications());
    expect(result.current.connected).toBe(false);
    expect(result.current.events).toEqual([]);
  });

  it('sets connected=true on connect event', () => {
    const { result } = renderHook(() => useInvoiceNotifications());

    // Find the 'connect' handler registered via socket.on
    const connectCall = mockOn.mock.calls.find(([ev]) => ev === 'connect');
    expect(connectCall).toBeDefined();

    act(() => {
      connectCall![1](); // invoke connect handler
    });

    expect(result.current.connected).toBe(true);
  });

  it('appends incoming invoice events', () => {
    const { result } = renderHook(() => useInvoiceNotifications());

    const eventHandler = mockOn.mock.calls.find(
      ([ev]) => ev === 'invoice_event',
    )![1];

    const event: InvoiceEvent = {
      invoiceId: 1,
      event: 'funded',
      actor: 'GFUNDER',
      timestamp: new Date().toISOString(),
    };

    act(() => {
      eventHandler(event);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toEqual(event);
  });

  it('prepends new events (most recent first)', () => {
    const { result } = renderHook(() => useInvoiceNotifications());
    const eventHandler = mockOn.mock.calls.find(
      ([ev]) => ev === 'invoice_event',
    )![1];

    const e1: InvoiceEvent = { invoiceId: 1, event: 'created', timestamp: '2026-01-01T00:00:00Z' };
    const e2: InvoiceEvent = { invoiceId: 1, event: 'submitted', timestamp: '2026-01-01T00:01:00Z' };

    act(() => { eventHandler(e1); });
    act(() => { eventHandler(e2); });

    expect(result.current.events[0]).toEqual(e2);
    expect(result.current.events[1]).toEqual(e1);
  });

  it('disconnects socket on unmount', () => {
    const { unmount } = renderHook(() => useInvoiceNotifications());
    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
