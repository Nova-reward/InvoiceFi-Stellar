import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { TransactionSimulationPreview } from '../../components/TransactionSimulationPreview'
import type { SimulationDetails } from '../../hooks/useTransactionSimulation'

expect.extend(toHaveNoViolations)

const successfulDetails: SimulationDetails = {
  estimatedFeeStroops: 1300,
  estimatedFeeXlm: 0.00013,
  xlmBalanceImpactXlm: 0.00013,
  xlmBalanceAfter: 99.99987,
  insufficientBalance: false,
  contractId: 'CCONTRACTID1234567890',
  functionName: 'fund_invoice',
  signerAddress: 'GSIGNERADDRESS12345',
}

describe('TransactionSimulationPreview Accessibility', () => {
  it('should not have accessibility violations when showing simulation details', async () => {
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="success"
        details={successfulDetails}
        preflightError={null}
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should not have accessibility violations when showing a preflight error', async () => {
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="error"
        details={null}
        preflightError="This invoice has already been funded."
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should not have accessibility violations while simulating', async () => {
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="simulating"
        details={null}
        preflightError={null}
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should render a labelled modal dialog when open', () => {
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="success"
        details={successfulDetails}
        preflightError={null}
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const title = dialog?.querySelector('#sim-preview-title')
    expect(title).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-labelledby', 'sim-preview-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'sim-preview-desc')
  })

  it('should render nothing when closed', () => {
    const { container } = render(
      <TransactionSimulationPreview
        open={false}
        status="idle"
        details={null}
        preflightError={null}
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('should display the estimated fee, signer, contract ID and function name', () => {
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="success"
        details={successfulDetails}
        preflightError={null}
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    expect(container).toHaveTextContent('Estimated fee')
    expect(container).toHaveTextContent('0.0001300 XLM')
    expect(container).toHaveTextContent('Signer')
    expect(container).toHaveTextContent('Contract ID')
    expect(container).toHaveTextContent('Function')
    expect(container).toHaveTextContent('fund_invoice')
  })

  it('should disable the Sign button when the simulation failed', () => {
    const onSign = jest.fn()
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="error"
        details={null}
        preflightError="This invoice has already been funded."
        onSign={onSign}
        onCancel={jest.fn()}
      />,
    )
    const signButton = container.querySelector('.sim-button-primary')
    expect(signButton).toBeDisabled()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      'already been funded',
    )
  })

  it('should enable the Sign button only after a successful simulation', () => {
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="success"
        details={successfulDetails}
        preflightError={null}
        onSign={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    expect(container.querySelector('.sim-button-primary')).not.toBeDisabled()
  })

  it('should offer a cancel that never requires signing', () => {
    const onCancel = jest.fn()
    const { container } = render(
      <TransactionSimulationPreview
        open
        status="error"
        details={null}
        preflightError="Something failed."
        onSign={jest.fn()}
        onCancel={onCancel}
      />,
    )
    const cancelButton = container.querySelector('.sim-button-secondary')
    expect(cancelButton).not.toBeDisabled()
    fireEvent.click(cancelButton!)
    expect(onCancel).toHaveBeenCalled()
  })

  it('should dismiss on Escape without signing', () => {
    const onCancel = jest.fn()
    const onSign = jest.fn()
    render(
      <TransactionSimulationPreview
        open
        status="success"
        details={successfulDetails}
        preflightError={null}
        onSign={onSign}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onSign).not.toHaveBeenCalled()
  })
})