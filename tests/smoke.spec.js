// F0 smoke: proves the cloud build produced a deployable, cross-origin-isolated
// site whose Play.wasm is a valid WebAssembly module. (ELF-boot smoke is F1.)
// Assertions POLL to avoid headless-server startup races (was flaky as a single evaluate).
const { test, expect } = require('@playwright/test');

test('F0 smoke: app shell loads, COOP/COEP active, Play.wasm valid', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });

  // COOP/COEP -> cross-origin isolation. Poll instead of reading once (startup race).
  await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 20000 });

  // Play.wasm served and is a valid WebAssembly module (retry a few times).
  const w = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch('/Play.wasm', { cache: 'no-store' });
        if (r.ok) {
          const buf = await r.arrayBuffer();
          const m = new Uint8Array(buf.slice(0, 4));
          const isWasm = m[0] === 0x00 && m[1] === 0x61 && m[2] === 0x73 && m[3] === 0x6d;
          let valid = false;
          try { valid = WebAssembly.validate(buf); } catch (e) {}
          return { ok: true, size: buf.byteLength, isWasm, valid };
        }
      } catch (e) {}
      await new Promise((res) => setTimeout(res, 500));
    }
    return { ok: false };
  });

  expect(w.ok, 'Play.wasm must be reachable (200)').toBeTruthy();
  expect(w.isWasm, 'Play.wasm must have the \\0asm magic header').toBeTruthy();
  expect(w.valid, 'Play.wasm must validate as WebAssembly').toBeTruthy();
  expect(w.size, 'Play.wasm should be non-trivial in size').toBeGreaterThan(100000);

  await page.screenshot({ path: 'test-results/f0-smoke.png', fullPage: true }).catch(() => {});
});
