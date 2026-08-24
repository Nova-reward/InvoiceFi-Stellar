'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const SORT_LABELS: Record<string, string> = {
  fundedAmount: 'Funded Amount',
  discountRate: 'Discount Rate',
  expectedReturn: 'Expected Return',
  dueDate: 'Due Date',
};

const sortFunctions = {
  fundedAmount: (a: Invoice, b: Invoice) => a.fundedAmount - b.fundedAmount,
  discountRate: (a: Invoice, b: Invoice) => a.discountRate - b.discountRate,
  expectedReturn: (a: Invoice, b: Invoice) => a.expectedReturn - b.expectedReturn,
  dueDate: (a: Invoice, b: Invoice) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
};

type SortKey = keyof typeof sortFunctions;

type SortDirection = 'asc' | 'desc';

/**
 * Returns the correct aria-sort value for a column header.
 * Only the active sort column carries 'ascending' or 'descending';
 * all others carry 'none' as required by ARIA 1.1.
 */
function getAriaSortValue(
  columnKey: SortKey,
  activeSortKey: SortKey,
  direction: SortDirection,
): 'ascending' | 'descending' | 'none' {
  if (columnKey !== activeSortKey) return 'none';
  return direction === 'asc' ? 'ascending' : 'descending';
}

export default function InvestorPortfolioTable({ invoices }: Props) {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [tokenFilter, setTokenFilter] = useState<TokenType | 'ALL'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  /**
   * Live-region announcement for sort changes.
   * We alternate between two strings so repeated sorts on the same column
   * always update the DOM text — screen readers re-announce changed content.
   */
  const [sortAnnounce, setSortAnnounce] = useState('');
  const announceCounterRef = useRef(0);

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

  /**
   * Announce function that forces a DOM change even when the message text
   * would be identical (e.g. sorting the same column asc → desc → asc).
   * We clear the region first, then set the new message after a tick so
   * NVDA/VoiceOver/JAWS reliably pick up the mutation.
   */
  const announce = useCallback((message: string) => {
    announceCounterRef.current += 1;
    // Reset to empty so the region always fires a new mutation
    setSortAnnounce('');
    // Use a microtask gap so the DOM clears before the new text lands
    requestAnimationFrame(() => {
      setSortAnnounce(message);
    });
  }, []);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        // Toggle direction — compute the *new* direction before announcing
        const newDirection: SortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        setSortDirection(newDirection);
        announce(
          `Sorted by ${SORT_LABELS[key]} in ${newDirection === 'asc' ? 'ascending' : 'descending'} order`,
        );
        return;
      }
      setSortKey(key);
      setSortDirection('asc');
      announce(`Sorted by ${SORT_LABELS[key]} in ascending order`);
    },
    [sortKey, sortDirection, announce],
  );

  const handleSortKeypress = useCallback(
    (key: SortKey, event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSort(key);
      }
    },
    [handleSort],
  );

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  // When invoices list changes (rows added/removed) and the current page no
  // longer exists, snap back to the last valid page so focus isn't stranded
  // on a now-empty page.
  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  if (invoices.length === 0) {
    return (
      <div className="empty-state">
        <h2>No funded invoices yet</h2>
        <p>Once you invest, your funded invoices and returns will appear here.</p>
        <button className="cta-button" type="button">
          Browse investment opportunities
        </button>
      </div>
    );
  }

  return (
    <div className="investor-table-card">
      {/* ── Filter controls ───────────────────────────────────────────────── */}
      <div className="table-controls">
        <fieldset className="filter-group">
          <legend className="sr-only">Filter invoices</legend>
          <label htmlFor="status-filter">
            Status
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as InvoiceStatus | 'ALL');
                setPage(1);
              }}
              aria-label="Filter by invoice status"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="token-filter">
            Token
            <select
              id="token-filter"
              value={tokenFilter}
              onChange={(event) => {
                setTokenFilter(event.target.value as TokenType | 'ALL');
                setPage(1);
              }}
              aria-label="Filter by token type"
            >
              {TOKEN_OPTIONS.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="summary-text" role="status" aria-live="polite" data-testid="invoice-summary">
          Showing {sortedInvoices.length} invoice{sortedInvoices.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* ── Data table ────────────────────────────────────────────────────── */}
      <div className="table-wrapper">
        <table aria-label="Investment portfolio">
          <caption className="sr-only">List of funded invoices with amounts, rates, and status</caption>
        {/*
          role="grid" allows arrow-key navigation between cells for users of
          screen readers that support the grid widget. aria-rowcount reflects
          the full filtered set, not just the current page.
        */}
        <table
          role="grid"
          aria-label="Investment portfolio"
          aria-rowcount={sortedInvoices.length}
        >
          <caption className="sr-only">
            List of funded invoices with amounts, rates, and status
          </caption>
          <thead>
            <tr>
              <th scope="col">Invoice ID</th>
              <th scope="col">Farmer</th>
              <th scope="col">Crop Type</th>

              {/* Sortable columns — scope="col" + aria-sort satisfy WCAG 1.3.1 */}
              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('fundedAmount')}
                onKeyDown={(e) => handleSortKeypress('fundedAmount', e)}
                className="sortable"
                aria-sort={getAriaSortValue('fundedAmount', sortKey, sortDirection)}
                aria-label={`Funded Amount, sortable. ${
                  sortKey === 'fundedAmount'
                    ? `Currently sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}`
                    : 'Not sorted'
                }`}
              >
                Funded Amount{' '}
                <span aria-hidden="true">
                  {sortKey === 'fundedAmount' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </th>

              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('discountRate')}
                onKeyDown={(e) => handleSortKeypress('discountRate', e)}
                className="sortable"
                aria-sort={getAriaSortValue('discountRate', sortKey, sortDirection)}
                aria-label={`Discount Rate, sortable. ${
                  sortKey === 'discountRate'
                    ? `Currently sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}`
                    : 'Not sorted'
                }`}
              >
                Discount Rate{' '}
                <span aria-hidden="true">
                  {sortKey === 'discountRate' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </th>

              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('expectedReturn')}
                onKeyDown={(e) => handleSortKeypress('expectedReturn', e)}
                className="sortable"
                aria-sort={getAriaSortValue('expectedReturn', sortKey, sortDirection)}
                aria-label={`Expected Return, sortable. ${
                  sortKey === 'expectedReturn'
                    ? `Currently sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}`
                    : 'Not sorted'
                }`}
              >
                Expected Return{' '}
                <span aria-hidden="true">
                  {sortKey === 'expectedReturn' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </th>

              <th
                scope="col"
                tabIndex={0}
                onClick={() => handleSort('dueDate')}
                onKeyDown={(e) => handleSortKeypress('dueDate', e)}
                className="sortable"
                aria-sort={getAriaSortValue('dueDate', sortKey, sortDirection)}
                aria-label={`Due Date, sortable. ${
                  sortKey === 'dueDate'
                    ? `Currently sorted ${sortDirection === 'asc' ? 'ascending' : 'descending'}`
                    : 'Not sorted'
                }`}
              >
                Due Date{' '}
                <span aria-hidden="true">
                  {sortKey === 'dueDate' ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </th>

              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageInvoices.map((invoice, rowIndex) => (
              <tr
                key={invoice.id}
                role="row"
                aria-rowindex={(page - 1) * PAGE_SIZE + rowIndex + 2} // +2: 1-based + header row
              >
                <td>{invoice.id}</td>
                <td>{invoice.farmer}</td>
                <td>{invoice.cropType}</td>
                <td>{formatCurrency(invoice.fundedAmount)}</td>
                <td>{formatPercent(invoice.discountRate)}</td>
                <td>{formatCurrency(invoice.expectedReturn)}</td>
                <td>{formatDate(invoice.dueDate)}</td>
                <td>
                  <span
                    className={`status-pill status-${invoice.status.toLowerCase()}`}
                    role="status"
                    aria-label={`Status: ${invoice.status}`}
                  >
                    {invoice.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      <nav className="pagination-controls" aria-label="Table pagination">
        <button
          type="button"
          onClick={() => handlePageChange(page - 1)}
          disabled={page === 1}
          aria-label="Go to previous page"
        >
          Previous
        </button>
        <span aria-live="polite" role="status" aria-atomic="true">
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
      </nav>

      {/* ── Sort announcement live region ─────────────────────────────────── */}
      {/*
        aria-live="assertive" so the announcement interrupts ongoing reading.
        aria-atomic="true" ensures the full message is read, not just the diff.
        The region is visually hidden but not display:none so it stays in the
        accessibility tree.
      */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        aria-relevant="text"
        className="sr-only"
        data-testid="sort-announcement"
      >
        {sortAnnounce}
      </div>
    </div>
  );
}
