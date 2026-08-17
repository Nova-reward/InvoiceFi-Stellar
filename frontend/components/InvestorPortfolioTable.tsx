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
  const [sortAnnounce, setSortAnnounce] = useState('');

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
      setSortAnnounce(`Sorted by ${key} in descending order`);
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
    setSortAnnounce(`Sorted by ${key} in ascending order`);
  };

  const handleSortKeypress = (key: SortKey, event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSort(key);
    }
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
        <fieldset className="filter-group">
          <legend className="sr-only">Filter invoices</legend>
          <label htmlFor="status-filter">
            Status
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => { setStatusFilter(event.target.value as InvoiceStatus | 'ALL'); setPage(1); }}
              aria-label="Filter by invoice status"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label htmlFor="token-filter">
            Token
            <select
              id="token-filter"
              value={tokenFilter}
              onChange={(event) => { setTokenFilter(event.target.value as TokenType | 'ALL'); setPage(1); }}
              aria-label="Filter by token type"
            >
              {TOKEN_OPTIONS.map((token) => (
                <option key={token} value={token}>{token}</option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="summary-text" role="status" aria-live="polite">
          Showing {sortedInvoices.length} invoice{sortedInvoices.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="table-wrapper">
        <table aria-label="Investment portfolio">
          <caption className="sr-only">List of funded invoices with amounts, rates, and status</caption>
          <thead>
            <tr>
              <th scope="col">Invoice ID</th>
              <th scope="col">Farmer</th>
              <th scope="col">Crop Type</th>
              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('fundedAmount')}
                onKeyDown={(e) => handleSortKeypress('fundedAmount', e)}
                className="sortable"
                aria-sort={sortKey === 'fundedAmount' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Funded Amount <span aria-hidden="true">{sortKey === 'fundedAmount' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('discountRate')}
                onKeyDown={(e) => handleSortKeypress('discountRate', e)}
                className="sortable"
                aria-sort={sortKey === 'discountRate' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Discount Rate <span aria-hidden="true">{sortKey === 'discountRate' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('expectedReturn')}
                onKeyDown={(e) => handleSortKeypress('expectedReturn', e)}
                className="sortable"
                aria-sort={sortKey === 'expectedReturn' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Expected Return <span aria-hidden="true">{sortKey === 'expectedReturn' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('dueDate')}
                onKeyDown={(e) => handleSortKeypress('dueDate', e)}
                className="sortable"
                aria-sort={sortKey === 'dueDate' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Due Date <span aria-hidden="true">{sortKey === 'dueDate' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</span>
              </th>
              <th scope="col">Status</th>
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

      <div className="pagination-controls" role="navigation" aria-label="Table pagination">
        <button
          type="button"
          onClick={() => handlePageChange(page - 1)}
          disabled={page === 1}
          aria-label="Go to previous page"
        >
          Previous
        </button>
        <span aria-live="polite" role="status">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => handlePageChange(page + 1)}
          disabled={page === pageCount}
          aria-label="Go to next page"
        >
          Next
        </button>
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {sortAnnounce}
      </div>
    </div>
  );
}
