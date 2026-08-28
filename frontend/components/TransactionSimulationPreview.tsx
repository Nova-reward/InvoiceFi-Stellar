'use client';

import { useEffect, useRef } from 'react';
import type {
  SimulationDetails,
  SimulationStatus,
} from '../hooks/useTransactionSimulation';

export interface TransactionSimulationPreviewProps {
  open: boolean;
  status: SimulationStatus;
  details: SimulationDetails | null;
  preflightError: string | null;
  onSign: () => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function shortAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatXlm(value: number): string {
  return `${value.toFixed(7)} XLM`;
}

/**
 * Pre-transaction-signing preview modal.
 *
 * Shown automatically before every Freighter `signTransaction` call. It
 * summarises the simulated transaction (estimated fee, signer, contract id,
 * function) and, when the RPC reports a preflight error, blocks signing.
 *
 * Accessibility notes:
 * - `role="dialog"`, `aria-modal`, labelled and described by static text.
 * - Open/close focus is managed and Tab is trapped inside the dialog.
 * - `Escape` or the backdrop dismisses it without signing.
 * - Errors are announced via `role="alert"`.
 */
export function TransactionSimulationPreview({
  open,
  status,
  details,
  preflightError,
  onSign,
  onCancel,
}: TransactionSimulationPreviewProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus the dialog on open and restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  // Keyboard support: Escape cancels, Tab cycles within the dialog.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const isBusy = status === 'simulating';
  const canSign = status === 'success' && details !== null;

  return (
    <div
      className="sim-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-preview-title"
        aria-describedby="sim-preview-desc"
        aria-busy={isBusy || undefined}
        tabIndex={-1}
        className="sim-dialog"
      >
        <header className="sim-dialog-header">
          <h2 id="sim-preview-title">Review transaction before signing</h2>
          <p id="sim-preview-desc">
            This transaction was preflight-simulated on-chain to check it will
            succeed before any XLM is spent on fees.
          </p>
        </header>

        {isBusy && (
          <div className="sim-state sim-state-busy" role="status" aria-live="polite">
            <span className="sim-spinner" aria-hidden="true" />
            Simulating transaction…
          </div>
        )}

        {canSign && details && (
          <dl className="sim-details">
            <div className="sim-detail">
              <dt>Estimated fee</dt>
              <dd>{formatXlm(details.estimatedFeeXlm)}</dd>
            </div>
            <div className="sim-detail">
              <dt>Signer</dt>
              <dd title={details.signerAddress}>{shortAddress(details.signerAddress)}</dd>
            </div>
            <div className="sim-detail">
              <dt>Contract ID</dt>
              <dd title={details.contractId}>{shortAddress(details.contractId)}</dd>
            </div>
            <div className="sim-detail">
              <dt>Function</dt>
              <dd>
                <code>{details.functionName}</code>
              </dd>
            </div>
            <div className="sim-detail">
              <dt>XLM balance impact</dt>
              <dd>
                −{formatXlm(details.xlmBalanceImpactXlm)}
                {details.xlmBalanceAfter !== null && (
                  <span className="sim-balance-after">
                    {' '}
                    (balance after: {details.xlmBalanceAfter.toFixed(2)} XLM)
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}

        {details?.insufficientBalance && (
          <p className="sim-warning" role="note">
            Warning: your XLM balance may be too low to cover this fee after
            the transaction is submitted.
          </p>
        )}

        {status === 'error' && preflightError && (
          <div className="sim-state sim-state-error" role="alert">
            <strong>This transaction cannot be signed.</strong>
            <span>{preflightError}</span>
          </div>
        )}

        <footer className="sim-dialog-actions">
          <button
            type="button"
            onClick={onCancel}
            className="sim-button sim-button-secondary"
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSign}
            disabled={!canSign}
            className="sim-button sim-button-primary"
          >
            Sign transaction
          </button>
        </footer>
      </div>
    </div>
  );
}