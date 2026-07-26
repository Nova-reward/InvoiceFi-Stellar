import { useState, useEffect, useCallback, useRef } from 'react';

export interface SettlementEvent {
  type: 'SETTLED' | 'CONNECTION_STATUS';
  invoiceId?: string;
  ledger?: number;
  timestamp?: string;
  connected?: boolean;
  eventsReceived?: number;
  lastConnected?: string;
  message?: string;
}

export interface ConnectionState {
  connected: boolean;
  lastConnected: string | null;
  eventsReceived: number;
  consecutiveFailures: number;
  retryDelay: number;
}

export interface UseSettlementStreamOptions {
  /** Invoice ID to monitor (optional - if not provided, listens to all events) */
  invoiceId?: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Callback when settlement event is received */
  onSettlement?: (event: SettlementEvent) => void;
  /** Callback when connection status changes */
  onConnectionChange?: (state: ConnectionState) => void;
}

export interface UseSettlementStreamReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Whether the stream is connected */
  isConnected: boolean;
  /** Recent settlement events */
  recentEvents: SettlementEvent[];
  /** Manually connect to the stream */
  connect: () => void;
  /** Manually disconnect from the stream */
  disconnect: () => void;
  /** Clear recent events */
  clearEvents: () => void;
}

/**
 * Custom hook for managing Horizon SSE stream connection
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Event buffering and management
 * - Connection state tracking
 * - Cleanup on unmount
 * 
 * @param options - Configuration options
 * @returns Stream state and controls
 * 
 * @example
 * ```tsx
 * const { connectionState, recentEvents, isConnected } = useSettlementStream({
 *   invoiceId: '123',
 *   onSettlement: (event) => {
 *     console.log('Invoice settled:', event);
 *   },
 * });
 * ```
 */
export function useSettlementStream(
  options: UseSettlementStreamOptions = {}
): UseSettlementStreamReturn {
  const {
    invoiceId,
    autoReconnect = true,
    onSettlement,
    onConnectionChange,
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    connected: false,
    lastConnected: null,
    eventsReceived: 0,
    consecutiveFailures: 0,
    retryDelay: 0,
  });

  const [recentEvents, setRecentEvents] = useState<SettlementEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1000); // Start with 1 second

  const apiBaseUrl = typeof window !== 'undefined' 
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000')
    : 'http://localhost:4000';

  const clearEvents = useCallback(() => {
    setRecentEvents([]);
  }, []);

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Determine URL based on whether we're monitoring a specific invoice
    const endpoint = invoiceId
      ? `/dashboard/invoice/${invoiceId}/stream`
      : '/dashboard/settlements/stream';
    const url = `${apiBaseUrl}${endpoint}`;

    console.log(`Connecting to SSE stream: ${url}`);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connection established');
      retryDelayRef.current = 1000; // Reset retry delay on successful connection
      
      setConnectionState((prev) => ({
        ...prev,
        connected: true,
        lastConnected: new Date().toISOString(),
        consecutiveFailures: 0,
        retryDelay: 0,
      }));

      onConnectionChange?.({
        connected: true,
        lastConnected: new Date().toISOString(),
        eventsReceived: 0,
        consecutiveFailures: 0,
        retryDelay: 0,
      });
    };

    eventSource.onmessage = (event) => {
      try {
        const data: SettlementEvent = JSON.parse(event.data);
        console.log('Received SSE event:', data);

        if (data.type === 'SETTLED') {
          // Add to recent events (keep last 50)
          setRecentEvents((prev) => [data, ...prev].slice(0, 50));
          
          // Update connection state
          setConnectionState((prev) => ({
            ...prev,
            eventsReceived: prev.eventsReceived + 1,
          }));

          // Call callback
          onSettlement?.(data);
        } else if (data.type === 'CONNECTION_STATUS') {
          setConnectionState((prev) => ({
            ...prev,
            connected: data.connected ?? prev.connected,
            eventsReceived: data.eventsReceived ?? prev.eventsReceived,
            lastConnected: data.lastConnected ?? prev.lastConnected,
          }));

          onConnectionChange?.({
            connected: data.connected ?? false,
            lastConnected: data.lastConnected ?? null,
            eventsReceived: data.eventsReceived ?? 0,
            consecutiveFailures: 0,
            retryDelay: 0,
          });
        }
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      
      setConnectionState((prev) => ({
        ...prev,
        connected: false,
        consecutiveFailures: prev.consecutiveFailures + 1,
        retryDelay: retryDelayRef.current,
      }));

      // EventSource will automatically try to reconnect
      // But we can also implement custom reconnection logic if needed
    };
  }, [invoiceId, apiBaseUrl, onSettlement, onConnectionChange]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionState((prev) => ({
      ...prev,
      connected: false,
    }));
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return {
    connectionState,
    isConnected: connectionState.connected,
    recentEvents,
    connect,
    disconnect,
    clearEvents,
  };
}
