import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTransactionSimulation } from '../../hooks/useTransactionSimulation';
import { TransactionSimulationPreview } from '../../components/TransactionSimulationPreview';
import {
  NETWORK_PASSPHRASE,
  buildSimulationRequest,
  scValAddress,
  scValI128,
  scValU64,
} from '../../lib/soroban';

const invoiceSchema = z.object({
  cropName: z.string().min(2, 'Crop name is required'),
  cropDescription: z.string().min(10, 'Please describe the crop in at least 10 characters'),
  quantity: z
    .coerce.number()
    .min(1, 'Quantity must be at least 1')
    .max(10000, 'Quantity cannot exceed 10,000'),
  unit: z.enum(['kg', 'lbs', 'bags']),
  unitPrice: z
    .coerce.number()
    .min(0.01, 'Unit price must be greater than zero'),
  currency: z.enum(['USD', 'XLM', 'EUR']),
  buyerName: z.string().min(2, 'Buyer name is required'),
  buyerEmail: z.string().email('Enter a valid email address'),
});

type InvoiceForm = z.infer<typeof invoiceSchema>;

type StepKey = 'details' | 'valuation' | 'review' | 'submitted';

const stepLabels: Record<StepKey, string> = {
  details: 'Crop Details',
  valuation: 'Valuation',
  review: 'Review & Confirm',
  submitted: 'Submitted',
};

const stepOrder: StepKey[] = ['details', 'valuation', 'review', 'submitted'];

