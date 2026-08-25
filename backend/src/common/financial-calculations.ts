export class FinancialCalculations {
  static calculateDiscount(faceValue: number, discountRate: number): number {
    if (faceValue < 0 || discountRate < 0 || discountRate > 10000) {
      throw new Error('Invalid input: faceValue must be >= 0, discountRate must be 0-10000 bps');
    }
    const discount = (faceValue * discountRate) / 10000;
    return Math.round(discount * 100) / 100;
  }

  static calculateAdvanceAmount(faceValue: number, discountRate: number): number {
    if (faceValue < 0 || discountRate < 0 || discountRate > 10000) {
      throw new Error('Invalid input');
    }
    const discount = this.calculateDiscount(faceValue, discountRate);
    return faceValue - discount;
  }

  static calculateFeeAmount(amount: number, feeRate: number): number {
    if (amount < 0 || feeRate < 0 || feeRate > 10000) {
      throw new Error('Invalid input');
    }
    const fee = (amount * feeRate) / 10000;
    return Math.round(fee * 100) / 100;
  }

  static calculatePoolUtilization(totalFunded: number, totalDeposited: number): number {
    if (totalDeposited === 0) return 0;
    if (totalFunded < 0 || totalDeposited < 0 || totalFunded > totalDeposited) {
      throw new Error('Invalid input: funded must be <= deposited and both >= 0');
    }
    return Math.round((totalFunded / totalDeposited) * 10000) / 100;
  }

  static calculateRepaymentScheduleAmount(
    principalRemaining: number,
    numberOfPayments: number,
    interestRate: number,
  ): number {
    if (numberOfPayments <= 0 || principalRemaining < 0 || interestRate < 0) {
      throw new Error('Invalid input');
    }
    if (numberOfPayments === 0) return 0;
    if (interestRate === 0) return principalRemaining / numberOfPayments;

    const monthlyRate = interestRate / 100 / 12;
    const numerator = principalRemaining * monthlyRate * Math.pow(1 + monthlyRate, numberOfPayments);
    const denominator = Math.pow(1 + monthlyRate, numberOfPayments) - 1;
    return Math.round((numerator / denominator) * 100) / 100;
  }

  static calculateTotalRepaymentAmount(
    principalRemaining: number,
    numberOfPayments: number,
    interestRate: number,
  ): number {
    const paymentAmount = this.calculateRepaymentScheduleAmount(
      principalRemaining,
      numberOfPayments,
      interestRate,
    );
    return Math.round(paymentAmount * numberOfPayments * 100) / 100;
  }
}
