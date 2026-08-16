'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../context/WalletContext';
import { WALLET_ADAPTERS } from '../lib/wallets';

/**
 * Component to handle wallet session validation and redirect on disconnect.
 * Should be placed at the root of protected routes (dashboard, etc).
 *
 * Features:
 * - Monitors the active wallet adapter for account-change / disconnect events
 * - Falls back to watching all known adapters when no adapter is stored in
 *   context (e.g. on hard-reload before context is re-hydrated)
 * - Clears session state on external disconnect
 * - Redirects to connect-wallet screen when wallet is disconnected
 * - Handles 401 API responses
 * - No hardcoded Freighter references — works for any WalletAdapter
 */
export function WalletSessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { walletAddress, disconnect, activeAdapter } = useWallet();

  // Watch whichever adapter is currently active (or all available ones as a
  // fallback) for external account-change / disconnect events.
  useEffect(() => {
    const adaptersToWatch = activeAdapter ? [activeAdapter] : WALLET_ADAPTERS;

    const unsubscribers = adaptersToWatch.map((adapter) =>
      adapter.watchAccountChange(async (publicKey) => {
        if (publicKey === null) {
          sessionStorage.removeItem('walletAddress');
          sessionStorage.removeItem('walletRole');
          sessionStorage.removeItem('walletAdapterName');
          localStorage.removeItem('lastConnectedWallet');
          localStorage.removeItem('walletHistory');

          try {
            await fetch('/api/auth/logout', { method: 'POST' });
          } catch (err) {
            console.error('Failed to clear auth session:', err);
          }

          disconnect();
          router.push('/connect-wallet');
        }
      }),
    );

    return () => unsubscribers.forEach((fn) => fn());
  }, [activeAdapter, disconnect, router]);

  // Intercept fetch to handle 401 responses
  useEffect(() => {
    const originalFetch = window.fetch;

    (window as any).fetch = async (...args: any[]) => {
      const response = await originalFetch(...args);

      if (response.status === 401) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          try {
            const data = await response.clone().json();
            if (data.error === 'WALLET_SESSION_EXPIRED') {
              disconnect();
              router.push('/connect-wallet');
            }
          } catch (error) {
            console.error('Failed to parse 401 response:', error);
          }
        }
      }

      return response;
    };

    return () => {
      (window as any).fetch = originalFetch;
    };
  }, [router, disconnect]);

  // Verify wallet is still connected
  useEffect(() => {
    if (!walletAddress) {
      router.push('/connect-wallet');
      return;
    }
  }, [walletAddress, router]);

  return <>{children}</>;
}