export function InvoiceWizard() {
  const [currentStep, setCurrentStep] = useState<StepKey>('details');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const pendingXdrRef = useRef<string | null>(null);
  const simulation = useTransactionSimulation();

  const form = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema),
    mode: 'onChange',
    defaultValues: {
      cropName: '',
      cropDescription: '',
      quantity: 1,
      unit: 'kg',
      unitPrice: 0.01,
      currency: 'USD',
      buyerName: '',
      buyerEmail: '',
    },
  });

  const { handleSubmit, trigger, watch, formState } = form;
  const values = watch();

  const stepIndex = stepOrder.indexOf(currentStep);
  const progress = ((stepIndex + (currentStep === 'submitted' ? 1 : 0)) / (stepOrder.length - 1)) * 100;

  const summaryItems = useMemo(
    () => [
      { label: 'Crop', value: values.cropName },
      { label: 'Description', value: values.cropDescription },
      { label: 'Quantity', value: `${values.quantity} ${values.unit}` },
      { label: 'Unit price', value: `${values.unitPrice.toFixed(2)} ${values.currency}` },
      { label: 'Buyer', value: `${values.buyerName} · ${values.buyerEmail}` },
      { label: 'Total', value: `${(values.quantity * values.unitPrice).toFixed(2)} ${values.currency}` },
    ],
    [values]
  );

  const goToStep = async (step: StepKey) => {
    if (step === 'details') {
      setCurrentStep(step);
      setErrorMessage('');
      return;
    }

    const stepFields: Array<keyof InvoiceForm> = step === 'valuation'
      ? ['cropName', 'cropDescription', 'quantity', 'unit', 'unitPrice', 'currency', 'buyerName', 'buyerEmail']
      : step === 'review'
      ? []
      : [];

    if (stepFields.length === 0) {
      setCurrentStep(step);
      setErrorMessage('');
      return;
    }

    const valid = await trigger(stepFields);
    if (valid) {
      setCurrentStep(step);
      setErrorMessage('');
    } else {
      const errors = Object.entries(formState.errors)
        .filter(([key]) => stepFields.includes(key as keyof InvoiceForm))
        .map(([, error]) => (error as any)?.message)
        .filter(Boolean);
      setErrorMessage(`Validation errors: ${errors.join('. ')}`);
    }
  };

  const getSignerAddress = (): string => {
    if (typeof sessionStorage === 'undefined') return '';
    return sessionStorage.getItem('walletAddress') ?? '';
  };

  const getConfiguredContractId = (): string => {
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_INVOICE_CONTRACT_ID) {
      return process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID;
    }
    return '';
  };

  const onFinalConfirm = handleSubmit(async () => {
    setErrorMessage('');
    setPreviewOpen(true);

    try {
      const signerAddress = getSignerAddress();
      const faceValue = Math.round(values.quantity * values.unitPrice);
      const request = await buildSimulationRequest({
        contractId: getConfiguredContractId(),
        functionName: 'fund_invoice',
        signerAddress,
        args: [
          scValAddress(signerAddress),
          scValU64(1),
          scValI128(faceValue),
          scValAddress(signerAddress),
        ],
      });
      pendingXdrRef.current = request.transactionXdr;
      await simulation.simulate(request);
    } catch (error) {
      // The transaction could not be prepared (missing wallet, contract, or
      // network). Surface it as a preflight error so the Sign button stays
      // disabled instead of letting the user sign an unbuildable transaction.
      pendingXdrRef.current = null;
      await simulation.simulate({
        transactionXdr: '',
        functionName: 'fund_invoice',
        contractId: getConfiguredContractId() || 'unavailable',
        signerAddress: getSignerAddress() || 'unavailable',
      });
    }
  });

  const handleSignTransaction = async () => {
    setPreviewOpen(false);
    try {
      const freighter = (window as any).FreighterApi;
      if (freighter && pendingXdrRef.current) {
        await freighter.signTransaction(pendingXdrRef.current, {
          networkPassphrase: NETWORK_PASSPHRASE,
        });
      }
      setHasSubmitted(true);
      setCurrentStep('submitted');
    } catch {
      setErrorMessage('Signing was cancelled or failed. No transaction was submitted.');
    } finally {
      simulation.reset();
      pendingXdrRef.current = null;
    }
  };

  const handleCancelPreview = () => {
    setPreviewOpen(false);
    simulation.reset();
    pendingXdrRef.current = null;
  };

  const renderStepContent = () => {
    if (currentStep === 'details') {
      return (
        <fieldset className="wizard-panel" aria-labelledby="details-title">
          <legend id="details-title">Crop details</legend>
          <label htmlFor="cropName">
            Crop name
            <input
              id="cropName"
              type="text"
              {...form.register('cropName')}
              aria-invalid={!!form.formState.errors.cropName}
              aria-describedby={form.formState.errors.cropName ? 'cropName-error' : undefined}
            />
            {form.formState.errors.cropName && (
              <span id="cropName-error" className="field-error" role="alert">
                {form.formState.errors.cropName.message}
              </span>
            )}
          </label>
          <label htmlFor="cropDescription">
            Crop description
            <textarea
              id="cropDescription"
              rows={4}
              {...form.register('cropDescription')}
              aria-invalid={!!form.formState.errors.cropDescription}
              aria-describedby={form.formState.errors.cropDescription ? 'cropDescription-error' : undefined}
            />
            {form.formState.errors.cropDescription && (
              <span id="cropDescription-error" className="field-error" role="alert">
                {form.formState.errors.cropDescription.message}
              </span>
            )}
          </label>
          <div className="wizard-actions">
            <button type="button" className="primary" onClick={() => goToStep('valuation')}>
              Continue to valuation
            </button>
          </div>
        </fieldset>
      );
    }

    if (currentStep === 'valuation') {
      return (
        <fieldset className="wizard-panel" aria-labelledby="valuation-title">
          <legend id="valuation-title">Valuation</legend>
          <label htmlFor="quantity">
            Quantity
            <input
              id="quantity"
              type="number"
              min={1}
              step={1}
              {...form.register('quantity', { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.quantity}
              aria-describedby={form.formState.errors.quantity ? 'quantity-error' : undefined}
            />
            {form.formState.errors.quantity && (
              <span id="quantity-error" className="field-error" role="alert">
                {form.formState.errors.quantity.message}
              </span>
            )}
          </label>
          <label htmlFor="unit">
            Unit
            <select id="unit" {...form.register('unit')}>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
              <option value="bags">bags</option>
            </select>
          </label>
          <label htmlFor="unitPrice">
            Unit price
            <input
              id="unitPrice"
              type="number"
              min={0.01}
              step={0.01}
              {...form.register('unitPrice', { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.unitPrice}
              aria-describedby={form.formState.errors.unitPrice ? 'unitPrice-error' : undefined}
            />
            {form.formState.errors.unitPrice && (
              <span id="unitPrice-error" className="field-error" role="alert">
                {form.formState.errors.unitPrice.message}
              </span>
            )}
          </label>
          <label htmlFor="currency">
            Currency
            <select id="currency" {...form.register('currency')}>
              <option value="USD">USD</option>
              <option value="XLM">XLM</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label htmlFor="buyerName">
            Buyer name
            <input
              id="buyerName"
              type="text"
              {...form.register('buyerName')}
              aria-invalid={!!form.formState.errors.buyerName}
              aria-describedby={form.formState.errors.buyerName ? 'buyerName-error' : undefined}
            />
            {form.formState.errors.buyerName && (
              <span id="buyerName-error" className="field-error" role="alert">
                {form.formState.errors.buyerName.message}
              </span>
            )}
          </label>
          <label htmlFor="buyerEmail">
            Buyer email
            <input
              id="buyerEmail"
              type="email"
              {...form.register('buyerEmail')}
              aria-invalid={!!form.formState.errors.buyerEmail}
              aria-describedby={form.formState.errors.buyerEmail ? 'buyerEmail-error' : undefined}
            />
            {form.formState.errors.buyerEmail && (
              <span id="buyerEmail-error" className="field-error" role="alert">
                {form.formState.errors.buyerEmail.message}
              </span>
            )}
          </label>
          <div className="wizard-actions">
            <button type="button" onClick={() => setCurrentStep('details')}>
              Back
            </button>
            <button type="button" className="primary" onClick={() => goToStep('review')}>
              Review invoice
            </button>
          </div>
        </fieldset>
      );
    }

    if (currentStep === 'review') {
      return (
        <section className="wizard-panel" aria-labelledby="review-title">
          <h2 id="review-title">Review & Confirm</h2>
          <div className="summary-grid">
            {summaryItems.map((item) => (
              <div key={item.label} className="summary-item">
                <strong>{item.label}</strong>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
          <p className="review-copy">
            Confirm the data above before sending the invoice. Only the final step triggers the
            signing prompt.
          </p>
          <div className="wizard-actions">
            <button type="button" onClick={() => setCurrentStep('valuation')}>
              Back
            </button>
            <button type="button" className="primary" onClick={onFinalConfirm}>
              Confirm & sign with Freighter
            </button>
          </div>
        </section>
      );
    }

    return (
      <section className="wizard-panel submitted-panel" aria-labelledby="submitted-title">
        <h2 id="submitted-title">Invoice submitted</h2>
        <p>
          Your invoice data has been recorded and the final confirmation step triggered the signing
          prompt. You can now track payment history once the on-chain operation completes.
        </p>
        <ul className="summary-grid">
          {summaryItems.map((item) => (
            <li key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <>
      <form className="wizard-shell" onSubmit={(event) => event.preventDefault()}>
        <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only">
          {errorMessage}
        </div>
        <div className="progress-wrapper" aria-label="Invoice creation progress">
          <div className="progress-bar" style={{ width: `${progress}%` }} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} role="progressbar" />
          <div className="progress-labels">
            {stepOrder.slice(0, 3).map((step) => (
              <button
                key={step}
                type="button"
                className={`progress-step ${currentStep === step ? 'active' : ''}`}
                onClick={() => goToStep(step)}
                aria-current={currentStep === step ? 'step' : undefined}
              >
                {stepLabels[step]}
              </button>
            ))}
          </div>
        </div>

        {renderStepContent()}
      </form>

      <TransactionSimulationPreview
        open={previewOpen}
        status={simulation.status}
        details={simulation.details}
        preflightError={simulation.preflightError}
        onSign={handleSignTransaction}
        onCancel={handleCancelPreview}
      />
    </>
  );
}
