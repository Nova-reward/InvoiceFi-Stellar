'use client'

import { useEffect, useState } from 'react';
import { useInvoiceNotifications } from '../../../hooks/useInvoiceNotifications';
import { OfflineIndicator } from '../../../components/OfflineIndicator';

interface Invoice {
  id: number;
  status: string;
  amount: number;
}

export default function Page() {
  const { events, connected } = useInvoiceNotifications();

  // Example initial state (normally fetched via REST on initial mount)
  const [invoices, setInvoices] = useState<Invoice[]>([
    { id: 1, status: 'created', amount: 5000 },
    { id: 2, status: 'submitted', amount: 12000 },
  ]);

  // Listen to new events and update local invoice rows
  useEffect(() => {
    if (events.length === 0) return;

    // Grab the most recent event
    const latestEvent = events[0];

    setInvoices((prevInvoices) =>
      prevInvoices.map((invoice) =>
        invoice.id === latestEvent.invoiceId
          ? { ...invoice, status: latestEvent.event }
          : invoice
      )
    );
  }, [events]);

  return (
    <div className="dashboard-container">
      <OfflineIndicator isConnected={connected} />

      <main className="p-6">
        <h1 className="text-2xl font-bold mb-4">Farmer Dashboard</h1>

        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr>
              <th className="py-2 px-4 border-b">Invoice ID</th>
              <th className="py-2 px-4 border-b">Amount</th>
              <th className="py-2 px-4 border-b">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} data-testid={`invoice-row-${inv.id}`}>
                <td className="py-2 px-4 border-b text-center">#{inv.id}</td>
                <td className="py-2 px-4 border-b text-center">${inv.amount}</td>
                <td className="py-2 px-4 border-b text-center capitalize font-semibold">
                  {inv.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}