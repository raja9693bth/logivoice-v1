import { test, expect } from '@playwright/test';

test.describe('LogiVoice V1 — Administrative Portal Smoke & Governance Suite', () => {
  test.beforeEach(async ({ context }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
    await context.addCookies([
      {
        name: 'logivoice_dev_session',
        value: 'true',
        url: baseUrl,
      },
    ]);
  });

  test('1. Authentication Flow: Login page renders and allows local dev session entry', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/login');

    await expect(page.locator('h1')).toContainText('LogiVoice V1');
    await expect(page.locator('text=Dispatcher Sign In')).toBeVisible();

    const devSessionBtn = page.locator('button:has-text("Enter Dev Session")');
    if (await devSessionBtn.isVisible()) {
      await devSessionBtn.click();
      await page.waitForURL('**/admin', { timeout: 10000 });
      await expect(page).toHaveURL(/\/admin/);
    }
  });

  test('2. Calls Console: Displays Inbound Voice Calls and search/temperature filters', async ({ page }) => {
    await page.goto('/admin/calls');

    await expect(page.locator('h1')).toContainText('Inbound Voice Calls');
    await expect(page.locator('main input[placeholder*="Search"]')).toBeVisible();

    const tempSelect = page.locator('select').filter({ hasText: 'All Temps' });
    await expect(tempSelect).toBeVisible();
  });

  test('3. Requests Management: Type tabs, search, and status filtering', async ({ page }) => {
    await page.goto('/admin/requests');

    await expect(page.locator('h1')).toContainText('Operations Requests');
    await expect(page.locator('main input[placeholder*="Search"]')).toBeVisible();
    await expect(page.locator('button:has-text("All Requests")').first()).toBeVisible();
  });

  test('4. Leads Pipeline: Displays Commercial Leads and search controls', async ({ page }) => {
    await page.goto('/admin/leads');

    await expect(page.locator('h1')).toContainText('Leads & Post-Call Nurturing');
    await expect(page.locator('main input[placeholder*="Search"]')).toBeVisible();
  });

  test('5. Rate Cards: Displays Approved Rate Cards, CSV Import, and Search', async ({ page }) => {
    await page.goto('/admin/rate-cards');

    await expect(page.locator('h1')).toContainText('Approved Rate Cards');
    await expect(page.locator('button:has-text("Import CSV")')).toBeVisible();
    await expect(page.locator('input[placeholder*="Filter by origin city"]')).toBeVisible();
  });

  test('6. Knowledge Base: Displays Approved Operational Knowledge and Category filter', async ({ page }) => {
    await page.goto('/admin/knowledge');

    await expect(page.locator('h1')).toContainText('Approved Operational Knowledge');
    await expect(page.locator('main input[placeholder*="Search"]')).toBeVisible();

    const categorySelect = page.locator('select').filter({ hasText: 'All Categories' });
    await expect(categorySelect).toBeVisible();
  });

  test('7. Settings: Displays System & Tenant Settings and configuration tabs', async ({ page }) => {
    await page.goto('/admin/settings');

    await expect(page.locator('h1')).toContainText('System & Tenant Settings');
    await expect(page.locator('button:has-text("Business Profile")')).toBeVisible();
    await expect(page.locator('button:has-text("Voice & Language")')).toBeVisible();
  });

  test('8. Forensic Audit Log: Displays System Status & Audit Logs and status cards', async ({ page }) => {
    await page.goto('/admin/audit');

    await expect(page.locator('h1')).toContainText('System Status & Audit Logs');
    await expect(page.locator('text=Audit Logging Active')).toBeVisible();
  });
});
