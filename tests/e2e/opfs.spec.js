// F5 W1 (IO-01): OPFS game library — import once, reload, still there, boots from OPFS.
const { test, expect } = require('@playwright/test');

test('OPFS persistence: import -> reload -> persists -> boots', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ps2web && window.__ps2web.ready && window.__ps2web.diskStore, null, { timeout: 60000 });

  const saved = await page.evaluate(() => window.__ps2web.importAndSave('/fixtures/cube.elf'));
  expect(saved.size, 'imported bytes').toBeGreaterThan(0);

  let list = await page.evaluate(() => window.__ps2web.diskStore.list());
  expect(list, 'listed after import').toContain('cube.elf');

  // reload → persistence across sessions is the whole point of OPFS
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ps2web && window.__ps2web.ready && window.__ps2web.diskStore, null, { timeout: 60000 });
  list = await page.evaluate(() => window.__ps2web.diskStore.list());
  expect(list, 'game persists across reload (OPFS)').toContain('cube.elf');

  const booted = await page.evaluate(() => window.__ps2web.bootElfFromOpfs('cube.elf'));
  expect(booted.size).toBeGreaterThan(0);
  await page.waitForTimeout(8000);
  const m = await page.evaluate(() => window.__ps2web_metrics);
  console.log(`[opfs] persisted + booted from OPFS, fps=${m.fps}`);
  expect(m.fps, 'boots from OPFS and runs').toBeGreaterThan(0);

  await page.evaluate(() => window.__ps2web.diskStore.remove('cube.elf').catch(() => {}));
});
