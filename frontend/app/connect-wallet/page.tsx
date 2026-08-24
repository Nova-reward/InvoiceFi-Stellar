'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../../context/WalletContext';
import { apiCall } from '../../lib/apiClient';
import { WALLET_ADAPTERS } from '../../lib/wallets';
import type { WalletAdapter } from '../../lib/wallets';

export default function ConnectWalletPage() {
  const router = useRouter();
  const { connect, setLoading, isLoading } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'FARMER' | 'INVESTOR'>('FARMER');

  const handleConnectWallet = async (adapter: WalletAdapter) => {
    setError(null);
    setLoading(true);

    try {
      if (!adapter.isAvailable()) {
        setError(
          `${adapter.name} wallet extension not detected. Please install it and try again.`,
        );
        setLoading(false);
        return;
      }

      const publicKey = await adapter.connect();

      if (!publicKey) {
        setError(`Failed to get wallet address from ${adapter.name}.`);
        setLoading(false);
        return;
      }

      const { data, error: apiError, status } = await apiCall('/auth/connect-wallet', {
        method: 'POST',
        body: JSON.stringify({ walletAddress: publicKey, role }),
      });

      if (status !== 200 || !data) {
        setError(apiError?.message ?? 'Failed to connect wallet');
        setLoading(false);
        return;
      }

      // Pass the adapter so WalletContext can watch it for disconnect events
      connect(data.walletAddress, data.role, adapter);

      router.push(`/dashboard/${role.toLowerCase()}`);
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setLoading(false);
    }
  };

  return (
    <main className="connect-wallet-page">
      <div className="connect-wallet-container">
        <h1>Connect Your Wallet</h1>
        <p>Choose your role and connect your Stellar wallet to get started.</p>

        {error && <div className="error-message">{error}</div>}

        <div className="role-selector">
          <label>
            <input
              type="radio"
              value="FARMER"
              checked={role === 'FARMER'}
              onChange={(e) => setRole(e.target.value as 'FARMER')}
              disabled={isLoading}
            />
            Farmer
          </label>
          <label>
            <input
              type="radio"
              value="INVESTOR"
              checked={role === 'INVESTOR'}
              onChange={(e) => setRole(e.target.value as 'INVESTOR')}
              disabled={isLoading}
            />
            Investor
          </label>
        </div>

        {/* Wallet list is generated dynamically — no wallet name is hard-coded */}
        <div className="wallet-list">
          {WALLET_ADAPTERS.map((adapter) => (
            <button
              key={adapter.name}
              onClick={() => handleConnectWallet(adapter)}
              disabled={isLoading}
              className="connect-button"
              aria-label={`Connect with ${adapter.name}`}
            >
              {isLoading ? 'Connecting...' : `Connect ${adapter.name} Wallet`}
            </button>
          ))}
        </div>

        <div className="info-box">
          <h3>Requirements</h3>
          <ul>
            <li>A supported Stellar wallet extension installed (Freighter, LOBSTR, or xBull)</li>
            <li>Active Stellar network account</li>
            <li>Sufficient balance for transactions</li>
          </ul>
        </div>
      </div>

      <style jsx>{`
        .connect-wallet-page {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        .connect-wallet-container {
          background: white;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
          max-width: 400px;
          width: 90%;
        }

        h1 {
          margin: 0 0 10px 0;
          color: #333;
        }

        p {
          color: #666;
          margin-bottom: 30px;
        }

        .error-message {
          background-color: #fee;
          color: #c33;
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 20px;
          font-size: 14px;
        }

        .role-selector {
          margin-bottom: 30px;
          display: flex;
          gap: 20px;
        }

        .role-selector label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-weight: 500;
        }

        .role-selector input[type='radio'] {
          cursor: pointer;
        }

        .wallet-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .connect-button {
          width: 100%;
          padding: 12px 24px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.3s;
        }

        .connect-button:hover:not(:disabled) {
          background: #764ba2;
        }

        .connect-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .info-box {
          background: #f5f5f5;
          padding: 15px;
          border-radius: 4px;
          margin-top: 30px;
          font-size: 14px;
        }

        .info-box h3 {
          margin: 0 0 10px 0;
          font-size: 14px;
          color: #333;
        }

        .info-box ul {
          margin: 0;
          padding-left: 20px;
          color: #666;
        }

        .info-box li {
          margin-bottom: 5px;
        }
      `}</style>
    </main>
  );
}
