import * as fc from 'fast-check';
import { FinancialCalculations } from './financial-calculations';

describe('Financial Calculations Property Tests', () => {
  const EXAMPLES = 10000;

  describe('Invariant 1: Discount monotonicity', () => {
    it('higher discount rates yield higher discounts for same face value', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 9999 })),
          ([faceValue, rate1]) => {
            const rate2 = rate1 + 1;
            if (rate2 > 10000) return true;

            const discount1 = FinancialCalculations.calculateDiscount(faceValue, rate1);
            const discount2 = FinancialCalculations.calculateDiscount(faceValue, rate2);

            return discount1 <= discount2;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 2: Discount and advance sum to face value', () => {
    it('discount + advance = face value', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 9999 })),
          ([faceValue, rate]) => {
            const discount = FinancialCalculations.calculateDiscount(faceValue, rate);
            const advance = FinancialCalculations.calculateAdvanceAmount(faceValue, rate);

            const sum = Math.round((discount + advance) * 100) / 100;
            return sum === faceValue;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 3: Advance never exceeds face value', () => {
    it('advance <= face value for all valid inputs', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 9999 })),
          ([faceValue, rate]) => {
            const advance = FinancialCalculations.calculateAdvanceAmount(faceValue, rate);
            return advance <= faceValue && advance >= 0;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 4: Fee calculation monotonicity', () => {
    it('higher amounts yield higher fees for same rate', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 1000000 }),
            fc.integer({ min: 0, max: 1000 }),
            fc.integer({ min: 1, max: 1000 }),
          ),
          ([amount1, rate, delta]) => {
            const amount2 = amount1 + delta;
            const fee1 = FinancialCalculations.calculateFeeAmount(amount1, rate);
            const fee2 = FinancialCalculations.calculateFeeAmount(amount2, rate);

            return fee1 <= fee2;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 5: Pool utilization bounded by [0, 100]', () => {
    it('utilization is always between 0 and 100 percent', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 1, max: 1000000 })),
          ([funded, deposited]) => {
            const utilization = FinancialCalculations.calculatePoolUtilization(funded, deposited);
            return utilization >= 0 && utilization <= 100;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 6: Pool utilization increases with more funding', () => {
    it('higher funding yields higher or equal utilization', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 1000000 }),
            fc.integer({ min: 1, max: 100 }),
            fc.integer({ min: 1, max: 1000000 }),
          ),
          ([deposited, delta, base]) => {
            const funded1 = base;
            const funded2 = base + delta;
            if (funded2 > deposited) return true;

            const util1 = FinancialCalculations.calculatePoolUtilization(funded1, deposited);
            const util2 = FinancialCalculations.calculatePoolUtilization(funded2, deposited);

            return util1 <= util2;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 7: Repayment schedule non-negative', () => {
    it('repayment amount is always non-negative', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 1, max: 1000000 }),
            fc.integer({ min: 1, max: 360 }),
            fc.integer({ min: 0, max: 2400 }),
          ),
          ([principal, payments, rate]) => {
            const amount = FinancialCalculations.calculateRepaymentScheduleAmount(principal, payments, rate);
            return amount >= 0;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 8: Total repayment >= principal', () => {
    it('total repayment with interest always exceeds or equals principal', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 1, max: 1000000 }),
            fc.integer({ min: 1, max: 360 }),
            fc.integer({ min: 0, max: 2400 }),
          ),
          ([principal, payments, rate]) => {
            const total = FinancialCalculations.calculateTotalRepaymentAmount(principal, payments, rate);
            return total >= principal;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 9: Discount rate idempotency', () => {
    it('applying discount twice to the same values yields consistent results', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 9999 })),
          ([faceValue, rate]) => {
            const discount1 = FinancialCalculations.calculateDiscount(faceValue, rate);
            const discount2 = FinancialCalculations.calculateDiscount(faceValue, rate);

            return discount1 === discount2;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 10: Fee is non-negative', () => {
    it('fee is always >= 0', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 10000 })),
          ([amount, rate]) => {
            const fee = FinancialCalculations.calculateFeeAmount(amount, rate);
            return fee >= 0;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 11: Advance increases as discount decreases', () => {
    it('lower discount rate yields higher advance amount', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 9998 })),
          ([faceValue, rate1]) => {
            const rate2 = rate1 + 1;
            const advance1 = FinancialCalculations.calculateAdvanceAmount(faceValue, rate1);
            const advance2 = FinancialCalculations.calculateAdvanceAmount(faceValue, rate2);

            return advance1 >= advance2;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 12: Zero discount rate yields full advance', () => {
    it('0% discount rate means advance equals face value', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000000 }), (faceValue) => {
          const advance = FinancialCalculations.calculateAdvanceAmount(faceValue, 0);
          return advance === faceValue;
        }),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 13: Maximum discount rate boundary', () => {
    it('maximum discount rate (9999 bps) yields valid discount', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000000 }), (faceValue) => {
          const discount = FinancialCalculations.calculateDiscount(faceValue, 9999);
          return discount >= 0 && discount < faceValue;
        }),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 14: Conservation of value in repayment', () => {
    it('sum of all payments equals total repayment amount', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 1, max: 1000000 }),
            fc.integer({ min: 1, max: 360 }),
            fc.integer({ min: 0, max: 2400 }),
          ),
          ([principal, payments, rate]) => {
            const payment = FinancialCalculations.calculateRepaymentScheduleAmount(principal, payments, rate);
            const total = FinancialCalculations.calculateTotalRepaymentAmount(principal, payments, rate);
            const sumOfPayments = Math.round(payment * payments * 100) / 100;

            return Math.abs(sumOfPayments - total) < 0.01;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });

  describe('Invariant 15: Fee does not exceed amount', () => {
    it('fee rate never produces fee > amount', () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.integer({ min: 0, max: 1000000 }), fc.integer({ min: 0, max: 10000 })),
          ([amount, rate]) => {
            const fee = FinancialCalculations.calculateFeeAmount(amount, rate);
            return fee <= amount;
          },
        ),
        { numRuns: EXAMPLES },
      );
    });
  });
});
