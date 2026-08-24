'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { WalletAdapter } from '../lib/wallets/WalletAdapter';

export interface WalletState {
  walletAddress: string | null;
  role: 'FARMER' | 'INVESTOR' | 'ADMIN' | null;
  isConnected: boolean;
  isLoading: boolean;
  /** The active wallet adapter, or null when no wallet is connected. */
  activeAdapter: WalletAdapter | null;
}

interface WalletContextType extends WalletState {
  connect: (walletAddress: string, role: string, adapter?: WalletAdapter) => void;
  disconnect: () => void;
  setLoading: (loading: boolean) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    walletAddress: null,
    role: null,
    isConnected: false,
    isLoading: false,
    activeAdapter: null,
  });

  const connect = useCallback(
    (walletAddress: string, role: string, adapter?: WalletAdapter) => {
      setWalletState({
        walletAddress,
        role: (role as any) || 'FARMER',
        isConnected: true,
        isLoading: false,
        activeAdapter: adapter ?? null,
      });

      // Persist to session storage
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('walletAddress', walletAddress);
        sessionStorage.setItem('walletRole', role);
        if (adapter) {
          sessionStorage.setItem('walletAdapterName', adapter.name);
        }
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    setWalletState({
      walletAddress: null,
      role: null,
      isConnected: false,
      isLoading: false,
      activeAdapter: null,
    });

    // Clear session storage
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('walletRole');
      sessionStorage.removeItem('walletAdapterName');
      localStorage.removeItem('lastConnectedWallet');
    }
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setWalletState((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  return (
    <WalletContext.Provider
      value={{
        ...walletState,
        connect,
        disconnect,
        setLoading,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
