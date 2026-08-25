import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'InvoiceFi Investor Dashboard',
  description: 'Investor portfolio dashboard for funded invoices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
