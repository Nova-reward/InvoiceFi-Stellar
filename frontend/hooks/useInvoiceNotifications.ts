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

export function useInvoiceNotifications(
  url = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000',
): UseInvoiceNotificationsResult {
  const [events, setEvents] = useState<InvoiceEvent[]>([]);
  const [connected, setConnected] = useState(true); // Default true to prevent banner flash on mount
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Configure socket with exponential backoff up to 30 seconds
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,      // Start with 1 second delay
      reconnectionDelayMax: 30000,  // Max 30 seconds between attempts
      randomizationFactor: 0.5,
    });

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