'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Invoice status types matching the backend enum
 */
export type InvoiceStatus = 'PENDING' | 'FUNDED' | 'SETTLED' | 'EXPIRED';

export interface Invoice {
  id: string;
  ownerId: string;
  amount: number;
  currency: string;
  expiresAt: string;
  status: InvoiceStatus;
  contractId?: string;
  createdAt: string;
}

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

export interface HorizonStatus {
  connected: boolean;
  lastConnected: string | null;
  eventsReceived: number;
  consecutiveFailures: number;
  retryDelay: number;
}

/**
 * Real-time Invoice Status Dashboard Component
 * 
 * Features:
 * - Live SSE connection to backend for real-time settlement events
 * - Automatic reconnection with visual status indicator
 * - Invoice list with status badges
 * - Real-time updates when invoices are settled
 * - Connection health monitoring
 */
export function InvoiceStatusDashboard() {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<HorizonStatus | null>(null);
  const [recentEvents, setRecentEvents] = useState<SettlementEvent[]>([]);
  const queryClient = useQueryClient();

  // Fetch invoices list
  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: async (): Promise<Invoice[]> => {
      const response = await fetch('/api/invoices', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch invoices');
      return response.json();
    },
    refetchInterval: 5000, // Poll every 5 seconds as fallback
  });

  // Fetch Horizon connection status
  const { data: horizonStatus } = useQuery({
    queryKey: ['horizon-status'],
    queryFn: async (): Promise<HorizonStatus> => {
      const response = await fetch('/dashboard/horizon/status');
      if (!response.ok) throw new Error('Failed to fetch Horizon status');
      return response.json();
    },
    refetchInterval: 3000,
  });

  // Setup SSE connection for real-time updates
  useEffect(() => {
    if (!selectedInvoiceId) return;

    // Close existing connection
    if (eventSource) {
      eventSource.close();
    }

    // Create new SSE connection
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const url = `${apiBaseUrl}/dashboard/invoice/${selectedInvoiceId}/stream`;
    
    const newEventSource = new EventSource(url);
    setEventSource(newEventSource);

    newEventSource.onopen = () => {
      console.log('SSE connection established');
      setConnectionStatus({
        connected: true,
        lastConnected: new Date().toISOString(),
        eventsReceived: 0,
        consecutiveFailures: 0,
        retryDelay: 0,
      });
    };

    newEventSource.onmessage = (event) => {
      try {
        const data: SettlementEvent = JSON.parse(event.data);
        console.log('Received event:', data);

        if (data.type === 'SETTLED') {
          // Invoice was settled - update cache and show notification
          setRecentEvents((prev) => [data, ...prev].slice(0, 10));
          
          // Invalidate invoice query to refetch updated data
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
          
          // Show success notification
          showNotification(
            `Invoice ${data.invoiceId} settled at ledger ${data.ledger}`,
            'success'
          );
        } else if (data.type === 'CONNECTION_STATUS') {
          setConnectionStatus({
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

    newEventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      setConnectionStatus((prev) => ({
        ...prev,
        connected: false,
        consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
      }));
      
      // EventSource will automatically attempt to reconnect
      // We just update the UI to show the disconnected state
    };

    // Cleanup on unmount
    return () => {
      newEventSource.close();
      setEventSource(null);
    };
  }, [selectedInvoiceId, queryClient]);

  // Listen to all settlements stream (for admin view)
  useEffect(() => {
    if (!selectedInvoiceId) return;

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const url = `${apiBaseUrl}/dashboard/settlements/stream`;
    
    const allEventsSource = new EventSource(url);

    allEventsSource.onmessage = (event) => {
      try {
        const data: SettlementEvent = JSON.parse(event.data);
        if (data.type === 'SETTLED') {
          setRecentEvents((prev) => [data, ...prev].slice(0, 10));
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
        }
      } catch (error) {
        console.error('Failed to parse settlement event:', error);
      }
    };

    return () => {
      allEventsSource.close();
    };
  }, [selectedInvoiceId, queryClient]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    // Implement your notification system here
    console.log(`[${type.toUpperCase()}] ${message}`);
    alert(message); // Replace with proper notification component
  };

  const getStatusColor = (status: InvoiceStatus): string => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'FUNDED':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'SETTLED':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'EXPIRED':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatCurrency = (amount: number, currency: string): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency === 'USDC' ? 'USD' : currency,
      minimumFractionDigits: 2,
    }).format(amount / 100); // Assuming amount is in cents
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Invoice Status Dashboard
          </h1>
          <p className="text-gray-600">
            Real-time monitoring of invoice marketplace operations
          </p>
        </div>

        {/* Connection Status */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Horizon Stream Status</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connectionStatus?.connected ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {connectionStatus?.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {connectionStatus?.lastConnected && (
              <span className="text-sm text-gray-500">
                Last connected: {formatDate(connectionStatus.lastConnected)}
              </span>
            )}
            {connectionStatus?.eventsReceived !== undefined && (
              <span className="text-sm text-gray-500">
                Events received: {connectionStatus.eventsReceived}
              </span>
            )}
          </div>
        </div>

        {/* Invoice Selection */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Select Invoice to Monitor</h2>
          {invoicesLoading ? (
            <div className="text-gray-500">Loading invoices...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {invoices?.map((invoice) => (
                <button
                  key={invoice.id}
                  onClick={() => setSelectedInvoiceId(invoice.id)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedInvoiceId === invoice.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-mono text-sm text-gray-600">
                      #{invoice.id}
                    </span>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(
                        invoice.status
                      )}`}
                    >
                      {invoice.status}
                    </span>
                  </div>
                  <div className="text-lg font-semibold mb-1">
                    {formatCurrency(invoice.amount, invoice.currency)}
                  </div>
                  <div className="text-sm text-gray-500">
                    Expires: {formatDate(invoice.expiresAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Real-time Events */}
        {selectedInvoiceId && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">
              Real-time Events for Invoice #{selectedInvoiceId}
            </h2>
            {recentEvents.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                Waiting for events... SSE stream is active.
              </div>
            ) : (
              <div className="space-y-2">
                {recentEvents.map((event, index) => (
                  <div
                    key={index}
                    className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                        {event.type}
                      </span>
                      {event.timestamp && (
                        <span className="text-sm text-gray-500">
                          {formatDate(event.timestamp)}
                        </span>
                      )}
                    </div>
                    {event.invoiceId && (
                      <div className="text-sm">
                        Invoice: <span className="font-mono">{event.invoiceId}</span>
                      </div>
                    )}
                    {event.ledger && (
                      <div className="text-sm">
                        Ledger: <span className="font-mono">{event.ledger}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            How to Use
          </h3>
          <ul className="list-disc list-inside text-blue-800 space-y-1">
            <li>Select an invoice from the list above to start monitoring</li>
            <li>The SSE stream will automatically connect and listen for settlement events</li>
            <li>When an invoice is settled, you'll see a real-time notification</li>
            <li>The connection automatically reconnects if it drops</li>
            <li>Green dot = connected, Red dot = disconnected</li>
          </ul>
        </div>
      </div>
    </div>
  );
}