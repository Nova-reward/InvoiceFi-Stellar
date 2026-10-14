# Real-Time Invoice Status Dashboard

Comprehensive real-time monitoring system for invoice marketplace operations using Horizon SSE streaming with automatic reconnection logic.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Components](#components)
- [API Endpoints](#api-endpoints)
- [Frontend Integration](#frontend-integration)
- [Reconnection Logic](#reconnection-logic)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Monitoring & Observability](#monitoring--observability)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

The real-time dashboard provides instant visibility into invoice status changes by streaming events directly from the Stellar Horizon server. When an invoice is settled on-chain, the dashboard updates within seconds without requiring manual refresh.

### Key Features

- **Real-time SSE streaming** from Horizon event endpoint
- **Automatic reconnection** with exponential backoff and jitter
- **Connection state monitoring** with visual indicators
- **Event buffering** for reliable delivery
- **Multi-client support** - multiple dashboards can subscribe simultaneously
- **Invoice-specific filtering** - monitor individual invoices or all settlements
- **Fallback polling** - REST endpoints for historical data

## 🏗️ Architecture

```
┌─────────────────┐
│  Stellar Network│
│  (Soroban)      │
└────────┬────────┘
         │
         │ Emits InvoiceSettled events
         ▼
┌─────────────────┐
│  Horizon Server │
│  SSE Endpoint   │
└────────┬────────┘
         │
         │ Streams events via SSE
         ▼
┌─────────────────────────┐
│  HorizonStreamService   │
│  (Backend)              │
│  - Connects to Horizon  │
│  - Parses events        │
│  - Exponential backoff  │
│  - Event broadcasting   │
└────────┬────────────────┘
         │
         │ Emits to subscribers
         ▼
┌─────────────────────────┐
│  SSE Controllers        │
│  - /dashboard/invoice/:id/stream
│  - /dashboard/settlements/stream
└────────┬────────────────┘
         │
         │ SSE (Server-Sent Events)
         ▼
┌─────────────────────────┐
│  Frontend Dashboard     │
│  - useSettlementStream  │
│  - Real-time UI updates │
│  - Connection indicator │
└─────────────────────────┘
```

## 📦 Components

### Backend Components

#### 1. HorizonStreamService (`horizon-stream.service.ts`)

Core service that manages the SSE connection to Horizon.

**Responsibilities:**
- Establish and maintain SSE connection to Horizon
- Parse incoming events using `parseSettlementEvent`
- Implement exponential backoff reconnection (1s → 30s max)
- Track connection state and metrics
- Broadcast events to subscribers via EventEmitter

**Key Features:**
```typescript
interface StreamState {
  retryDelay: number;           // Current backoff delay
  consecutiveFailures: number;  // Failure counter
  connected: boolean;           // Connection status
  lastConnected: Date | null;   // Last successful connection
  eventsReceived: number;       // Total events received
}
```

**Reconnection Strategy:**
- Initial delay: 1 second
- Exponential backoff: `delay = min(delay * 2 + jitter, 30s)`
- Jitter: Random 0-1000ms to prevent thundering herd
- Max failures: 10 consecutive failures triggers alert

#### 2. SettlementDashboardController (`settlement-dashboard.controller.ts`)

NestJS controller exposing SSE endpoints.

**Endpoints:**
- `GET /dashboard/invoice/:invoiceId/stream` - Monitor specific invoice
- `GET /dashboard/settlements/stream` - Monitor all settlements
- `GET /dashboard/horizon/status` - Get connection status (REST)
- `GET /dashboard/settlements/recent` - Get recent events (REST)

**Event Format:**
```json
{
  "type": "SETTLED",
  "invoiceId": "123",
  "ledger": 12345678,
  "timestamp": "2026-01-26T10:30:00.000Z"
}
```

```json
{
  "type": "CONNECTION_STATUS",
  "connected": true,
  "eventsReceived": 42,
  "lastConnected": "2026-01-26T10:30:00.000Z"
}
```

#### 3. SettlementEventParser (`settlement-event.parser.ts`)

Parses raw Horizon events into structured `SettlementEvent` objects.

**Supported Event Formats:**
- Topic: `invoice_settled`, `invoicesettled`, `settled`
- Invoice ID extraction from topics or value payload
- Handles both scalar and object formats

### Frontend Components

#### 1. useSettlementStream Hook (`useSettlementStream.ts`)

Custom React hook for managing SSE connections.

**Features:**
- Automatic connection management
- Event buffering (last 50 events)
- Connection state tracking
- Cleanup on unmount
- Type-safe event handling

**Usage:**
```typescript
const { connectionState, recentEvents, isConnected } = useSettlementStream({
  invoiceId: '123',
  onSettlement: (event) => {
    console.log('Invoice settled:', event);
  },
  onConnectionChange: (state) => {
    console.log('Connection status:', state);
  },
});
```

#### 2. InvoiceStatusDashboard Component (`InvoiceStatusDashboard.tsx`)

Full-featured dashboard for monitoring invoice status.

**Features:**
- Invoice list with status badges
- Real-time event stream
- Connection status indicator
- Event history (last 10 events)
- Auto-refresh with polling fallback

## 🔌 API Endpoints

### SSE Endpoints

#### Stream Specific Invoice
```http
GET /dashboard/invoice/:invoiceId/stream
Accept: text/event-stream
Authorization: Bearer <token>
```

**Response:**
```
event: message
data: {"type":"CONNECTION_STATUS","connected":true,"eventsReceived":0}

event: message
data: {"type":"SETTLED","invoiceId":"123","ledger":12345678,"timestamp":"2026-01-26T10:30:00.000Z"}
```

#### Stream All Settlements
```http
GET /dashboard/settlements/stream
Accept: text/event-stream
Authorization: Bearer <token>
```

### REST Endpoints

#### Get Connection Status
```http
GET /dashboard/horizon/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "connected": true,
  "lastConnected": "2026-01-26T10:30:00.000Z",
  "eventsReceived": 42,
  "consecutiveFailures": 0,
  "retryDelay": 0
}
```

#### Get Recent Settlements
```http
GET /dashboard/settlements/recent?limit=50
Authorization: Bearer <token>
```

**Response:**
```json
{
  "events": [],
  "total": 0,
  "limit": 50,
  "message": "Historical events endpoint - implement database query"
}
```

## 🎨 Frontend Integration

### Basic Usage

```tsx
import { useSettlementStream } from '@/hooks/useSettlementStream';

function InvoiceMonitor({ invoiceId }: { invoiceId: string }) {
  const { connectionState, recentEvents, isConnected } = useSettlementStream({
    invoiceId,
    onSettlement: (event) => {
      // Handle settlement event
      console.log('Invoice settled:', event);
    },
  });

  return (
    <div>
      <div>Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</div>
      <div>Events received: {connectionState.eventsReceived}</div>
      {recentEvents.map((event, i) => (
        <div key={i}>Invoice {event.invoiceId} settled at ledger {event.ledger}</div>
      ))}
    </div>
  );
}
```

### Advanced Usage with Dashboard

```tsx
import { InvoiceStatusDashboard } from '@/components/InvoiceStatusDashboard';

function DashboardPage() {
  return <InvoiceStatusDashboard />;
}
```

### Manual Connection Control

```tsx
const { connect, disconnect, isConnected } = useSettlementStream({
  invoiceId: '123',
});

// Manually connect
<button onClick={connect}>Connect</button>

// Manually disconnect
<button onClick={disconnect}>Disconnect</button>

// Check status
<div>{isConnected ? 'Connected' : 'Disconnected'}</div>
```

## 🔄 Reconnection Logic

### Exponential Backoff Algorithm

```typescript
// Initial delay
let retryDelay = 1000; // 1 second

function scheduleReconnect() {
  // Exponential backoff with jitter
  retryDelay = Math.min(
    retryDelay * 2 + Math.random() * 1000,
    MAX_DELAY // 30 seconds
  );
  
  setTimeout(() => {
    reconnect();
  }, retryDelay);
}
```

### Reconnection Flow

```
1. Connection established ✅
   ↓
2. Stream active, receiving events 📡
   ↓
3. Connection lost ❌
   ↓
4. Wait 1s + jitter ⏱️
   ↓
5. Attempt reconnection 🔄
   ↓
6a. Success → Reset delay, continue ✅
   ↓
6b. Failure → Double delay, retry ⏱️
   ↓
7. Repeat until connected or max failures reached ⚠️
```

### Connection State Machine

```
                    ┌───────────┐
                    │ DISCONNECTED│
                    └─────┬─────┘
                          │
                    Connect()
                          ▼
                    ┌───────────┐
              ┌────►│ CONNECTING │
              │     └─────┬─────┘
              │           │
              │     Success/Fail
              │           │
              │     ┌─────▼─────┐
              └─────│ CONNECTED  │
                    └─────┬─────┘
                          │
                    Connection lost
                          ▼
                    ┌───────────┐
                    │ RECONNECTING│
                    └───────────┘
```

## ⚙️ Configuration

### Environment Variables

```bash
# Horizon Configuration
HORIZON_RETRY_BASE_MS=1000        # Initial retry delay (ms)
HORIZON_RETRY_MAX_MS=30000        # Maximum retry delay (ms)
HORIZON_MAX_FAILURES=10           # Max consecutive failures before alert

# Stellar Network
STELLAR_NETWORK=testnet           # testnet or mainnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org/events

# Settlement Sync (existing)
SETTLEMENT_POLL_INTERVAL_MS=5000   # Polling interval
SETTLEMENT_MAX_ATTEMPTS=3         # Max retry attempts
SETTLEMENT_RETRY_BASE_MS=500      # Base retry delay
```

### Module Registration

Add to `settlement.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { HorizonStreamService } from './horizon-stream.service';
import { SettlementDashboardController } from './settlement-dashboard.controller';

@Module({
  controllers: [SettlementDashboardController],
  providers: [HorizonStreamService],
  exports: [HorizonStreamService],
})
export class SettlementModule {}
```

## 📊 Usage Examples

### Example 1: Monitor Single Invoice

```typescript
// Backend - Controller
@Get('invoice/:invoiceId/stream')
@Sse('sse')
streamInvoice(@Param('invoiceId') invoiceId: string) {
  return this.horizonStream.onSettlementEvent((event) => {
    if (event.invoiceId === invoiceId) {
      return { data: { type: 'SETTLED', ...event } };
    }
  });
}

// Frontend - Component
const { isConnected } = useSettlementStream({
  invoiceId: '123',
  onSettlement: (event) => {
    alert(`Invoice ${event.invoiceId} settled!`);
  },
});
```

### Example 2: Admin Dashboard - All Settlements

```typescript
// Backend
@Get('settlements/stream')
@Sse('sse')
streamAllSettlements() {
  return this.horizonStream.onSettlementEvent((event) => {
    return { data: { type: 'SETTLED', ...event } };
  });
}

// Frontend
const { recentEvents } = useSettlementStream();
// Receives all settlement events
```

### Example 3: Connection Health Monitoring

```typescript
// Poll connection status
useQuery({
  queryKey: ['horizon-status'],
  queryFn: () => fetch('/dashboard/horizon/status').then(r => r.json()),
  refetchInterval: 3000,
});

// Display in UI
<div>
  <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
  <span>{connected ? 'Connected' : 'Disconnected'}</span>
  <span>Events: {eventsReceived}</span>
</div>
```

## 📈 Monitoring & Observability

### Metrics to Track

1. **Connection Metrics**
   - `connected` - Current connection status
   - `consecutiveFailures` - Failure counter
   - `retryDelay` - Current backoff delay
   - `lastConnected` - Last successful connection timestamp

2. **Event Metrics**
   - `eventsReceived` - Total events received
   - Events per minute
   - Event parsing success rate

3. **Performance Metrics**
   - Time to first event
   - Reconnection frequency
   - Average connection uptime

### Logging

The service logs important events:

```typescript
// Connection established
✅ Horizon stream connected

// Connection lost
❌ Horizon stream disconnected (consecutive failures: 3)

// Reconnection attempt
Reconnecting in 4000ms (attempt 3)

// Settlement event received
Settlement event received: invoice 123 at ledger 12345678

// Alert
⚠️  Horizon stream has failed 10 times consecutively. Check Horizon endpoint.
```

### Alerts

Configure alerts for:
- `consecutiveFailures >= 10` - Horizon endpoint unreachable
- `eventsReceived == 0` for > 5 minutes - No events flowing
- `retryDelay > 10000` - Persistent connection issues

## 🐛 Troubleshooting

### Common Issues

#### 1. Connection Refused
```
Error: Horizon stream failed: 404 Not Found
```

**Causes:**
- Incorrect Horizon URL
- Network/firewall blocking SSE
- Horizon server down

**Solutions:**
```bash
# Verify Horizon URL
curl https://horizon-testnet.stellar.org/events

# Check network connectivity
ping horizon-testnet.stellar.org

# Review firewall rules
```

#### 2. No Events Received
```
Events received: 0
```

**Causes:**
- No settlement events on network
- Wrong contract ID filter
- Cursor position issue

**Solutions:**
```bash
# Check contract ID in .env
echo $INVOICE_CONTRACT_ID

# Verify events exist
curl "https://horizon-testnet.stellar.org/events?cursor=now&limit=10"

# Check logs
grep "Settlement event received" logs/app.log
```

#### 3. Frequent Reconnections
```
Reconnecting in 16000ms (attempt 5)
```

**Causes:**
- Network instability
- Horizon rate limiting
- Server overload

**Solutions:**
```bash
# Increase retry delays
export HORIZON_RETRY_BASE_MS=2000
export HORIZON_RETRY_MAX_MS=60000

# Check Horizon status
curl https://horizon-testnet.stellar.org/
```

#### 4. High Memory Usage
```
FATAL: heap out of memory
```

**Causes:**
- Event buffer growing unbounded
- Memory leak in event handlers
- Too many concurrent connections

**Solutions:**
```typescript
// Limit event buffer size
setRecentEvents((prev) => [data, ...prev].slice(0, 50));

// Cleanup on unmount
useEffect(() => {
  return () => {
    eventSource.close();
  };
}, []);
```

## 🔒 Security Considerations

1. **Authentication**: All SSE endpoints require JWT authentication
2. **Authorization**: Users can only monitor invoices they have access to
3. **Rate Limiting**: SSE connections count towards rate limits
4. **CORS**: Configure CORS to allow SSE from frontend domain
5. **Input Validation**: Validate invoice IDs and cursor parameters

## 🚀 Performance Optimization

1. **Connection Pooling**: Reuse connections across multiple clients
2. **Event Filtering**: Filter at source to reduce bandwidth
3. **Compression**: Enable SSE compression for large events
4. **Caching**: Cache recent events in Redis for quick retrieval
5. **Load Balancing**: Distribute SSE connections across instances

## 📚 Additional Resources

- [Horizon SSE Documentation](https://developers.stellar.org/docs/data/horizon/api-reference/events/)
- [Server-Sent Events MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [Stellar Soroban Events](https://soroban.stellar.org/docs/smart-contracts/events)

## 🤝 Contributing

When extending the real-time dashboard:
1. Follow the existing service pattern
2. Add comprehensive error handling
3. Include reconnection logic for all network operations
4. Document event formats
5. Add TypeScript types for all events
6. Include frontend examples

---

**Last Updated:** 2026-01-26  
**Maintained by:** InvoiceFi-Stellar Team