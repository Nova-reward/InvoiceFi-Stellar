import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

export type WalletRole = 'FARMER' | 'INVESTOR';

interface StellarAccount {
  publicKey: string;
  secretKey: string;
}

interface TestFixtures {
  farmerPage: Page;
  investorPage: Page;
  apiContext: APIRequestContext;
  farmerAccount: StellarAccount;
  investorAccount: StellarAccount;
  fundedInvoiceId: string;
}

const API_URL = process.env.API_URL || 'http://localhost:4000';

export const test = base.extend<TestFixtures>({
  apiContext: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
    await use(context);
    await context.dispose();
  },

  farmerAccount: async ({}, use) => {
    const account = JSON.parse(process.env.FARMER_STELLAR_ACCOUNT || '{}');
    await use(account);
  },

  investorAccount: async ({}, use) => {
    const account = JSON.parse(process.env.INVESTOR_STELLAR_ACCOUNT || '{}');
    await use(account);
  },

  farmerPage: async ({ browser, farmerAccount }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, farmerAccount.publicKey);
    await use(page);
    await context.close();
  },

  investorPage: async ({ browser, investorAccount }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockFreighter(page, investorAccount.publicKey);
    await use(page);
    await context.close();
  },

  fundedInvoiceId: async ({ farmerPage }, use) => {
    const id = await createInvoiceViaAPI(farmerPage);
    await use(id);
  },
});

export { expect };

export async function mockFreighter(page: Page, publicKey: string) {
  await page.addInitScript((pk: string) => {
    (window as any).FreighterApi = {
      getPublicKey: async () => pk,
      isConnected: async () => true,
      getNetwork: async () => ({
        network: 'Standalone Network ; February 2017',
        networkUrl: 'http://localhost:8000',
        networkPassphrase: 'Standalone Network ; February 2017',
      }),
      signTransaction: async (tx: string) => tx,
      on: (_event: string, _cb: Function) => {},
      off: (_event: string, _cb: Function) => {},
    };
  }, publicKey);
}

export async function disconnectFreighter(page: Page) {
  await page.addInitScript(() => {
    (window as any).FreighterApi = undefined;
  });
}

export async function connectWalletAsRole(
  page: Page,
  role: WalletRole,
  apiContext: APIRequestContext,
  walletAddress: string,
): Promise<string> {
  const res = await apiContext.post('/auth/connect-wallet', {
    data: { walletAddress, role },
  });
  const body = await res.json();
  const cookies = await res.headersArray();

  const tokenHeader = cookies.find(
    (h) => h.name === 'set-cookie' && h.value.startsWith('token='),
  );

  if (tokenHeader) {
    const tokenValue = tokenHeader.value.split(';')[0].replace('token=', '');
    await page.context().addCookies([
      {
        name: 'token',
        value: tokenValue,
        domain: new URL(page.url()).hostname,
        path: '/',
      },
    ]);
  }

  await page.evaluate(
    ({ address, r }) => {
      sessionStorage.setItem('walletAddress', address);
      sessionStorage.setItem('walletRole', r);
    },
    { address: walletAddress, r: role },
  );

  return body.accessToken || '';
}

export async function waitForServiceReady(apiContext: APIRequestContext) {
  const maxRetries = 30;
  const delay = 2000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await apiContext.get('/health');
      if (res.ok()) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('Services not ready after timeout');
}

async function createInvoiceViaAPI(page: Page): Promise<string> {
  const crypto = await import('crypto');
  const onchainId = BigInt(crypto.randomBytes(8).readBigUInt64BE(0));

  const res = await page.request.post(`${API_URL}/invoices`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      onchainId: onchainId.toString(),
      faceValue: 50000,
      farmer: process.env.FARMER_WALLET_ADDRESS || 'FARMER_PLACEHOLDER',
      status: 'PENDING',
    },
  });

  if (res.ok()) {
    const body = await res.json();
    return body.onchainId || onchainId.toString();
  }

  return onchainId.toString();
}
