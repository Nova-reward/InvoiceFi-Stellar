'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface WalletState {
  walletAddress: string | null;
  role: 'FARMER' | 'INVESTOR' | 'ADMIN' | null;
  isConnected: boolean;
  isLoading: boolean;
}

interface WalletContextType extends WalletState {
  connect: (walletAddress: string, role: string) => void;
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
  });

  const connect = useCallback((walletAddress: string, role: string) => {
    setWalletState({
      walletAddress,
      role: (role as any) || 'FARMER',
      isConnected: true,
      isLoading: false,
    });

    // Persist to session storage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('walletAddress', walletAddress);
      sessionStorage.setItem('walletRole', role);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWalletState({
      walletAddress: null,
      role: null,
      isConnected: false,
      isLoading: false,
    });

    // Clear session storage
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('walletRole');
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
