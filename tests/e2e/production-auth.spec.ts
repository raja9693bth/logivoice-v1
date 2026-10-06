import { test, expect } from '@playwright/test';

test.describe('LogiVoice V1 — Production Mode Auth & Proxy Security E2E', () => {
  test('1. Production /admin strictly redirects to /login when unauthenticated', async ({ page, context }) => {
    await context.clearCookies();
    const response = await page.goto('/admin');
    
    // In production, unauthenticated /admin must redirect to /login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toContainText('LogiVoice V1');
    await expect(page.locator('text=Dispatcher Sign In')).toBeVisible();
  });

  test('2. Dev cookie bypass (logivoice_dev_session) is strictly denied in production', async ({ page, context }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
    await context.addCookies([
      {
        name: 'logivoice_dev_session',
        value: 'true',
        url: baseUrl,
      },
    ]);

    await page.goto('/admin');
    // Must still redirect to /login because dev session bypass is forbidden in production
    await expect(page).toHaveURL(/\/login/);
  });

  test('3. Login page does NOT display Enter Dev Session button in production mode', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/login');

    const devBtn = page.locator('button:has-text("Enter Dev Session")');
    // In production, the dev bypass button is completely absent
    await expect(devBtn).toHaveCount(0);
  });

  test('4. Graceful handling of AUTH_TEMPORARILY_UNAVAILABLE error banner', async ({ page }) => {
    await page.goto('/login?error=AUTH_TEMPORARILY_UNAVAILABLE');

    await expect(page.locator('text=Authentication service is temporarily unavailable')).toBeVisible();
  });

  test('5. Health liveness and readiness endpoints return boundedly', async ({ request }) => {
    const liveRes = await request.get('/api/health?check=liveness');
    expect(liveRes.status()).toBe(200);
    const liveData = await liveRes.json();
    expect(liveData.status).toBe('UP');
    expect(liveData.version).toBe('1.0.2');

    const readyRes = await request.get('/api/health');
    expect([200, 503]).toContain(readyRes.status());
    const readyData = await readyRes.json();
    expect(['HEALTHY', 'DEGRADED']).toContain(readyData.status);
    expect(readyData.version).toBe('1.0.2');
  });
});
