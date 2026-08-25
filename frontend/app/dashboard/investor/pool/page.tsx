"use client";

import React, { useEffect, useState, useCallback } from 'react';

interface PoolStats {
  totalDeposited: number;
  totalFunded: number;
  utilizationPercentage: number;
  averageApy: number;
  activeInvoicesCount: number;
}

export default function InvestorPoolDashboard() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetching from the mock NestJS backend endpoint
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pool/stats`);
      if (!response.ok) {
        throw new Error('Failed to fetch pool stats');
      }
      const data: PoolStats = await response.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 30 seconds
    const intervalId = setInterval(fetchStats, 30000);
    return () => clearInterval(intervalId);
  }, [fetchStats]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Liquidity Pool Metrics</h1>
            <p className="text-gray-500 mt-2">Real-time overview of the InvoiceFi financing pool.</p>
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="mt-4 md:mt-0 px-4 py-2 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>

        {error && (
          <div className="p-4 mb-8 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Total Deposited */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Total Deposited</span>
              <span className="mt-2 text-3xl font-bold text-gray-900">
                ${stats.totalDeposited.toLocaleString()}
              </span>
            </div>

            {/* Total Funded */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Total Funded</span>
              <span className="mt-2 text-3xl font-bold text-gray-900">
                ${stats.totalFunded.toLocaleString()}
              </span>
            </div>

            {/* Utilization Percentage */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Utilization Rate</span>
              <span className="mt-2 text-3xl font-bold text-gray-900">
                {stats.utilizationPercentage.toFixed(2)}%
              </span>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full" 
                  style={{ width: `${Math.min(stats.utilizationPercentage, 100)}%` }}
                ></div>
              </div>
            </div>

            {/* Average APY */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Average APY</span>
              <span className="mt-2 text-3xl font-bold text-green-600">
                {stats.averageApy.toFixed(2)}%
              </span>
            </div>

            {/* Active Invoices Count */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col">
              <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">Active Invoices</span>
              <span className="mt-2 text-3xl font-bold text-gray-900">
                {stats.activeInvoicesCount}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
