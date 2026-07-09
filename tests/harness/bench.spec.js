// F1 harness (OBS-02): boot a homebrew ELF, sample window.__ps2web_metrics,
// emit bench/results/<fixture>.json. Baseline is measured on this same CI/
// headless (swiftshader) rig — it is a RELATIVE reference for F3 speedup, not
// the "desktop medio 60fps" T1 target (that is measured manually by the human).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURE = process.env.BENCH_FIXTURE || 'cube';
const SECONDS = parseInt(process.env.BENCH_SECONDS || '30', 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP || '5', 10);

test(`bench ${FIXTURE}`, async ({ page }) => {
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Wait for the emulator module + PS2WEB hooks to be ready.
  await page.waitForFunction(() => (window).__ps2web && (window).__ps2web.ready, null, { timeout: 60000 });

  const booted = await page.evaluate((f) => (window).__ps2web.bootElfFromUrl(`/fixtures/${f}.elf`), FIXTURE);
  expect(booted.size, 'fixture ELF non-empty').toBeGreaterThan(0);

  await page.waitForTimeout(WARMUP * 1000); // warmup (JIT compile of hot blocks)

  const samples = [];
  for (let i = 0; i < SECONDS; i++) {
    await page.waitForTimeout(1000);
    const m = await page.evaluate(() => (window).__ps2web_metrics);
    samples.push(m);
  }

  const fpsArr = samples.map(s => s.fps).filter(x => typeof x === 'number');
  const msArr = samples.map(s => s.msPerFrame).filter(x => x > 0).sort((a, b) => a - b);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const p95 = a => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0;

  const result = {
    fixture: FIXTURE,
    rig: 'ci-headless-swiftshader',
    seconds: SECONDS,
    warmup: WARMUP,
    avgFps: Math.round(avg(fpsArr) * 100) / 100,
    minFps: fpsArr.length ? Math.min(...fpsArr) : 0,
    maxFps: fpsArr.length ? Math.max(...fpsArr) : 0,
    avgEmuSpeedPct: Math.round(avg(samples.map(s => s.emuSpeedPct)) * 10) / 10,
    p95MsPerFrame: Math.round(p95(msArr) * 100) / 100,
    fixtureBytes: booted.size,
    frameHashes: samples.map(s => s.frameHash),
    samples,
    upstream: fs.existsSync(path.join(__dirname, '../../UPSTREAM.lock'))
      ? fs.readFileSync(path.join(__dirname, '../../UPSTREAM.lock'), 'utf8').trim() : null,
    generatedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, '../../bench/results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${FIXTURE}.json`), JSON.stringify(result, null, 2));
  if (FIXTURE === 'cube') fs.writeFileSync(path.join(outDir, 'baseline.json'), JSON.stringify(result, null, 2));

  console.log(`[bench] ${FIXTURE} avgFps=${result.avgFps} emuSpeed=${result.avgEmuSpeedPct}% p95ms=${result.p95MsPerFrame}`);
  expect(result.avgFps, 'emulator produced frames (fixture booted & rendered)').toBeGreaterThan(0);
});
