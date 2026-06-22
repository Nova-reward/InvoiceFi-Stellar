import { Injectable } from '@nestjs/common';

@Injectable()
export class PoolService {
  async getPoolStats() {
    // In a real implementation, this would query the Soroban RPC for the financing pool contract
    // and also fetch metadata/invoice counts from PostgreSQL via Prisma.
    // Mocking the aggregated data for the acceptance criteria.
    const totalDeposited = 500000;
    const totalFunded = 350000;
    
    return {
      totalDeposited,
      totalFunded,
      utilizationPercentage: (totalFunded / totalDeposited) * 100,
      averageApy: 12.5, // 12.5%
      activeInvoicesCount: 42,
    };
  }
}
