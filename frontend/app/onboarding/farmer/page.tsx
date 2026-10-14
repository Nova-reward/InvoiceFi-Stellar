'use client';

import React, { useState, useEffect, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../../../context/WalletContext';

interface OnboardingData {
  // Step 1: Basic Info
  fullName: string;
  phoneNumber: string;
  
  // Step 2: Farm Details
  farmLocation: string;
  farmSize: string;
  primaryCrops: string[];
  
  // Step 3: Additional Info (optional)
  yearsFarming: string;
  hasPreviousLoans: boolean;
  
  // Step 4: Wallet
  walletAddress: string;
}

type OnboardingStep = 1 | 2 | 3 | 4 | 5;

export default function FarmerOnboardingPage() {
  const router = useRouter();
  const { connect, walletAddress, isConnected } = useWallet();
  
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  
  const [formData, setFormData] = useState<OnboardingData>({
    fullName: '',
    phoneNumber: '',
    farmLocation: '',
    farmSize: '',
    primaryCrops: [],
    yearsFarming: '',
    hasPreviousLoans: false,
    walletAddress: walletAddress || '',
  });

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update wallet address when connected
  useEffect(() => {
    if (walletAddress) {
      setFormData(prev => ({ ...prev, walletAddress }));
    }
  }, [walletAddress]);

  const handleInputChange = (field: keyof OnboardingData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleCropToggle = (crop: string) => {
    setFormData(prev => ({
      ...prev,
      primaryCrops: prev.primaryCrops.includes(crop)
        ? prev.primaryCrops.filter(c => c !== crop)
        : [...prev.primaryCrops, crop]
    }));
  };

  const validateStep = (step: OnboardingStep): boolean => {
    switch (step) {
      case 1:
        return !!(formData.fullName && formData.phoneNumber);
      case 2:
        return !!(formData.farmLocation && formData.farmSize && formData.primaryCrops.length > 0);
      case 3:
        return true; // Optional step
      case 4:
        return isConnected && !!formData.walletAddress;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => ((prev + 1) as OnboardingStep));
      setError(null);
    } else {
      setError('Please fill in all required fields');
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => ((prev - 1) as OnboardingStep));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) {
      setError('Please complete all required steps');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Save onboarding data to backend
      const response = await fetch('/api/onboarding/farmer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to save onboarding data');
      }

      // Connect wallet if not already connected
      if (!isConnected) {
        connect(formData.walletAddress, 'FARMER');
      }

      // Redirect to farmer dashboard
      router.push('/dashboard/farmer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsSubmitting(false);
    }
  };

  const commonCrops = ['Maize', 'Rice', 'Wheat', 'Cassava', 'Sorghum', 'Millet', 'Beans', 'Tomatoes'];

  const stepLabels = ['Welcome', 'Basic Info', 'Farm Details', 'Additional', 'Wallet', 'Complete'];

  return (
    <div className="onboarding-container">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="offline-banner">
          <div className="offline-banner-content">
            <span className="offline-icon">⚠️</span>
            <span className="offline-text">You're offline. Some features may be limited.</span>
          </div>
        </div>
      )}

      <div className="onboarding-card">
        {/* Progress Indicator */}
        <div className="progress-container">
          <div className="progress-steps">
            {[1, 2, 3, 4, 5].map((step) => (
              <div
                key={step}
                className={`progress-step ${step <= currentStep ? 'active' : ''} ${step < currentStep ? 'completed' : ''}`}
              >
                <div className="step-circle">
                  {step < currentStep ? '✓' : step}
                </div>
                <div className="step-label">{stepLabels[step - 1]}</div>
              </div>
            ))}
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${((currentStep - 1) / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Welcome */}
        {currentStep === 1 && (
          <div className="step-content">
            <div className="welcome-section">
              <h1>Welcome, Farmer! 🌾</h1>
              <p className="welcome-text">
                Let's get you set up to access financing for your farm. 
                This will only take a few minutes.
              </p>
              <div className="benefits-list">
                <div className="benefit-item">
                  <span className="benefit-icon">💰</span>
                  <span>Access to low-interest loans</span>
                </div>
                <div className="benefit-item">
                  <span className="benefit-icon">📊</span>
                  <span>Track your farm performance</span>
                </div>
                <div className="benefit-item">
                  <span className="benefit-icon">🔒</span>
                  <span>Secure blockchain-based transactions</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Basic Information */}
        {currentStep === 2 && (
          <div className="step-content">
            <h2>Basic Information</h2>
            <p className="step-description">Tell us a bit about yourself</p>
            
            <div className="form-group">
              <label htmlFor="fullName">Full Name *</label>
              <input
                id="fullName"
                type="text"
                value={formData.fullName}
                onChange={(e) => handleInputChange('fullName', e.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="phoneNumber">Phone Number *</label>
              <input
                id="phoneNumber"
                type="tel"
                value={formData.phoneNumber}
                onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                placeholder="+234 XXX XXX XXXX"
                autoComplete="tel"
              />
            </div>
          </div>
        )}

        {/* Step 3: Farm Details */}
        {currentStep === 3 && (
          <div className="step-content">
            <h2>Farm Details</h2>
            <p className="step-description">Tell us about your farm</p>
            
            <div className="form-group">
              <label htmlFor="farmLocation">Farm Location *</label>
              <input
                id="farmLocation"
                type="text"
                value={formData.farmLocation}
                onChange={(e) => handleInputChange('farmLocation', e.target.value)}
                placeholder="City, State/Region"
              />
            </div>

            <div className="form-group">
              <label htmlFor="farmSize">Farm Size (hectares) *</label>
              <input
                id="farmSize"
                type="text"
                value={formData.farmSize}
                onChange={(e) => handleInputChange('farmSize', e.target.value)}
                placeholder="e.g., 5"
                inputMode="numeric"
              />
            </div>

            <div className="form-group">
              <label>Primary Crops * (select all that apply)</label>
              <div className="crop-grid">
                {commonCrops.map((crop) => (
                  <button
                    key={crop}
                    type="button"
                    className={`crop-button ${formData.primaryCrops.includes(crop) ? 'selected' : ''}`}
                    onClick={() => handleCropToggle(crop)}
                  >
                    {crop}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Additional Information (Optional) */}
        {currentStep === 4 && (
          <div className="step-content">
            <h2>Additional Information</h2>
            <p className="step-description optional-badge">Optional - Help us serve you better</p>
            
            <div className="form-group">
              <label htmlFor="yearsFarming">Years of Farming Experience</label>
              <input
                id="yearsFarming"
                type="text"
                value={formData.yearsFarming}
                onChange={(e) => handleInputChange('yearsFarming', e.target.value)}
                placeholder="e.g., 10"
                inputMode="numeric"
              />
            </div>

            <div className="form-group">
              <label>Have you taken agricultural loans before?</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="hasPreviousLoans"
                    checked={formData.hasPreviousLoans === true}
                    onChange={() => handleInputChange('hasPreviousLoans', true)}
                  />
                  <span>Yes</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="hasPreviousLoans"
                    checked={formData.hasPreviousLoans === false}
                    onChange={() => handleInputChange('hasPreviousLoans', false)}
                  />
                  <span>No</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Wallet Connection */}
        {currentStep === 5 && (
          <div className="step-content">
            <h2>Connect Your Wallet</h2>
            <p className="step-description">
              Connect your Stellar wallet to complete registration
            </p>

            {isConnected ? (
              <div className="wallet-connected">
                <div className="success-icon">✓</div>
                <p className="success-text">Wallet Connected!</p>
                <p className="wallet-address">{formData.walletAddress}</p>
              </div>
            ) : (
              <div className="wallet-prompt">
                <p>You need to connect your Stellar wallet to continue.</p>
                <button
                  onClick={() => router.push('/connect-wallet?role=FARMER&redirect=/onboarding/farmer')}
                  className="connect-wallet-button"
                >
                  Connect Wallet
                </button>
              </div>
            )}
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="navigation-buttons">
          {currentStep > 1 && (
            <button
              onClick={handleBack}
              disabled={isSubmitting}
              className="nav-button secondary"
            >
              Back
            </button>
          )}
          
          {currentStep < 5 ? (
            <button
              onClick={handleNext}
              disabled={isSubmitting || !validateStep(currentStep)}
              className="nav-button primary"
            >
              {isSubmitting ? 'Saving...' : 'Continue'}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !isConnected}
              className="nav-button primary submit"
            >
              {isSubmitting ? 'Completing...' : 'Complete Setup'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .onboarding-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .onboarding-card {
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 600px;
          width: 100%;
          padding: 32px 24px;
          max-height: 90vh;
          overflow-y: auto;
        }

        /* Progress Indicator */
        .progress-container {
          margin-bottom: 32px;
        }

        .progress-steps {
          display: flex;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .progress-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          flex: 1;
        }

        .step-circle {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #e5e7eb;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.3s;
        }

        .progress-step.active .step-circle {
          background: #667eea;
          color: white;
          transform: scale(1.1);
        }

        .progress-step.completed .step-circle {
          background: #10b981;
          color: white;
        }

        .step-label {
          font-size: 11px;
          color: #6b7280;
          text-align: center;
          display: none;
        }

        @media (min-width: 640px) {
          .step-label {
            display: block;
          }
        }

        .progress-bar {
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
          transition: width 0.4s ease;
        }

        /* Error Banner */
        .error-banner {
          background: #fee2e2;
          color: #991b1b;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }

        .error-icon {
          font-size: 18px;
        }

        /* Step Content */
        .step-content {
          margin-bottom: 24px;
        }

        .step-content h2 {
          margin: 0 0 8px;
          font-size: 24px;
          color: #111827;
        }

        .step-description {
          margin: 0 0 24px;
          color: #6b7280;
          font-size: 14px;
        }

        .optional-badge {
          display: inline-block;
          background: #dbeafe;
          color: #1e40af;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 16px;
        }

        /* Welcome Section */
        .welcome-section {
          text-align: center;
          padding: 20px 0;
        }

        .welcome-section h1 {
          margin: 0 0 16px;
          font-size: 28px;
          color: #111827;
        }

        .welcome-text {
          color: #4b5563;
          line-height: 1.6;
          margin-bottom: 32px;
        }

        .benefits-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
          text-align: left;
        }

        .benefit-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #f9fafb;
          border-radius: 8px;
        }

        .benefit-icon {
          font-size: 24px;
        }

        /* Form Groups */
        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        }

        .form-group input[type="text"],
        .form-group input[type="tel"] {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 16px;
          transition: border-color 0.2s;
        }

        .form-group input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        /* Crop Grid */
        .crop-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }

        @media (min-width: 480px) {
          .crop-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        .crop-button {
          padding: 12px;
          border: 2px solid #e5e7eb;
          background: white;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .crop-button.selected {
          background: #667eea;
          color: white;
          border-color: #667eea;
        }

        /* Radio Group */
        .radio-group {
          display: flex;
          gap: 16px;
        }

        .radio-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          padding: 12px 16px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          flex: 1;
        }

        .radio-label input[type="radio"] {
          cursor: pointer;
        }

        /* Wallet Section */
        .wallet-connected {
          text-align: center;
          padding: 32px;
          background: #d1fae5;
          border-radius: 12px;
        }

        .success-icon {
          width: 48px;
          height: 48px;
          background: #10b981;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          margin: 0 auto 16px;
        }

        .success-text {
          color: #065f46;
          font-weight: 600;
          margin: 0 0 8px;
        }

        .wallet-address {
          color: #047857;
          font-size: 12px;
          font-family: monospace;
          word-break: break-all;
          margin: 0;
        }

        .wallet-prompt {
          text-align: center;
          padding: 32px;
        }

        .wallet-prompt p {
          color: #4b5563;
          margin-bottom: 20px;
        }

        .connect-wallet-button {
          padding: 14px 28px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
        }

        /* Navigation Buttons */
        .navigation-buttons {
          display: flex;
          gap: 12px;
          justify-content: space-between;
        }

        .nav-button {
          flex: 1;
          padding: 14px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .nav-button.primary {
          background: #667eea;
          color: white;
        }

        .nav-button.primary:hover:not(:disabled) {
          background: #764ba2;
        }

        .nav-button.secondary {
          background: #e5e7eb;
          color: #374151;
        }

        .nav-button.secondary:hover:not(:disabled) {
          background: #d1d5db;
        }

        .nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .nav-button.submit {
          background: #10b981;
        }

        .nav-button.submit:hover:not(:disabled) {
          background: #059669;
        }
      `}</style>
    </div>
  );
}