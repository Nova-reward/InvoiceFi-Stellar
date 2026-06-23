import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { execSync } from 'child_process';

describe('Invoice Lifecycle Integration (e2e)', () => {
  let app: INestApplication;
  let invoiceId: string;

  beforeAll(async () => {
    // Spin up local Stellar network (Standalone) and deploy contracts
    console.log('Starting local Stellar network...');
    try {
      execSync('docker compose up -d stellar-standalone', { cwd: '../' });
      // Wait for horizon to become available
      execSync('sleep 5');
      // Simulated deploy script
      // execSync('./scripts/deploy.sh');
    } catch (error) {
      console.warn('Network setup warning:', error.message);
    }

    // Initialize NestJS app
    // Mocking AppModule for compilation in empty repository, normally this would be:
    // import { AppModule } from './../src/app.module';
    class MockAppModule {}

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MockAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    try {
      execSync('docker compose stop stellar-standalone', { cwd: '../' });
    } catch (e) {}
  });

  it('should create an invoice', async () => {
    const payload = {
      amount: 5000,
      currency: 'USDC',
      yieldRate: 0.05,
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .send(payload)
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('CREATED');
    invoiceId = res.body.id;

    // Validate DB State
    const dbCheck = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .expect(200);
    expect(dbCheck.body.status).toBe('CREATED');
  });

  it('should fund the invoice', async () => {
    const payload = {
      funderId: 'investor-456',
      amount: 5000,
    };

    const res = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/fund`)
      .send(payload)
      .expect(200);

    expect(res.body.status).toBe('FUNDED');
    expect(res.body).toHaveProperty('txHash'); // On-chain transaction hash

    // Validate DB State
    const dbCheck = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .expect(200);
    expect(dbCheck.body.status).toBe('FUNDED');
  });

  it('should repay the invoice', async () => {
    const payload = {
      amount: 5250, // 5000 principal + 5% yield
    };

    const res = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/repay`)
      .send(payload)
      .expect(200);

    expect(res.body.status).toBe('REPAID');

    // Validate DB State
    const dbCheck = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .expect(200);
    expect(dbCheck.body.status).toBe('REPAID');
  });

  it('should assert REPAID status on-chain', async () => {
    // Querying the API to read the Soroban contract state directly
    const res = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}/onchain-status`)
      .expect(200);

    expect(res.body.onChainStatus).toBe('REPAID');
    expect(res.body.contractId).toBeDefined();
  });
});
