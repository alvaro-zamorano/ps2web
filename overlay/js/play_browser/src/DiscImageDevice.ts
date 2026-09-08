// PS2WEB(15): disc image device with an off-main-thread read path.
//
// Upstream: every CDVD sector read from the EE pthread did MAIN_THREAD_EM_ASM (a synchronous
// proxy to the main thread) to start file.slice().arrayBuffer(), then POLLED the main thread with
// more proxied calls + usleep(100) until the promise resolved. Each read = several main-thread
// round trips + a promise hop through a main thread busy with React/metrics -> milliseconds per
// 2 KB sector. That is the "EE idle" ceiling measured in docs/QA-PLAN.md §2.2.
//
// Now: a dedicated IO worker holds the File and a FileReaderSync. The EE thread writes a request
// into a small control block inside wasm memory (shared), Atomics.notify's the worker, the worker
// reads the slice synchronously straight into wasm memory and notifies back. Main is never
// involved; latency is one worker hop. The C++ side (Js_DiscImageDeviceStream.cpp, patch 15)
// adds a read-ahead cache on top so most sector reads never leave wasm at all.
//
// Control block layout (Int32, 8 words = 32 bytes):
//   [0] state: 0 idle, 1 request, 2 done
//   [1] offset lo   [2] offset hi   [3] size   [4] dst ptr   [5] result (bytes read, <0 error)
//   [6] file size lo [7] file size hi
// (static block in wasm, address from getDiscCtrlPtr(); wasmMemory exported by apply_f2_flags.sh)
// The legacy read()/isDone()/getFileSize() API is kept as the fallback (getCtrlPtr() == 0).

const IO_WORKER_SRC = `
let file = null, memory = null, ctrlPtr = 0, ctrl = null;
const reader = new FileReaderSync();
function view() {
  if (!ctrl || ctrl.buffer !== memory.buffer) ctrl = new Int32Array(memory.buffer, ctrlPtr, 8);
  return ctrl;
}
self.onmessage = (e) => {
  const d = e.data;
  file = d.file; memory = d.memory; ctrlPtr = d.ctrlPtr;
  // Do NOT touch ctrl[0] here: the EE may already have posted a request. Sizes were written
  // by the main thread before the worker was created.
  self.postMessage('ready');
  loop();
};
function loop() {
  for (;;) {
    let c = view();
    let s = Atomics.load(c, 0);
    while (s !== 1) { Atomics.wait(c, 0, s); c = view(); s = Atomics.load(c, 0); }
    const lo = Atomics.load(c, 1) >>> 0, hi = Atomics.load(c, 2) >>> 0;
    const size = Atomics.load(c, 3) >>> 0, dst = Atomics.load(c, 4) >>> 0;
    const pos = lo + hi * 4294967296;
    let n = 0;
    try {
      const buf = reader.readAsArrayBuffer(file.slice(pos, pos + size));
      n = buf.byteLength;
      new Uint8Array(memory.buffer, dst, n).set(new Uint8Array(buf));
    } catch (err) { n = -1; }
    c = view();
    Atomics.store(c, 5, n);
    Atomics.store(c, 0, 2);
    Atomics.notify(c, 0);
  }
}
`;

export default class DiscDevice {
    module: any;
    doneFlag: Boolean;
    file: File | null;
    worker: Worker | null = null;
    ctrlPtr: number = 0;

    constructor(module: any) {
        this.module = module;
        this.doneFlag = false;
        this.file = null;
    }

    // Legacy path (main thread, polled from the EE). Kept as fallback.
    read(dstPtr: number, offset: number, size: number) {
        if(!this.file) {
            throw new Error("No file set.");
        }
        this.doneFlag = false;
        let subsection = this.file.slice(offset, offset + size);
        subsection.arrayBuffer().then((value: ArrayBuffer) => {
            this.module.HEAPU8.set(new Uint8Array(value), dstPtr);
            this.doneFlag = true;
        });
    }

    getFileSize() {
        if(!this.file) {
            throw new Error("No file set.");
        }
        return this.file.size;
    }

    isDone() {
        return this.doneFlag;
    }

    // PS2WEB(15): 0 = use the legacy path.
    getCtrlPtr() {
        return this.ctrlPtr;
    }

    setFile(file : File) {
        this.file = file;
        this.stopWorker();
        try {
            const mem = this.module.wasmMemory;
            const disabled = /[?&]discproxy=1/.test(window.location.search); // A/B escape hatch
            if (!disabled && mem && typeof SharedArrayBuffer !== 'undefined' && mem.buffer instanceof SharedArrayBuffer) {
                const ptr = this.module.getDiscCtrlPtr();
                const c = new Int32Array(mem.buffer, ptr, 8);
                c.fill(0);
                c[6] = file.size % 4294967296;
                c[7] = Math.floor(file.size / 4294967296);
                const url = URL.createObjectURL(new Blob([IO_WORKER_SRC], { type: 'text/javascript' }));
                const w = new Worker(url);
                w.onerror = (e) => { console.error('PS2WEB(15): IO worker error', e); };
                w.postMessage({ file, memory: mem, ctrlPtr: ptr });
                this.worker = w;
                this.ctrlPtr = ptr;
                console.log('PS2WEB(15): disc IO worker armed (ctrl=' + ptr + ', size=' + file.size + ')');
            } else {
                console.log('PS2WEB(15): disc IO worker unavailable, legacy main-thread reads');
            }
        } catch (e) {
            console.error('PS2WEB(15): IO worker setup failed, legacy reads', e);
            this.ctrlPtr = 0;
        }
    }

    stopWorker() {
        if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } }
        this.worker = null;
        this.ctrlPtr = 0; // the control block is intentionally leaked (a few bytes per boot)
    }
};
