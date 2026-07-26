import { Controller, Get, Param, Query, Sse, MessageEvent } from '@nestjs/common';
import { Observable, interval, mergeMap, filter, map, takeUntil } from 'rxjs';
import { HorizonStreamService } from './horizon-stream.service';
import { SettlementEvent } from './types';

/**
 * SSE endpoint for real-time invoice status updates.
 * Clients can subscribe to receive instant notifications when invoices are settled.
 */
@Controller('dashboard')
export class SettlementDashboardController {
  constructor(private readonly horizonStream: HorizonStreamService) {}

  /**
   * Stream real-time settlement events for a specific invoice.
   * 
   * @param invoiceId - The invoice ID to monitor
   * @returns Observable stream of settlement events
   * 
   * @example
   * // Client-side JavaScript
   * const eventSource = new EventSource('/dashboard/invoice/123/stream');
   * eventSource.onmessage = (event) => {
   *   const data = JSON.parse(event.data);
   *   console.log('Invoice settled:', data);
   * };
   */
  @Get('invoice/:invoiceId/stream')
  @Sse('sse')
  streamInvoiceStatus(@Param('invoiceId') invoiceId: string): Observable<MessageEvent> {
    this.horizonStream.startStreaming();

    return new Observable((subscriber) => {
      // Subscribe to settlement events
      const unsubscribe = this.horizonStream.onSettlementEvent((event) => {
        if (event.invoiceId === invoiceId) {
          subscriber.next({
            data: {
              type: 'SETTLED',
              invoiceId: event.invoiceId,
              ledger: event.ledger,
              timestamp: new Date().toISOString(),
            } as SettlementEvent,
          } as MessageEvent);
        }
      });

      // Subscribe to connection state changes
      const unsubscribeConnection = this.horizonStream.onConnectionChange((state) => {
        subscriber.next({
          data: {
            type: 'CONNECTION_STATUS',
            connected: state.connected,
            eventsReceived: state.eventsReceived,
            lastConnected: state.lastConnected?.toISOString(),
          },
        } as MessageEvent);
      });

      // Send initial connection status
      subscriber.next({
        data: {
          type: 'CONNECTION_STATUS',
          connected: this.horizonStream.getState().connected,
          eventsReceived: 0,
          message: 'Stream initialized',
        },
      } as MessageEvent);

      // Cleanup on unsubscribe
      return () => {
        unsubscribe();
        unsubscribeConnection();
      };
    });
  }

  /**
   * Stream all settlement events (for admin/monitoring dashboards).
   * 
   * @returns Observable stream of all settlement events
   */
  @Get('settlements/stream')
  @Sse('sse')
  streamAllSettlements(): Observable<MessageEvent> {
    this.horizonStream.startStreaming();

    return new Observable((subscriber) => {
      const unsubscribe = this.horizonStream.onSettlementEvent((event) => {
        subscriber.next({
          data: {
            type: 'SETTLED',
            invoiceId: event.invoiceId,
            ledger: event.ledger,
            timestamp: new Date().toISOString(),
          } as SettlementEvent,
        } as MessageEvent);
      });

      const unsubscribeConnection = this.horizonStream.onConnectionChange((state) => {
        subscriber.next({
          data: {
            type: 'CONNECTION_STATUS',
            connected: state.connected,
            eventsReceived: state.eventsReceived,
            lastConnected: state.lastConnected?.toISOString(),
          },
        } as MessageEvent);
      });

      subscriber.next({
        data: {
          type: 'CONNECTION_STATUS',
          connected: this.horizonStream.getState().connected,
          eventsReceived: 0,
          message: 'Stream initialized',
        },
      } as MessageEvent);

      return () => {
        unsubscribe();
        unsubscribeConnection();
      };
    });
  }

  /**
   * Get current Horizon stream status (REST endpoint for polling).
   * 
   * @returns Connection state and statistics
   */
  @Get('horizon/status')
  getHorizonStatus() {
    const state = this.horizonStream.getState();
    return {
      connected: state.connected,
      lastConnected: state.lastConnected?.toISOString(),
      eventsReceived: state.eventsReceived,
      consecutiveFailures: state.consecutiveFailures,
      retryDelay: state.retryDelay,
    };
  }

  /**
   * Get recent settlement events (REST endpoint for historical data).
   * 
   * @param limit - Maximum number of events to return (default: 50)
   * @returns Array of recent settlement events
   */
  @Get('settlements/recent')
  getRecentSettlements(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    
    // This would query the database for recent settlements
    // For now, return a placeholder
    return {
      events: [],
      total: 0,
      limit: limitNum,
      message: 'Historical events endpoint - implement database query',
    };
  }
}