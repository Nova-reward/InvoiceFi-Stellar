import { InvoiceWizard } from './components/InvoiceWizard';

export default function App() {
  return (
    <div className="app-shell">
      <main className="content">
        <header className="app-header">
          <div>
            <p className="eyebrow">InvoiceFi Stellar</p>
            <h1>Create invoices with step validation</h1>
            <p className="subtitle">
              A mobile-friendly invoice wizard with real-time validation, review summary, and final
              confirmation.
            </p>
          </div>
        </header>

        <InvoiceWizard />
      </main>
    </div>
  );
}
