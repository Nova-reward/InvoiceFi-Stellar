import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import InvestorPortfolioTable, { Invoice } from '../../components/InvestorPortfolioTable'

expect.extend(toHaveNoViolations)

describe('InvestorPortfolioTable Accessibility', () => {
  const mockInvoices: Invoice[] = [
    {
      id: 'INV-001',
      farmer: 'John Doe',
      cropType: 'Corn',
      fundedAmount: 5000,
      discountRate: 2.5,
      expectedReturn: 125,
      dueDate: '2024-12-31',
      status: 'FUNDED',
      tokenType: 'XLM',
    },
    {
      id: 'INV-002',
      farmer: 'Jane Smith',
      cropType: 'Wheat',
      fundedAmount: 3000,
      discountRate: 1.8,
      expectedReturn: 54,
      dueDate: '2024-11-30',
      status: 'REPAID',
      tokenType: 'USDC',
    },
  ]

  it('should not have accessibility violations', async () => {
    const { container } = render(<InvestorPortfolioTable invoices={mockInvoices} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should have proper table structure with caption', () => {
    const { container } = render(<InvestorPortfolioTable invoices={mockInvoices} />)
    const table = container.querySelector('table')
    const caption = table?.querySelector('caption')

    expect(table).toBeInTheDocument()
    expect(caption).toBeInTheDocument()
    expect(caption).toHaveTextContent('List of funded invoices')
  })

  it('should have scope attributes on header cells', () => {
    const { container } = render(<InvestorPortfolioTable invoices={mockInvoices} />)
    const headers = container.querySelectorAll('th')

    headers.forEach((header) => {
      expect(header).toHaveAttribute('scope', 'col')
    })
  })

  it('should have sortable columns with proper ARIA attributes', () => {
    const { container } = render(<InvestorPortfolioTable invoices={mockInvoices} />)
    const sortableHeaders = container.querySelectorAll('th.sortable')

    sortableHeaders.forEach((header) => {
      // Sortable headers are keyboard-focusable and announce their sort state
      // via aria-sort (allowed on the implicit columnheader role).
      expect(header).toHaveAttribute('tabindex', '0')
      expect(header).toHaveAttribute('aria-sort')
    })
  })

  it('should have accessible filter controls', () => {
    const { container } = render(<InvestorPortfolioTable invoices={mockInvoices} />)
    const statusFilter = container.querySelector('#status-filter')
    const tokenFilter = container.querySelector('#token-filter')

    expect(statusFilter).toHaveAttribute('aria-label', 'Filter by invoice status')
    expect(tokenFilter).toHaveAttribute('aria-label', 'Filter by token type')
  })

  it('should have accessible pagination', () => {
    const { container } = render(<InvestorPortfolioTable invoices={mockInvoices} />)
    const paginationNav = container.querySelector('[role="navigation"]')
    const buttons = container.querySelectorAll('.pagination-controls button')

    expect(paginationNav).toBeInTheDocument()
    expect(paginationNav).toHaveAttribute('aria-label', 'Table pagination')
    expect(buttons.length).toBeGreaterThan(0)
  })
})
