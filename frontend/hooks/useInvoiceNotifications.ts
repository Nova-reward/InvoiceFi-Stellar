import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export type InvoiceEventType =
  | 'created'
  | 'submitted'
  | 'funded'
  | 'repaid'
  | 'defaulted';

export interface InvoiceEvent {
  invoiceId: number;
  event: InvoiceEventType;
  actor?: string;
  timestamp: string;
}

export interface UseInvoiceNotificationsResult {
  events: InvoiceEvent[];
  connected: boolean;
}

/**
 * Subscribes to real-time invoice events from the NestJS WebSocket gateway.
 * @param url Backend WebSocket URL (default: http://localhost:4000)
 */
export function useInvoiceNotifications(
  url = 'http://localhost:4000',
): UseInvoiceNotificationsResult {
  const [events, setEvents] = useState<InvoiceEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(url, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('invoice_event', (event: InvoiceEvent) => {
      setEvents((prev) => [event, ...prev]);
    });

    return () => {
      socket.disconnect();
    };
  }, [url]);

  return { events, connected };
}
