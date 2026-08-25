import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FreighterAdapter } from '../lib/wallets/FreighterAdapter';

const freighterAdapter = new FreighterAdapter();

/**
 * Hook to monitor Freighter wallet connection/disconnection events.
 * Clears session state and redirects to connect-wallet screen when wallet is
 * disconnected externally.
 *
 * Delegates to FreighterAdapter so no wallet-specific API is accessed here.
 *
 * Usage:
 * ```
 * export default function Dashboard() {
 *   useFreighterListener();
 *   // ... rest of component
 * }
 * ```
 */
export function useFreighterListener() {
  const router = useRouter();

  const handleAccountChange = useCallback(
    async (publicKey: string | null) => {
      if (publicKey === null) {
        sessionStorage.removeItem('walletAddress');
        sessionStorage.removeItem('walletRole');
        sessionStorage.removeItem('walletAdapterName');

        localStorage.removeItem('lastConnectedWallet');
        localStorage.removeItem('walletHistory');

        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
          console.error('Failed to clear auth session:', error);
        }

        router.push('/connect-wallet');
      }
    },
    [router],
  );

  useEffect(() => {
    if (!freighterAdapter.isAvailable()) {
      console.debug('Freighter not available');
      return;
    }

    // Delegate event subscription to the adapter
    const unsubscribe = freighterAdapter.watchAccountChange(handleAccountChange);
    return unsubscribe;
  }, [handleAccountChange]);
}
