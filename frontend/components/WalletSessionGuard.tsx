'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFreighterListener } from '../hooks/useFreighterListener';
import { useWallet } from '../context/WalletContext';

/**
 * Component to handle wallet session validation and redirect on disconnect.
 * Should be placed at the root of protected routes (dashboard, etc).
 *
 * Features:
 * - Monitors Freighter wallet connection status
 * - Clears session state on external disconnect
 * - Redirects to connect-wallet screen when wallet is disconnected
 * - Handles 401 API responses
 */
export function WalletSessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { walletAddress, disconnect } = useWallet();

  // Monitor Freighter account changes
  useFreighterListener();

  useEffect(() => {
    // Intercept fetch to handle 401 responses
    const originalFetch = window.fetch;

    (window as any).fetch = async (...args: any[]) => {
      const response = await originalFetch(...args);

      // Handle 401 - wallet session expired
      if (response.status === 401) {
        // Check if this is a WALLET_SESSION_EXPIRED error
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          try {
            const data = await response.clone().json();
            if (data.error === 'WALLET_SESSION_EXPIRED') {
              // Clear wallet state
              disconnect();

              // Redirect to connect-wallet
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
