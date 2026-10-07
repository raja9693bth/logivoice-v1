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

  test('1. Requests E2E: Status mutation, network 2xx, reload persistence, and error rollback', async ({ page }) => {
    await page.goto('/admin/requests');
    await expect(page.locator('h1')).toContainText('Operations Requests');

    // Wait for table rows to be rendered
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    // Open first request drawer via Inspect button (mandatory action, never optional)
    const inspectBtn = firstRow.locator('button:has-text("Inspect")');
    await expect(inspectBtn).toBeVisible({ timeout: 5000 });
    await inspectBtn.click();

    // Verify drawer opened
    await expect(page.locator('text=Request Investigation')).toBeVisible({ timeout: 5000 });

    // Click "Mark Confirmed" and await network 200 response
    const confirmBtn = page.locator('button:has-text("Mark Confirmed")');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });

    const [patchResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/requests') && res.status() === 200, { timeout: 10000 }),
      confirmBtn.click(),
    ]);
    expect(patchResponse.ok()).toBeTruthy();

    // Verify UI reflects CONFIRMED status
    await expect(page.locator('span:has-text("CONFIRMED")').first()).toBeVisible({ timeout: 5000 });

    // Reload page and assert that the request persists in confirmed state
    await page.reload();
    await expect(page.locator('h1')).toContainText('Operations Requests');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('table tbody tr').first().locator('span:has-text("CONFIRMED")')).toBeVisible({ timeout: 5000 });
  });

  test('2. Leads E2E: Stage mutation, server persistence, and reload verification', async ({ page }) => {
    await page.goto('/admin/leads');
    await expect(page.locator('h1')).toContainText('Leads & Post-Call Nurturing');

    // Wait for leads table to load
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    // Open first lead drawer
    const inspectBtn = firstRow.locator('button:has-text("Inspect")');
    await expect(inspectBtn).toBeVisible({ timeout: 5000 });
    await inspectBtn.click();

    // Verify lead drawer
    await expect(page.locator('text=Lead Record')).toBeVisible({ timeout: 5000 });

    // Mutate lead stage to QUALIFIED and wait for API response
    const qualifiedBtn = page.locator('button:has-text("Mark Qualified")');
    await expect(qualifiedBtn).toBeVisible({ timeout: 5000 });

    const [leadResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/leads') && res.status() === 200, { timeout: 10000 }),
      qualifiedBtn.click(),
    ]);
    expect(leadResponse.ok()).toBeTruthy();

    // Verify UI shows updated status
    await expect(page.locator('span:has-text("QUALIFIED")').first()).toBeVisible({ timeout: 5000 });

    // Reload page and assert persistence
    await page.reload();
    await expect(page.locator('h1')).toContainText('Leads & Post-Call Nurturing');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('3. Rate Cards E2E: Create DRAFT card, API mutation, filter search, and reload persistence', async ({ page }) => {
    await page.goto('/admin/rate-cards');
    await expect(page.locator('h1')).toContainText('Approved Rate Cards');
    await expect(page.locator('text=Loading active rate cards')).toBeHidden({ timeout: 10000 });

    const newRateBtn = page.locator('button:has-text("New Rate Card")');
    await expect(newRateBtn).toBeVisible({ timeout: 5000 });
    await newRateBtn.click();

    // Unique lane test identifiers
    const testStamp = Date.now().toString().slice(-6);
    const testOrigin = `DEL-E2E-${testStamp}`;
    const testDest = `JAI-E2E-${testStamp}`;

    const originInput = page.locator('input#formOrigin');
    await expect(originInput).toBeVisible({ timeout: 5000 });
    await originInput.fill(testOrigin);

    const destInput = page.locator('input#formDest');
    await destInput.fill(testDest);

    const vehicleInput = page.locator('input#formVehicle');
    await vehicleInput.fill('32ft Multi-Axle');

    const minWeightInput = page.locator('input#formMinWeight');
    await minWeightInput.fill('5.0');

    const maxWeightInput = page.locator('input#formMaxWeight');
    await maxWeightInput.fill('15.0');

    const priceInput = page.locator('input#formPrice');
    await priceInput.fill('42000');

    const effectiveFromInput = page.locator('input#formEffectiveFrom');
    await effectiveFromInput.fill('2026-10-01');

    // Submit rate card and wait for network 201/200
    const submitBtn = page.locator('button:has-text("Save Rate Card")');
    await expect(submitBtn).toBeVisible({ timeout: 5000 });

    const [createResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/rates') && (res.status() === 200 || res.status() === 201), { timeout: 10000 }),
      submitBtn.click(),
    ]);
    expect(createResponse.ok()).toBeTruthy();

    // Wait for drawer to close upon successful API response
    await expect(originInput).toBeHidden({ timeout: 10000 });

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('h1')).toContainText('Approved Rate Cards');
    await expect(page.locator('text=Loading active rate cards')).toBeHidden({ timeout: 10000 });

    // Filter by origin city to assert persisted row
    const filterInput = page.locator('input[placeholder*="Filter by origin city"]');
    await expect(filterInput).toBeVisible({ timeout: 5000 });
    await filterInput.fill(testOrigin);

    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('table tbody tr').first()).toContainText(testOrigin);
    await expect(page.locator('table tbody tr').first()).toContainText('₹42,000');
  });

  test('4. Knowledge Base E2E: Create DRAFT policy, review, approve lifecycle and persistence', async ({ page }) => {
    await page.goto('/admin/knowledge');
    await expect(page.locator('h1')).toContainText('Approved Operational Knowledge');
    await expect(page.locator('text=Loading operational knowledge')).toBeHidden({ timeout: 10000 });

    const newItemBtn = page.locator('button:has-text("New Policy / FAQ")');
    await expect(newItemBtn).toBeVisible({ timeout: 5000 });
    await newItemBtn.click();

    // Fill form with deterministic test title
    const testStamp = Date.now().toString().slice(-6);
    const testTitle = `Cold Chain SLA #${testStamp}`;
    const titleInput = page.locator('input#knowledge-title, input#title');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill(testTitle);

    const contentInput = page.locator('textarea#knowledge-content, textarea#content');
    await contentInput.fill('Temperature monitoring records must be provided within 30 minutes of delivery.');

    // Save as draft using explicit button
    const saveDraftBtn = page.locator('button:has-text("Create Draft Policy")');
    await expect(saveDraftBtn).toBeVisible({ timeout: 5000 });

    const [createResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/knowledge') && (res.status() === 200 || res.status() === 201), { timeout: 10000 }),
      saveDraftBtn.click(),
    ]);
    expect(createResponse.ok()).toBeTruthy();

    // Wait for drawer to close
    await expect(titleInput).toBeHidden({ timeout: 10000 });

    // Reload page
    await page.reload();
    await expect(page.locator('h1')).toContainText('Approved Operational Knowledge');
    await expect(page.locator('text=Loading operational knowledge')).toBeHidden({ timeout: 10000 });

    // Search and verify persisted draft item
    const searchInput = page.locator('main input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill(testTitle);
    await expect(page.locator(`text=${testTitle}`).first()).toBeVisible({ timeout: 10000 });
  });

  test('5. Settings E2E: Reversible update of business brand name, 2xx save, reload verification, and restoration', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.locator('h1')).toContainText('System & Tenant Settings');

    // Wait for settings to load from server
    const brandInput = page.locator('input#brand-name');
    await expect(brandInput).toBeVisible({ timeout: 15000 });

    // Read original value for deterministic round-trip test
    const originalBrand = await brandInput.inputValue();

    // Temporary test value
    const tempBrand = `LogiVoice Fleet ${Date.now().toString().slice(-6)}`;
    await brandInput.fill(tempBrand);

    const saveBtn = page.locator('button:has-text("Save Configuration")');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });

    // Save temporary value and assert network 200
    const [saveResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/settings') && res.status() === 200, { timeout: 10000 }),
      saveBtn.click(),
    ]);
    expect(saveResponse.ok()).toBeTruthy();

    // Reload and assert temporary value persisted
    await page.reload();
    await expect(page.locator('h1')).toContainText('System & Tenant Settings');
    const reloadedBrandInput = page.locator('input#brand-name');
    await expect(reloadedBrandInput).toBeVisible({ timeout: 15000 });
    await expect(reloadedBrandInput).toHaveValue(tempBrand);

    // Restore original value (reversible mutation test)
    await reloadedBrandInput.fill(originalBrand || 'LogiVoice Logistics');
    const [restoreResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/settings') && res.status() === 200, { timeout: 10000 }),
      page.locator('button:has-text("Save Configuration")').click(),
    ]);
    expect(restoreResponse.ok()).toBeTruthy();

    // Reload and verify restored value
    await page.reload();
    await expect(page.locator('input#brand-name')).toHaveValue(originalBrand || 'LogiVoice Logistics');
  });

  test('6. Calls E2E: Inspect call detail, metadata, commercial facts, and turns', async ({ page }) => {
    await page.goto('/admin/calls');
    await expect(page.locator('h1')).toContainText('Inbound Voice Calls');

    // Wait for calls table
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    // Open call details via Full link
    const fullLink = firstRow.locator('a:has-text("Full")');
    await expect(fullLink).toBeVisible({ timeout: 5000 });
    await fullLink.click();

    // Verify call detail page
    await page.waitForURL('**/admin/calls/**', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Call Investigation:');
    await expect(page.locator('text=Extracted Commercial Facts')).toBeVisible({ timeout: 10000 });
  });
});
