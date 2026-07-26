import { test as base, expect, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { mockFreighter, disconnectFreighter } from './test-fixtures';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export interface TestUser {
  publicKey: string;
  secretKey: string;
  role: 'FARMER' | 'INVESTOR';
}

export class WalletHelper {
  private page: Page;
  private user: TestUser;

  constructor(page: Page, user: TestUser) {
    this.page = page;
    this.user = user;
  }

  async connect(): Promise<void> {
    await this.page.goto('/connect-wallet');
    await this.page.waitForLoadState('networkidle');

    const roleRadio = this.page.locator(`input[type="radio"][value="${this.user.role}"]`);
    if (await roleRadio.isVisible()) {
      await roleRadio.check();
    }

    await this.page.locator('button.connect-button, button:has-text("Connect Freighter")').click();
    await this.page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  }

  async disconnect(): Promise<void> {
    await disconnectFreighter(this.page);

    const logoutBtn = this.page.locator('button:has-text("Logout"), button:has-text("Disconnect")');
    if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logoutBtn.click();
    }

    await this.page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
      document.cookie.split(';').forEach((c) => {
        document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
      });
    });
  }

  async navigateTo(path: string): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }
}

export class APIHelper {
  private context: APIRequestContext;
  private token: string = '';

  constructor(context: APIRequestContext) {
    this.context = context;
  }

  async authenticate(walletAddress: string, role: string): Promise<void> {
    const res = await this.context.fetch(`${API_URL}/auth/connect-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: { walletAddress, role },
    });
    const body = await res.json();
    this.token = body.accessToken;
  }

  get authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  async createInvoice(data: any) {
    return this.context.fetch(`${API_URL}/invoices`, {
      method: 'POST',
      headers: this.authHeaders,
      data,
    });
  }

  async fundInvoice(invoiceId: string, amount: number, discountRate: number) {
    return this.context.fetch(`${API_URL}/financing-pool/fund`, {
      method: 'POST',
      headers: this.authHeaders,
      data: { invoiceId, amount, discountRate },
    });
  }

  async settleInvoice(invoiceId: string) {
    return this.context.fetch(`${API_URL}/settlement/settle`, {
      method: 'POST',
      headers: this.authHeaders,
      data: { invoiceId },
    });
  }

  async getInvoices() {
    return this.context.fetch(`${API_URL}/invoices`, {
      method: 'GET',
      headers: this.authHeaders,
    });
  }

  async getInvoice(onchainId: string) {
    return this.context.fetch(`${API_URL}/invoices/${onchainId}`, {
      method: 'GET',
      headers: this.authHeaders,
    });
  }

  async getPoolStats() {
    return this.context.fetch(`${API_URL}/pool/stats`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async healthCheck() {
    return this.context.fetch(`${API_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export { mockFreighter, disconnectFreighter };
