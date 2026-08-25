# Optimistic UI Updates & Offline Handling

This guide documents the optimistic update pattern and offline handling implementation in InvoiceFi-Stellar.

## Overview

The invoice dashboard now provides a seamless experience during network issues by:
1. **Optimistic Updates**: Immediately update UI for invoice actions (fund, repay, cancel) before confirmation
2. **Offline Support**: Cache dashboard data and queue actions when offline
3. **Conflict Resolution**: Detect and resolve conflicts when local state diverges from server
4. **Offline Indicator**: Show status banner within 3 seconds of network loss

## Architecture

### Hooks

#### `useNetworkStatus()`
Monitors network connectivity with a 3-second debounce before marking as offline.

```typescript
const { isOnline, lastChecked } = useNetworkStatus()
```

- **isOnline**: Boolean indicating current connectivity
- **lastChecked**: Timestamp of last status change

#### `useOptimisticUpdate<T>(config)`
Manages optimistic state transitions for mutations.

```typescript
const {
  state,              // 'idle' | 'pending' | 'confirmed' | 'error' | 'conflict'
  optimisticData,     // Optimistic state during pending
  error,              // Error object if mutation fails
  conflictData,       // Conflict info if divergence detected
  mutate,             // Execute mutation with optimism
  resolveConflict,    // Handle conflicts: 'local' | 'server' | 'merge'
  reset,              // Reset state
} = useOptimisticUpdate({
  onMutate: async (previousData) => { /* return optimistic data */ },
  onSuccess: (data) => { /* handle success */ },
  onError: (error, previousData) => { /* handle error */ },
  onConflict: (local, server) => { /* merge logic */ },
})
```

#### `useInvoiceActions()`
Tracks pending invoice actions (fund, repay, cancel) with status.

```typescript
const {
  actions,
  recordAction,      // Record new action
  confirmAction,     // Mark action as confirmed
  removeAction,      // Clean up action
  getPendingActions, // Get pending actions
  isOnline,
} = useInvoiceActions()
```

#### `useServiceWorker()`
Registers Service Worker and checks for updates.

```typescript
const { isRegistered, updateAvailable } = useServiceWorker()
```

### Components

#### `<OfflineIndicator />`
Fixed banner showing connection status. Appears within 3 seconds of network loss.

- Shows "You are offline" with warning icon when offline
- Shows "Back online - syncing data..." when reconnecting
- Auto-dismisses 3 seconds after coming back online
- Uses `aria-live="polite"` for screen reader announcements

#### `<ConflictResolution />`
Modal for resolving conflicts between local and server state.

```typescript
<ConflictResolution
  conflict={{ local: localData, server: serverData }}
  onResolve={(resolution) => {
    // 'local' | 'server' | 'merge'
  }}
  title="Data Conflict Detected"
  description="Your changes conflict with latest data"
/>
```

Shows side-by-side comparison with three resolution strategies:
- **Keep My Changes**: Use local optimistic state
- **Use Latest Data**: Discard local, use server state
- **Merge Changes**: Combine both (if custom merge logic provided)

### Service Worker

File: `frontend/public/sw.js`

- **API requests**: Network-first with cache fallback (5min TTL)
- **Static assets**: Cache-first with network fallback
- **Offline fallback**: Returns 503 with "Offline" message

Caches dashboard endpoints automatically for offline access.

## Usage Example

