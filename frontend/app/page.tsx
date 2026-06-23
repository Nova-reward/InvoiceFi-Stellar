import InvestorPortfolioTable from '../components/InvestorPortfolioTable';

const mockInvoices = [
  {
    id: 'INV-1001',
    farmer: 'Amina Mwangi',
    cropType: 'Maize',
    fundedAmount: 8500,
    discountRate: 9.5,
    expectedReturn: 9357.5,
    dueDate: '2026-11-15',
    status: 'FUNDED',
    tokenType: 'XLM',
  },
  {
    id: 'INV-1002',
    farmer: 'Boulos Yusuf',
    cropType: 'Sorghum',
    fundedAmount: 5400,
    discountRate: 11.0,
    expectedReturn: 5994,
    dueDate: '2026-09-30',
    status: 'REPAID',
    tokenType: 'USDC',
  },
  {
    id: 'INV-1003',
    farmer: 'Chinwe Okeke',
    cropType: 'Cassava',
    fundedAmount: 6700,
    discountRate: 12.25,
    expectedReturn: 7527.75,
    dueDate: '2026-10-20',
    status: 'DEFAULTED',
    tokenType: 'XLM',
  },
];

export default function Page() {
  return (
    <main className="page-shell">
      <section className="page-header">
        <h1>Investor Portfolio</h1>
        <p>View funded invoices, expected returns, and portfolio status.</p>
      </section>
      <InvestorPortfolioTable invoices={mockInvoices} />
    </main>
  );
}
