'use client';

import { useMemo, useState } from 'react';

type InvoiceStatus = 'FUNDED' | 'REPAID' | 'DEFAULTED';

type TokenType = 'XLM' | 'USDC';

export type Invoice = {
  id: string;
  farmer: string;
  cropType: string;
  fundedAmount: number;
  discountRate: number;
  expectedReturn: number;
  dueDate: string;
  status: InvoiceStatus;
  tokenType: TokenType;
};

type Props = {
  invoices: Invoice[];
};

const STATUS_OPTIONS: Array<InvoiceStatus | 'ALL'> = ['ALL', 'FUNDED', 'REPAID', 'DEFAULTED'];
const TOKEN_OPTIONS: Array<TokenType | 'ALL'> = ['ALL', 'XLM', 'USDC'];
const PAGE_SIZE = 10;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

const formatPercent = (value: number) => `${value.toFixed(2)}%`;

const formatDate = (value: string) => new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const sortFunctions = {
  fundedAmount: (a: Invoice, b: Invoice) => a.fundedAmount - b.fundedAmount,
  discountRate: (a: Invoice, b: Invoice) => a.discountRate - b.discountRate,
  expectedReturn: (a: Invoice, b: Invoice) => a.expectedReturn - b.expectedReturn,
  dueDate: (a: Invoice, b: Invoice) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
};

type SortKey = keyof typeof sortFunctions;

type SortDirection = 'asc' | 'desc';

export default function InvestorPortfolioTable({ invoices }: Props) {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [tokenFilter, setTokenFilter] = useState<TokenType | 'ALL'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const statusMatch = statusFilter === 'ALL' || invoice.status === statusFilter;
      const tokenMatch = tokenFilter === 'ALL' || invoice.tokenType === tokenFilter;
      return statusMatch && tokenMatch;
    });
  }, [invoices, statusFilter, tokenFilter]);

  const sortedInvoices = useMemo(() => {
    const invoicesCopy = [...filteredInvoices];
    const compare = sortFunctions[sortKey];
    invoicesCopy.sort((a, b) => {
      const result = compare(a, b);
      return sortDirection === 'asc' ? result : -result;
    });
    return invoicesCopy;
  }, [filteredInvoices, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(sortedInvoices.length / PAGE_SIZE));
  const pageInvoices = sortedInvoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  if (invoices.length === 0) {
    return (
      <div className="empty-state">
        <h2>No funded invoices yet</h2>
        <p>Once you invest, your funded invoices and returns will appear here.</p>
        <button className="cta-button" type="button">Browse investment opportunities</button>
      </div>
    );
  }

  return (
    <div className="investor-table-card">
      <div className="table-controls">
        <div className="filter-group">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as InvoiceStatus | 'ALL'); setPage(1); }}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Token
            <select value={tokenFilter} onChange={(event) => { setTokenFilter(event.target.value as TokenType | 'ALL'); setPage(1); }}>
              {TOKEN_OPTIONS.map((token) => (
                <option key={token} value={token}>{token}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="summary-text">
          Showing {sortedInvoices.length} invoice{sortedInvoices.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Farmer</th>
              <th>Crop Type</th>
              <th onClick={() => handleSort('fundedAmount')} className="sortable">
                Funded Amount <span>{sortKey === 'fundedAmount' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th onClick={() => handleSort('discountRate')} className="sortable">
                Discount Rate <span>{sortKey === 'discountRate' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th onClick={() => handleSort('expectedReturn')} className="sortable">
                Expected Return <span>{sortKey === 'expectedReturn' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th onClick={() => handleSort('dueDate')} className="sortable">
                Due Date <span>{sortKey === 'dueDate' ? (sortDirection === 'asc' ? (sortDirection === 'asc' ? '▲' : '▼') : '') : ''}</span>
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageInvoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.id}</td>
                <td>{invoice.farmer}</td>
                <td>{invoice.cropType}</td>
                <td>{formatCurrency(invoice.fundedAmount)}</td>
                <td>{formatPercent(invoice.discountRate)}</td>
                <td>{formatCurrency(invoice.expectedReturn)}</td>
                <td>{formatDate(invoice.dueDate)}</td>
                <td>
                  <span className={`status-pill status-${invoice.status.toLowerCase()}`}>
                    {invoice.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination-controls">
        <button type="button" onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
          Previous
        </button>
        <span>Page {page} of {pageCount}</span>
        <button type="button" onClick={() => handlePageChange(page + 1)} disabled={page === pageCount}>
          Next
        </button>
      </div>
    </div>
  );
}