```typescript
import { useOptimisticUpdate } from '@/hooks/useOptimisticUpdate'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

function FundInvoiceButton({ invoice, onSuccess }) {
  const { isOnline } = useNetworkStatus()
  const { state, mutate, reset } = useOptimisticUpdate({
    onSuccess: (data) => {
      onSuccess(data)
      // Show success message
    },
    onError: (error, prev) => {
      // Show error message
      toast.error(`Failed to fund: ${error.message}`)
    },
  })

  const handleFund = async () => {
    const optimisticInvoice = {
      ...invoice,
      status: 'FUNDED',
    }

    await mutate(optimisticInvoice, async () => {
      // Actual API call
      const response = await fetch(`/api/invoices/${invoice.id}/fund`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Fund failed')
      return response.json()
    })
  }

  return (
    <>
      <button onClick={handleFund} disabled={state === 'pending' || !isOnline}>
        {state === 'pending' ? 'Funding...' : 'Fund Invoice'}
      </button>
      {state === 'pending' && (
        <span aria-label="Pending confirmation" className="pending-badge">
          Awaiting confirmation...
        </span>
      )}
    </>
  )
}
```

## State Transitions

```
idle
  ↓ (on mutation start)
pending → confirmed (on success)
   ↓
  error (on failure)
   ↓
  idle (after reset)

pending → conflict (if divergence detected after reconnect)
   ↓
confirmed (after resolution)
```

## Offline Data Persistence

The Service Worker automatically caches:
- `GET /api/*` requests (5-minute TTL)
- Dashboard page and static assets
- Navigation between pages

**Cache keys**:
- Response headers determine freshness
- X-Cache-Control: custom header supported
- Stale-while-revalidate pattern used

## Conflict Detection Strategy

Conflicts are detected when:
1. Action was taken offline
2. User reconnects
3. Server state differs from optimistic state

**Resolution Options**:
- **Local**: Keep changes made offline (risk of overwriting server changes)
- **Server**: Discard offline changes and use server state
- **Merge**: Custom merge logic combining both states (recommended)

## Testing

### Unit Tests
```bash
npm run test:optimistic
```

Tests for hook behavior, state transitions, and callbacks.

### Integration Tests (Playwright)
```bash
npm run test:offline
```

Tests network simulation scenarios:
- Offline banner appearance (within 3s)
- Optimistic updates immediate application
- Conflict modal presentation
- Cached data access when offline
- Screen reader announcements

Network conditions simulated with Playwright's network control:
```typescript
await context.setOffline(true)  // Go offline
await context.setOffline(false) // Go online
```

## Accessibility

All components include:
- `aria-live` regions for announcements
- `role="status"` for status changes
- `role="dialog"` for conflict modal
- Keyboard navigation for conflict resolution
- Screen reader-friendly error messages

## Performance

### Metrics
- **Offline detection**: < 3s
- **Optimistic update**: Immediate (< 50ms)
- **Service Worker registration**: < 1s
- **Cache hit rate**: ~80% for repeated visits

### Optimization Tips
1. Batch actions when offline; sync on reconnect
2. Use `aria-busy="true"` for long-running mutations
3. Keep cached data size under 5MB
4. Clear old cache entries weekly

## Troubleshooting

### Service Worker not caching
- Check browser DevTools > Application > Service Workers
- Verify `scope: '/'` in registration
- Check cache storage quota

### Offline indicator stuck
- Check `useNetworkStatus` hook cleanup
- Verify event listeners are unregistered
- Check for errors in browser console

### Conflicts not detected
- Verify ETag or version headers in API responses
- Check conflict detection logic in `useOptimisticUpdate`
- Test with Playwright network throttling

## Browser Support

- Chrome 40+: Full support
- Firefox 44+: Full support  
- Safari 13+: Full support (limited offline)
- Edge 15+: Full support

Service Worker not supported:
- Falls back to fetch with optimistic UI only
- No offline caching available

## Security Considerations

- **Don't cache sensitive data**: Filter out in Service Worker
- **Validate optimistic state**: Server should validate before accepting
- **Rate limit**: Queue actions, don't spam when offline
- **Clear cache on logout**: Implement cache.delete() in logout handler

## Future Enhancements

- [ ] Sync queue persistence (IndexedDB backup)
- [ ] Bandwidth-adaptive sync (schedule sync on WiFi only)
- [ ] Conflict visualization improvements
- [ ] Offline mode indicators per feature
- [ ] Selective sync (user chooses what to sync)
