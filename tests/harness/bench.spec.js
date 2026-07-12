// F1/F2 harness (OBS-02): boot a homebrew ELF, sample window.__ps2web_metrics,
// emit bench/results/<fixture>.json. Baseline (bench/results/baseline.json) is
// IMMUTABLE (F1); this run compares against it. Rig = CI headless swiftshader:
// a RELATIVE reference for F3 speedup, not the "desktop 60fps" T1 target.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURE = process.env.BENCH_FIXTURE || 'cube';
const SECONDS = parseInt(process.env.BENCH_SECONDS || '30', 10);
const WARMUP = parseInt(process.env.BENCH_WARMUP || '5', 10);
// JIT-04 bisect: 0 = batcher off (upstream), 1 = batch+re-point but KEEP solo modules alive,
// 2 = full (re-point + release). One build, three hypotheses.
const BATCH_MODE = parseInt(process.env.BENCH_BATCH_MODE || '0', 10);

test(`bench ${FIXTURE}`, async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ps2web && window.__ps2web.ready, null, { timeout: 60000 });

  // Set the batch mode BEFORE booting, so the batcher's behaviour is fixed for the whole run.
  const modeSet = await page.evaluate((m) => {
    try { window.PlayModule.setBatchMode(m); return window.PlayModule.getBatchMode(); } catch (e) { return -1; }
  }, BATCH_MODE);
  console.log(`[jit-04] batchMode requested=${BATCH_MODE} actual=${modeSet}`);

  const booted = await page.evaluate((f) => window.__ps2web.bootElfFromUrl(`/fixtures/${f}.elf`), FIXTURE);
  expect(booted.size, 'fixture ELF non-empty').toBeGreaterThan(0);

  await page.waitForTimeout(WARMUP * 1000);

  const samples = [];
  for (let i = 0; i < SECONDS; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => window.__ps2web_metrics));
  }

  const fpsArr = samples.map(s => s.fps).filter(x => typeof x === 'number');
  const msArr = samples.map(s => s.msPerFrame).filter(x => x > 0).sort((a, b) => a - b);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const p95 = a => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0;

  const outDir = path.join(__dirname, '../../bench/results');
  fs.mkdirSync(outDir, { recursive: true });

  // Compare against the immutable F1 baseline frame hash (THR-02 regression signal).
  let baselineHash = null;
  const baselinePath = path.join(outDir, 'baseline.json');
  if (fs.existsSync(baselinePath)) {
    try { baselineHash = (JSON.parse(fs.readFileSync(baselinePath, 'utf8')).frameHashes || [])[0] ?? null; } catch (e) {}
  }
  const hashes = samples.map(s => s.frameHash);
  const stableHash = hashes.length ? hashes[hashes.length - 1] : null;

  const result = {
    fixture: FIXTURE,
    batchMode: BATCH_MODE,
    rig: 'ci-headless-swiftshader',
    seconds: SECONDS, warmup: WARMUP,
    avgFps: Math.round(avg(fpsArr) * 100) / 100,
    minFps: fpsArr.length ? Math.min(...fpsArr) : 0,
    maxFps: fpsArr.length ? Math.max(...fpsArr) : 0,
    avgEmuSpeedPct: Math.round(avg(samples.map(s => s.emuSpeedPct)) * 10) / 10,
    p95MsPerFrame: Math.round(p95(msArr) * 100) / 100,
    threadsOk: samples.length ? !!samples[samples.length - 1].threadsOk : false,
    cores: samples.length ? (samples[samples.length - 1].cores || 0) : 0,
    jitCompileMs: samples.length ? (samples[samples.length - 1].jitCompileMs || 0) : 0,
    jitBlocks: samples.length ? (samples[samples.length - 1].jitBlocks || 0) : 0,
    blockDispatches: samples.length ? (samples[samples.length - 1].blockDispatches || 0) : 0,
    chainMapEntries: samples.length ? (samples[samples.length - 1].chainMapEntries || 0) : 0,
    chainTableMismatches: samples.length ? (samples[samples.length - 1].chainTableMismatches) : -1,
    execMismatches: samples.length ? (samples[samples.length - 1].execMismatches) : -1,
    // JIT-04 code-space baseline: today ~1 wasm module per MIPS block. Batching must cut
    // modulesCreated >=10x (blocksPerModule >= 10) with cube golden intact.
    modulesCreated: samples.length ? (samples[samples.length - 1].modulesCreated || 0) : 0,
    instancesCreated: samples.length ? (samples[samples.length - 1].instancesCreated || 0) : 0,
    moduleBytes: samples.length ? (samples[samples.length - 1].moduleBytes || 0) : 0,
    blocksPerModule: samples.length ? (samples[samples.length - 1].blocksPerModule || 0) : 0,
    modulesLive: samples.length ? (samples[samples.length - 1].modulesLive || 0) : 0,
    modulesReleased: samples.length ? (samples[samples.length - 1].modulesReleased || 0) : 0,
    batchesEmitted: samples.length ? (samples[samples.length - 1].batchesEmitted || 0) : 0,
    batchedBlocks: samples.length ? (samples[samples.length - 1].batchedBlocks || 0) : 0,
    batchSkipped: samples.length ? (samples[samples.length - 1].batchSkipped || 0) : 0,
    blocksPerLiveModule: samples.length ? (samples[samples.length - 1].blocksPerLiveModule || 0) : 0,
    batchBadIndices: samples.length ? (samples[samples.length - 1].batchBadIndices || 0) : 0,
    firstBatchIndex: samples.length ? (samples[samples.length - 1].firstBatchIndex || 0) : 0,
    stateHash: samples.length ? (samples[samples.length - 1].stateHash || 0) : 0,
    stateHashAtN: samples.length ? (samples[samples.length - 1].stateHashAtN || 0) : 0,
    totalFrames: samples.length ? (samples[samples.length - 1].totalFrames || 0) : 0,
    stateHashes: samples.map(s => s.stateHash),
    dispatchesPerSec: (samples.length > 1 && samples[samples.length-1].blockDispatches && samples[0].blockDispatches)
      ? Math.round((samples[samples.length-1].blockDispatches - samples[0].blockDispatches) / (samples.length - 1)) : 0,
    frameHash: stableHash,
    baselineFrameHash: baselineHash,
    simdHashMatchesBaseline: (baselineHash != null && stableHash === baselineHash),
    fixtureBytes: booted.size,
    frameHashes: hashes,
    samples,
    upstream: fs.existsSync(path.join(__dirname, '../../UPSTREAM.lock'))
      ? fs.readFileSync(path.join(__dirname, '../../UPSTREAM.lock'), 'utf8').trim() : null,
    generatedAt: new Date().toISOString(),
  };

  const suffix = BATCH_MODE === 0 ? '' : `-mode${BATCH_MODE}`;
  fs.writeFileSync(path.join(outDir, `${FIXTURE}${suffix}.json`), JSON.stringify(result, null, 2));
  // Seed the immutable baseline ONLY if it doesn't exist yet (never overwrite).
  if (FIXTURE === 'cube' && !fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, JSON.stringify(result, null, 2));
  }

  console.log(`[bench] ${FIXTURE} avgFps=${result.avgFps} emu=${result.avgEmuSpeedPct}% p95ms=${result.p95MsPerFrame} threadsOk=${result.threadsOk} cores=${result.cores} jitMs=${result.jitCompileMs} jitBlocks=${result.jitBlocks} dispatch/s=${result.dispatchesPerSec} chainMap=${result.chainMapEntries} tblMismatch=${result.chainTableMismatches} execMismatch=${result.execMismatches} stateHash=${result.stateHash} stateHashAtN=${result.stateHashAtN} hashMatchesBaseline=${result.simdHashMatchesBaseline}`);
  // JIT-04 baseline (Sprint 2 checkpoint): how many wasm modules does one fixture create?
  console.log(`[jit-04] ${FIXTURE} modulesCreated=${result.modulesCreated} instancesCreated=${result.instancesCreated} moduleBytes=${result.moduleBytes} jitBlocks=${result.jitBlocks} blocksPerModule=${result.blocksPerModule}`);
  // THE number: code-space is paid for LIVE modules. Batching must push blocksPerLiveModule >> 1.
  console.log(`[jit-04] ${FIXTURE} badIndices=${result.batchBadIndices} firstBatchIndex=${result.firstBatchIndex} <-- 0 = addFunction never landed`);
  console.log(`[jit-04] ${FIXTURE} modulesLive=${result.modulesLive} released=${result.modulesReleased} batches=${result.batchesEmitted} batchedBlocks=${result.batchedBlocks} skipped=${result.batchSkipped} blocksPerLiveModule=${result.blocksPerLiveModule}`);
  // Batching gate: with 32-block batches the live-module count must collapse. Non-fatal if the
  // fixture is too small to fill a batch, but cube/vu1 produce ~1000 blocks so it must trigger.
  if (BATCH_MODE === 2 && result.jitBlocks > 200) {
    expect(result.batchesEmitted, 'batcher must emit batch modules').toBeGreaterThan(0);
    expect(result.blocksPerLiveModule, 'blocks per LIVE module (code-space win)').toBeGreaterThan(5);
  }
  // F3 correctness gate: cube's EE-state hash at a fixed frame is DETERMINISTIC and must not
  // change under dispatch-only JIT changes (chaining). vu1 is NOT gated on state (async VU1 =>
  // nondeterministic); vu1 is the speedup fixture (fps). See docs/BENCH-F3.md.
  // Gate hygiene: an emulator that DIED (0 fps, 0 frames, hash 0) must fail differently from one
  // whose hash DRIFTED. Previously a dead emulator reported stateHashAtN=0 alongside
  // hashMatchesBaseline=true, which is actively misleading.
  expect(result.avgFps, 'EMULATOR IS DEAD (0 fps) — not a hash drift, it stopped executing').toBeGreaterThan(0);
  expect(result.totalFrames, 'EMULATOR IS DEAD (rendered no frames)').toBeGreaterThan(0);
  expect(result.stateHashAtN, 'EMULATOR NEVER REACHED THE ANCHOR FRAME (hash still 0)').not.toBe(0);

  expect(result.chainTableMismatches, 'flat linear-memory chain table must match the reference map (0 mismatches)').toBe(0);
  expect(result.execMismatches, 'per-executor map insert/lookup must be self-consistent (0 mismatches)').toBe(0);

  if (FIXTURE === 'cube') {
    const gp = path.join(outDir, 'cube-golden.json');
    if (fs.existsSync(gp)) {
      const golden = JSON.parse(fs.readFileSync(gp, 'utf8')).stateHashAtN;
      console.log(`[gate] cube stateHashAtN=${result.stateHashAtN} golden=${golden}`);
      expect(result.stateHashAtN, 'cube EE-state hash must match golden (JIT correctness gate)').toBe(golden);
    }
  }

  expect(result.threadsOk, 'crossOriginIsolated + SharedArrayBuffer (threads) available').toBe(true);
  expect(result.avgFps, 'emulator produced frames').toBeGreaterThan(0);
});
