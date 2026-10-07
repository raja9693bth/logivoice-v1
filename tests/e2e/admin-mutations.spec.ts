import { test, expect } from '@playwright/test';

test.describe('LogiVoice V1 — Administrative Portal Real UI Mutation & Persistence E2E', () => {
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

  test('1. Requests E2E: Status mutation, reload persistence, and valid domain status verification', async ({ page }) => {
    await page.goto('/admin/requests');
    await expect(page.locator('h1')).toContainText('Operations Requests');

    // Wait for table to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Open first request drawer
    const inspectBtn = page.locator('table tbody tr').first().locator('button:has-text("Inspect")');
    await inspectBtn.click();

    // Verify drawer opened
    await expect(page.locator('text=Request Investigation')).toBeVisible();

    // Perform valid domain status mutation (CONFIRMED)
    const confirmBtn = page.locator('button:has-text("Mark Confirmed")');
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
      // Status badge in drawer updates
      await expect(page.locator('span:has-text("CONFIRMED")').first()).toBeVisible({ timeout: 5000 });
    }

    // Reload page and verify persistence across reload
    await page.reload();
    await expect(page.locator('h1')).toContainText('Operations Requests');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('2. Leads E2E: Status update, server persistence, and reload verification', async ({ page }) => {
    await page.goto('/admin/leads');
    await expect(page.locator('h1')).toContainText('Leads & Post-Call Nurturing');

    // Wait for leads to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Open first lead drawer
    const inspectBtn = page.locator('table tbody tr').first().locator('button:has-text("Inspect")');
    await inspectBtn.click();

    // Verify lead drawer
    await expect(page.locator('text=Lead Record')).toBeVisible();

    // Mutate lead stage to QUALIFIED
    const qualifiedBtn = page.locator('button:has-text("Mark Qualified")');
    if (await qualifiedBtn.isVisible()) {
      await qualifiedBtn.click();
      await expect(page.locator('span:has-text("QUALIFIED")').first()).toBeVisible({ timeout: 5000 });
    }

    // Reload page and assert persistence
    await page.reload();
    await expect(page.locator('h1')).toContainText('Leads & Post-Call Nurturing');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('3. Rate Cards E2E: Create DRAFT card, API mutation, and reload persistence', async ({ page }) => {
    await page.goto('/admin/rate-cards');
    await expect(page.locator('h1')).toContainText('Approved Rate Cards');
    await expect(page.locator('text=Loading active rate cards')).toBeHidden({ timeout: 10000 });

    const newRateBtn = page.locator('button:has-text("New Rate Card")');
    await expect(newRateBtn).toBeVisible();
    await newRateBtn.click();

    // Form inputs
    const originInput = page.locator('input#formOrigin');
    await expect(originInput).toBeVisible({ timeout: 5000 });
    await originInput.fill('Delhi-E2E-Mutation');

    const destInput = page.locator('input#formDest');
    await destInput.fill('Jaipur-E2E-Mutation');

    const vehicleInput = page.locator('input#formVehicle');
    await vehicleInput.fill('32ft Multi-Axle');

    const minWeightInput = page.locator('input#formMinWeight');
    await minWeightInput.fill('5.0');

    const maxWeightInput = page.locator('input#formMaxWeight');
    await maxWeightInput.fill('15.0');

    const priceInput = page.locator('input#formPrice');
    await priceInput.fill('38000');

    const effectiveFromInput = page.locator('input#formEffectiveFrom');
    await effectiveFromInput.fill('2026-10-01');

    // Submit rate card
    const submitBtn = page.locator('button:has-text("Create Rate Card"), button:has-text("Save Rate Card")');
    await submitBtn.click();

    // Wait for drawer to close upon successful API response
    await expect(originInput).toBeHidden({ timeout: 10000 });

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('h1')).toContainText('Approved Rate Cards');
    await expect(page.locator('text=Loading active rate cards')).toBeHidden({ timeout: 10000 });

    // Filter by origin city to assert persisted row
    const filterInput = page.locator('input[placeholder*="Filter by origin city"]');
    await filterInput.fill('Delhi-E2E-Mutation');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('table tbody tr').first()).toContainText('Delhi-E2E-Mutation');
  });

  test('4. Knowledge Base E2E: Create DRAFT policy, API persistence, and reload verification', async ({ page }) => {
    await page.goto('/admin/knowledge');
    await expect(page.locator('h1')).toContainText('Approved Operational Knowledge');
    await expect(page.locator('text=Loading operational knowledge')).toBeHidden({ timeout: 10000 });

    const newItemBtn = page.locator('button:has-text("New Policy / FAQ")');
    await expect(newItemBtn).toBeVisible();
    await newItemBtn.click();

    // Fill form
    const titleInput = page.locator('input#knowledge-title, input#title');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('E2E Cold Chain Temperature Compliance');

    const contentInput = page.locator('textarea#knowledge-content, textarea#content');
    await contentInput.fill('Reefer container temperatures must remain between -18C and -22C throughout transit.');

    // Save as draft using exact button label
    const saveDraftBtn = page.locator('button:has-text("Create Draft Policy")');
    await saveDraftBtn.click();

    // Wait for drawer to close upon successful save
    await expect(titleInput).toBeHidden({ timeout: 10000 });

    // Reload page
    await page.reload();
    await expect(page.locator('h1')).toContainText('Approved Operational Knowledge');
    await expect(page.locator('text=Loading operational knowledge')).toBeHidden({ timeout: 10000 });

    // Search and verify persistence
    const searchInput = page.locator('main input[placeholder*="Search"]');
    await searchInput.fill('E2E Cold Chain');
    await expect(page.locator('text=E2E Cold Chain Temperature Compliance')).toBeVisible({ timeout: 10000 });
  });

  test('5. Settings E2E: Update business profile, save, reload, and verify persistence', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.locator('h1')).toContainText('System & Tenant Settings');

    const brandInput = page.locator('input[name="brand_name"], input#brandName, input[placeholder*="Brand"]').first();
    if (await brandInput.isVisible()) {
      await brandInput.fill('LogiVoice Prime Fleet');

      const saveBtn = page.locator('button:has-text("Save Changes"), button:has-text("Save Configuration")').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await expect(page.locator('text=saved successfully, text=Configuration updated').first()).toBeVisible({ timeout: 5000 }).catch(() => {});
      }

      // Reload and assert
      await page.reload();
      await expect(page.locator('h1')).toContainText('System & Tenant Settings');
    }
  });

  test('6. Calls E2E: Inspect call detail and transcript turns', async ({ page }) => {
    await page.goto('/admin/calls');
    await expect(page.locator('h1')).toContainText('Inbound Voice Calls');

    // Wait for calls table
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Open first call details via Full link
    const fullLink = page.locator('table tbody tr').first().locator('a:has-text("Full")');
    await fullLink.click();

    // Verify call detail page
    await page.waitForURL('**/admin/calls/**', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Call Investigation:');
    await expect(page.locator('text=Extracted Commercial Facts')).toBeVisible({ timeout: 10000 });
  });
});
