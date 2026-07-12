// PS2WEB — OBS-01 metrics contract + headless boot hook for the harness.
// Frontend-only overlay over jpd002/Play- (no core/C++ changes).
// Exposes:
//   window.__ps2web_metrics = { fps, emuSpeedPct, msPerFrame, frameHash, ts }
//   window.PlayModule        (the emscripten module, for the harness)
//   window.__ps2web.bootElfFromUrl(url), window.__ps2web.ready
import { DiskStore } from "./ps2web_diskstore"; // PS2WEB(F5)
const TARGET_FPS = 59.94; // PS2 NTSC vsync (PAL=50). emuSpeedPct is vs NTSC; documented approx.

export function startMetrics(playModule: any) {
  (window as any).PlayModule = playModule;
  const threadsOk = (window.crossOriginIsolated === true) && (typeof SharedArrayBuffer !== 'undefined');
  const cores = (navigator as any).hardwareConcurrency || 0;
  // PS2WEB(Sprint 2 / JIT-04): modulesCreated/instancesCreated/moduleBytes = the code-space
  // baseline. Today ~1 wasm module per MIPS block; batching must cut modulesCreated >=10x.
  const metrics = { fps: 0, emuSpeedPct: 0, msPerFrame: 0, frameHash: null as number | null, threadsOk, cores, jitCompileMs: 0, jitBlocks: 0, blockDispatches: 0, chainMapEntries: 0, chainTableMismatches: -1, execMismatches: -1, modulesCreated: 0, instancesCreated: 0, moduleBytes: 0, blocksPerModule: 0, modulesLive: 0, modulesReleased: 0, batchesEmitted: 0, batchedBlocks: 0, batchSkipped: 0, blocksPerLiveModule: 0, batchBadIndices: 0, firstBatchIndex: 0, stateHash: 0, stateHashAtN: 0, totalFrames: 0, ts: Date.now() };
  (window as any).__ps2web_metrics = metrics;

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    let frames = 0;
    try { frames = playModule.getFrames(); playModule.clearStats(); } catch (e) {}
    try { metrics.jitCompileMs = Math.round(playModule.getJitMs() * 100) / 100; metrics.jitBlocks = playModule.getJitBlocks(); } catch (e) {}
    try { metrics.blockDispatches = playModule.getDispatches(); } catch (e) {}
    try { metrics.chainMapEntries = playModule.getChainMapEntries(); } catch (e) {}
    try { metrics.chainTableMismatches = playModule.getChainTableMismatches(); } catch (e) {}
    try { metrics.execMismatches = playModule.getExecMismatches(); } catch (e) {}
    try {
      metrics.modulesCreated = playModule.getModulesCreated();
      metrics.instancesCreated = playModule.getInstancesCreated();
      metrics.moduleBytes = playModule.getModuleBytes();
      metrics.blocksPerModule = metrics.modulesCreated > 0
        ? Math.round((metrics.jitBlocks / metrics.modulesCreated) * 100) / 100 : 0;
      // PS2WEB(JIT-04): with tiered re-batching the CUMULATIVE count rises (solo + batch module),
      // so the number that proves the win is blocksPerLiveModule — how much code each *live*
      // module carries. Code-space is paid for live modules, not cumulative ones.
      metrics.modulesLive = playModule.getModulesLive();
      metrics.modulesReleased = playModule.getModulesReleased();
      metrics.batchesEmitted = playModule.getBatchesEmitted();
      metrics.batchedBlocks = playModule.getBatchedBlocks();
      metrics.batchSkipped = playModule.getBatchSkipped();
      // THE smoking gun: an indirect-table index of 0 is never a valid block entry point.
      metrics.batchBadIndices = playModule.getBatchBadIndices();
      metrics.firstBatchIndex = playModule.getFirstBatchIndex();
      metrics.blocksPerLiveModule = metrics.modulesLive > 0
        ? Math.round((metrics.jitBlocks / metrics.modulesLive) * 100) / 100 : 0;
    } catch (e) {}
    try { metrics.stateHash = playModule.getStateHash(); } catch (e) {}
    try { metrics.stateHashAtN = playModule.getStateHashAtN(); metrics.totalFrames = playModule.getTotalFrames(); } catch (e) {}
    const fps = dt > 0 ? frames / dt : 0;
    metrics.fps = Math.round(fps * 100) / 100;
    metrics.emuSpeedPct = Math.round((fps / TARGET_FPS) * 1000) / 10;
    metrics.msPerFrame = fps > 0 ? Math.round((1000 / fps) * 100) / 100 : 0;
    metrics.frameHash = computeFrameHash();
    metrics.ts = Date.now();
  }, 1000);

  (window as any).__ps2web = {
    ready: true,
    diskStore: DiskStore,
    async importAndSave(url: string) { // fetch a served fixture and persist to OPFS
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const name = (url.split('/').pop() || 'game.elf');
      await DiskStore.save(name, bytes);
      return { name, size: bytes.length };
    },
    async bootElfFromOpfs(name: string) {
      const bytes = await DiskStore.load(name);
      const s = playModule.FS.open(name, 'w+');
      playModule.FS.write(s, bytes, 0, bytes.length, 0);
      playModule.FS.close(s);
      playModule.bootElf(name);
      return { name, size: bytes.length };
    },
    async bootElfFromUrl(url: string) {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const name = (url.split('/').pop() || 'fixture.elf');
      const s = playModule.FS.open(name, 'w+');
      playModule.FS.write(s, buf, 0, buf.length, 0);
      playModule.FS.close(s);
      playModule.bootElf(name);
      return { name, size: buf.length };
    },
  };
}

// Best-effort frame hash from the WebGL canvas. Robust/deterministic hashing is
// deferred to F3/F4 (we don't own the GS context yet); returns null if the
// drawing buffer isn't readable (GS context has no preserveDrawingBuffer).
function computeFrameHash(): number | null {
  try {
    const c = document.getElementById('outputCanvas') as HTMLCanvasElement | null;
    if (!c) return null;
    const data = c.toDataURL('image/png');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  } catch (e) { return null; }
}
