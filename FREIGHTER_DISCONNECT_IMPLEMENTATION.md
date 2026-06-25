# Freighter Disconnect Handling Implementation Guide

## Overview

This implementation adds proper handling for external wallet disconnections in the InvoiceFi-Stellar application. When a user disconnects their Freighter wallet from the extension itself (not using the app's disconnect button), the application now:

1. **Detects the disconnect** via Freighter's `publicKeyChanged` event
2. **Clears session state** from sessionStorage and localStorage
3. **Returns clear 401 errors** with `WALLET_SESSION_EXPIRED` code from the backend
4. **Redirects to the connect-wallet screen** automatically
5. **Intercepts 401 API responses** and handles them gracefully

## Changes Made

### Backend (NestJS)

#### 1. **New Global Exception Filter** (`backend/src/common/unauthorized.filter.ts`)
- Catches `UnauthorizedException` from Passport.js
- Returns standardized 401 response with `WALLET_SESSION_EXPIRED` error code
- Provides clear error messages for debugging

#### 2. **Updated JWT Strategy** (`backend/src/auth/jwt.strategy.ts`)
- Enhanced validation to check for required token fields
- Better error messages for invalid tokens
- Includes wallet address in validated payload

#### 3. **Updated Auth Controller** (`backend/src/auth/auth.controller.ts`)
- Added `POST /auth/connect-wallet` endpoint with secure cookie handling
- Added `POST /auth/logout` endpoint to clear authentication cookie
- Sets HTTP-only, secure cookies for JWT tokens

#### 4. **Global Filter Registration** (`backend/src/main.ts`)
- Registers `UnauthorizedExceptionFilter` globally
- Ensures all 401 responses follow the standardized format

#### 5. **Error Enum Update** (`backend/src/common/contract-error.ts`)
- Added `WalletSessionExpired` to error codes
- Mapped to HTTP 401 status in error filter

### Frontend (Next.js)

#### 1. **Freighter Listener Hook** (`frontend/hooks/useFreighterListener.ts`)
- Monitors Freighter's `publicKeyChanged` event
- Detects when wallet is disconnected externally
- Clears all session data when disconnect detected
- Calls logout endpoint to clear backend session
- Uses `next/navigation` router for redirects

#### 2. **Wallet Context** (`frontend/context/WalletContext.tsx`)
- Centralized wallet state management
- Provides `connect` and `disconnect` methods
- Manages loading states for async operations
- Persists wallet info to sessionStorage

#### 3. **Wallet Session Guard** (`frontend/components/WalletSessionGuard.tsx`)
- Client component for protected routes
- Intercepts all fetch calls to detect 401 responses
- Automatically disconnects wallet on `WALLET_SESSION_EXPIRED` error
- Redirects to connect-wallet screen on disconnection

#### 4. **API Client** (`frontend/lib/apiClient.ts`)
- Helper function for authenticated API calls
- Automatically adds JWT token from cookies
- Handles 401 responses with proper state cleanup
- Provides typed error responses

#### 5. **Connect Wallet Page** (`frontend/app/connect-wallet/page.tsx`)
- New page for initial wallet connection
- Supports role selection (Farmer/Investor)
- Communicates with Freighter extension
- Handles connection errors gracefully

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Freighter Extension                     │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │ publicKeyChanged Event                     │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│                 ▼                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │   useFreighterListener Hook                      │   │
│  │   - Detects disconnect (publicKey=null)         │   │
│  │   - Clears sessionStorage/localStorage          │   │
│  │   - Calls /auth/logout endpoint                 │   │
│  │   - Router.push('/connect-wallet')              │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │   WalletSessionGuard Component                   │   │
│  │   - Intercepts fetch calls                      │   │
│  │   - Detects 401 + WALLET_SESSION_EXPIRED       │   │
│  │   - Triggers disconnect flow                    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │   WalletContext (State Management)               │   │
│  │   - walletAddress                               │   │
│  │   - role (FARMER/INVESTOR/ADMIN)                │   │
│  │   - isConnected                                 │   │
│  │   - connect/disconnect methods                  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
                         │ API calls with JWT
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Backend (NestJS)                           │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │   JwtAuthGuard                                   │   │
│  │   └─▶ JwtStrategy.validate()                    │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│         ┌───────┴────────┐                              │
│         │                │                              │
│      Valid           Invalid/Expired                    │
│         │                │                              │
│         ▼                ▼                              │
│  ┌──────────┐    ┌─────────────────────────────────┐   │
│  │ Proceed  │    │ Throw UnauthorizedException     │   │
│  │ Request  │    │         ▼                       │   │
│  └──────────┘    │ UnauthorizedExceptionFilter     │   │
│                  │ - Status 401                    │   │
│                  │ - error: WALLET_SESSION_EXPIRED │   │
│                  │ - Clear-Cookie: token           │   │
│                  └─────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│                  ┌──────────────────┐                   │
│                  │ Frontend receives│                   │
│                  │ 401 response     │                   │
│                  │ Triggers redirect│                   │
│                  └──────────────────┘                   │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Integration Steps

### Step 1: Update Root Layout with WalletProvider

```tsx
// app/layout.tsx
import { WalletProvider } from '../context/WalletContext';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
```

### Step 2: Wrap Protected Routes with WalletSessionGuard

```tsx
// app/dashboard/layout.tsx
import { WalletSessionGuard } from '../../components/WalletSessionGuard';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletSessionGuard>
      {children}
    </WalletSessionGuard>
  );
}
```

### Step 3: Verify Backend Configuration

Ensure the following environment variables are set:

```bash
# Backend
JWT_SECRET=your-secret-key-here
NODE_ENV=production  # For secure cookies

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000  # Backend URL
```

## Testing Guide

### Manual Testing

#### Scenario 1: User Disconnects Wallet Externally
1. Connect wallet using the connect-wallet page
2. Navigate to dashboard
3. Open Freighter extension and manually disconnect wallet
4. Observe automatic redirect to connect-wallet page
5. Verify no wallet state persists in sessionStorage/localStorage

#### Scenario 2: Token Expiration During Active Session
1. Connect wallet
2. Navigate to dashboard
3. Manually delete/expire JWT token in storage
4. Attempt any API call (e.g., fetch invoices)
5. Observe 401 response with `WALLET_SESSION_EXPIRED` code
6. Verify automatic redirect to connect-wallet
7. Verify cookie is cleared

#### Scenario 3: Stale Token After Backend Restart
1. Connect wallet
2. Restart backend (invalidates all tokens)
3. Attempt API call from dashboard
4. Observe 401 + redirect flow

#### Scenario 4: User Manually Disconnects
1. Add disconnect button to dashboard
2. Call `useWallet().disconnect()` on click
3. Verify clean state and redirect

### Automated Testing

#### Frontend Tests (with Jest/Vitest)

```typescript
describe('useFreighterListener', () => {
  it('should clear session on wallet disconnect', async () => {
    // Mock Freighter
    window.FreighterApi = {
      on: jest.fn((event, callback) => {
        if (event === 'publicKeyChanged') {
          callback(null); // Simulate disconnect
        }
      }),
    };

    // Test that sessionStorage is cleared
    sessionStorage.setItem('walletAddress', 'test');
    render(<TestComponent />);
    
    await waitFor(() => {
      expect(sessionStorage.getItem('walletAddress')).toBeNull();
    });
  });

  it('should redirect to connect-wallet on disconnect', async () => {
    // Mock router and Freighter
    const mockPush = jest.fn();
    useRouter.mockReturnValue({ push: mockPush });

    render(<TestComponent />);
    
    // Simulate Freighter disconnect
    window.FreighterApi.on.mock.calls[0][1](null);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/connect-wallet');
    });
  });
});
```

#### Backend Tests (with Jest)

```typescript
describe('JwtStrategy', () => {
  it('should throw on invalid role', async () => {
    const strategy = new JwtStrategy();
    
    expect(() => {
      strategy.validate({ sub: 1, role: 'INVALID' });
    }).toThrow(UnauthorizedException);
  });

  it('should throw on missing wallet address', async () => {
    const strategy = new JwtStrategy();
    
    expect(() => {
      strategy.validate({ sub: 1, role: 'farmer' });
    }).toThrow(UnauthorizedException);
  });
});

describe('UnauthorizedExceptionFilter', () => {
  it('should return 401 with WALLET_SESSION_EXPIRED code', () => {
    const filter = new UnauthorizedExceptionFilter();
    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
    };

    filter.catch(new UnauthorizedException('Test'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'WALLET_SESSION_EXPIRED',
      })
    );
  });
});
```

## API Endpoints

### 1. Connect Wallet
**POST** `/auth/connect-wallet`

Request:
```json
{
  "walletAddress": "GABC...XYZ",
  "role": "FARMER" | "INVESTOR" | "ADMIN"
}
```

Response (200 OK):
```json
{
  "accessToken": "eyJhbGc...",
  "walletAddress": "GABC...XYZ",
  "role": "FARMER"
}
```

Set-Cookie: `token=eyJhbGc...; HttpOnly; Secure; SameSite=Strict`

### 2. Get Profile
**GET** `/auth/profile`

Headers: `Authorization: Bearer <token>`

Response (200 OK):
```json
{
  "userId": 1,
  "walletAddress": "GABC...XYZ",
  "role": "FARMER"
}
```

Response (401 Unauthorized):
```json
{
  "statusCode": 401,
  "error": "WALLET_SESSION_EXPIRED",
  "message": "Invalid or missing role in token"
}
```

### 3. Logout
**POST** `/auth/logout`

Response (200 OK):
```json
{
  "message": "Logout successful"
}
```

Set-Cookie: `token=; Max-Age=0`

## Acceptance Criteria Verification

✅ **Poll or listen for Freighter account changes and clear session state on disconnect**
- Implemented via `useFreighterListener` hook
- Listens to `publicKeyChanged` event
- Clears sessionStorage, localStorage, and auth cookie

✅ **Redirect user to the connect-wallet screen when the wallet address becomes null**
- Implemented in `useFreighterListener` hook
- Uses Next.js router to push `/connect-wallet`
- Also implemented in `WalletSessionGuard` for fallback

✅ **NestJS backend returns a clear 401 with WALLET_SESSION_EXPIRED code for stale tokens**
- Implemented via `UnauthorizedExceptionFilter`
- Returns 401 status code
- Response includes `error: 'WALLET_SESSION_EXPIRED'`

✅ **No residual wallet state persists in localStorage after disconnect**
- `useFreighterListener` removes: `lastConnectedWallet`, `walletHistory`
- `WalletContext` removes: `walletAddress`, `walletRole`
- Backend clears token cookie on logout

## Troubleshooting

### Issue: Freighter listener not detecting disconnect
- Ensure Freighter extension is properly installed
- Check browser console for "Freighter not available" message
- Verify `window.FreighterApi` is accessible after Freighter injection

### Issue: Redirect not happening after 401
- Check that `WalletSessionGuard` wraps the dashboard routes
- Verify fetch interception is working (check Network tab in DevTools)
- Ensure router instance is available in component context

### Issue: Token not being set in cookies
- Verify backend is setting cookies with correct options
- Check `NODE_ENV` - secure cookies require HTTPS in production
- Use DevTools Application tab to verify cookie is present

### Issue: Session state not clearing
- Verify `sessionStorage` is not browser-private mode
- Check that all storage keys are being removed in logout flow
- Debug: log to console before/after storage operations

## Security Considerations

1. **Token Storage**: Tokens are stored in HTTP-only cookies, preventing XSS access
2. **Role Validation**: JWT strategy validates role on every request
3. **CORS**: Ensure CORS is properly configured for wallet operations
4. **Token Expiration**: JWT tokens expire after 7 days, requiring re-authentication
5. **Secure Cookies**: Cookies marked as Secure (HTTPS only) in production
6. **SameSite Protection**: Cookies marked as SameSite=Strict to prevent CSRF

## Future Enhancements

1. Add refresh token mechanism for extended sessions
2. Implement token blacklist on logout
3. Add session timeout warnings before expiration
4. Support multiple wallet types beyond Freighter
5. Add audit logging for disconnect events
6. Implement device fingerprinting for security
