import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface FreighterApi {
  getPublicKey: () => Promise<string | null>;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string, callback: (data: any) => void) => void;
}

/**
 * Hook to monitor Freighter wallet connection/disconnection events.
 * Clears session state and redirects to connect-wallet screen when wallet is disconnected externally.
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
      // If wallet disconnected (publicKey becomes null)
      if (publicKey === null) {
        // Clear session storage
        sessionStorage.removeItem('walletAddress');
        sessionStorage.removeItem('walletRole');

        // Clear localStorage (any cached wallet data)
        localStorage.removeItem('lastConnectedWallet');
        localStorage.removeItem('walletHistory');

        // Clear auth cookie by instructing the app to logout
        // The cookie will be cleared via the logout endpoint
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
          console.error('Failed to clear auth session:', error);
        }

        // Redirect to connect-wallet screen
        router.push('/connect-wallet');
      }
    },
    [router],
  );

  useEffect(() => {
    // Check if Freighter is available
    const freighter = (window as any).FreighterApi as FreighterApi | undefined;

    if (!freighter) {
      console.debug('Freighter not available');
      return;
    }

    // Listen for publicKeyChanged event from Freighter
    // This fires when user connects/disconnects wallet in the extension
    const handlePublicKeyChange = (publicKey: string | null) => {
      handleAccountChange(publicKey);
    };

    freighter.on('publicKeyChanged', handlePublicKeyChange);

    // Cleanup listener on unmount
    return () => {
      freighter.off('publicKeyChanged', handlePublicKeyChange);
    };
  }, [handleAccountChange]);
}
