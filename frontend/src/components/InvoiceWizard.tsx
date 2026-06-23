import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

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
      return;
    }

    const stepFields: Array<keyof InvoiceForm> = step === 'valuation'
      ? ['cropName', 'cropDescription']
      : step === 'review'
      ? ['quantity', 'unit', 'unitPrice', 'currency', 'buyerName', 'buyerEmail']
      : [];

    if (stepFields.length === 0) {
      setCurrentStep(step);
      return;
    }

    const valid = await trigger(stepFields);
    if (valid) {
      setCurrentStep(step);
    }
  };

  const onFinalConfirm = handleSubmit(() => {
    setHasSubmitted(true);
    setCurrentStep('submitted');
    const freighterAvailable = typeof window !== 'undefined' && 'FreighterApi' in window;
    if (freighterAvailable) {
      alert('Freighter signing prompt triggered for final confirmation.');
    }
  });

  const renderStepContent = () => {
    if (currentStep === 'details') {
      return (
        <fieldset className="wizard-panel" aria-labelledby="details-title">
          <legend id="details-title">Crop details</legend>
          <label>
            Crop name
            <input
              type="text"
              {...form.register('cropName')}
              aria-invalid={!!form.formState.errors.cropName}
            />
            <span className="field-error">{form.formState.errors.cropName?.message}</span>
          </label>
          <label>
            Crop description
            <textarea
              rows={4}
              {...form.register('cropDescription')}
              aria-invalid={!!form.formState.errors.cropDescription}
            />
            <span className="field-error">{form.formState.errors.cropDescription?.message}</span>
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
          <label>
            Quantity
            <input
              type="number"
              min={1}
              step={1}
              {...form.register('quantity', { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.quantity}
            />
            <span className="field-error">{form.formState.errors.quantity?.message}</span>
          </label>
          <label>
            Unit
            <select {...form.register('unit')}>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
              <option value="bags">bags</option>
            </select>
          </label>
          <label>
            Unit price
            <input
              type="number"
              min={0.01}
              step={0.01}
              {...form.register('unitPrice', { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.unitPrice}
            />
            <span className="field-error">{form.formState.errors.unitPrice?.message}</span>
          </label>
          <label>
            Currency
            <select {...form.register('currency')}>
              <option value="USD">USD</option>
              <option value="XLM">XLM</option>
              <option value="EUR">EUR</option>
            </select>
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
    <form className="wizard-shell" onSubmit={(event) => event.preventDefault()}>
      <div className="progress-wrapper" aria-label="Invoice creation progress">
        <div className="progress-bar" style={{ width: `${progress}%` }} />
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
  );
}
