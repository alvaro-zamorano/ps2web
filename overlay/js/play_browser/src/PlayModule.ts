import Play from "./Play";
import DiscImageDevice from "./DiscImageDevice";
import { startMetrics } from "./ps2web_metrics"; // PS2WEB overlay

export let PlayModule : any = null;

let module_overrides = {
    locateFile: function(path : string) {
        const baseURL = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf( "/" ));
        return baseURL + '/' + path;
    },
    mainScriptUrlOrBlob: "",
};

export let initPlayModule = async function() {
    module_overrides.mainScriptUrlOrBlob = module_overrides.locateFile('Play.js');
    PlayModule = await Play(module_overrides);
    PlayModule.FS.mkdir("/work");
    PlayModule.discImageDevice = new DiscImageDevice(PlayModule);
    PlayModule.ccall("initVm", "", [], []);
    // PS2WEB(14): initVm is two-phase. Phase 1 spawns the EE thread (which owns the canvas and
    // hands it to the GS pthread) and returns immediately; when the GS is up the VM reports
    // state 1 and we run phase 2 (pad/sound/callbacks) from HERE — the JS event loop — because
    // phase 2 blocks on the EE mailbox and blocking inside a proxied task deadlocks the runtime.
    if (typeof PlayModule.getVmInitState === 'function') {
        const t0 = Date.now();
        for (;;) {
            const st = PlayModule.getVmInitState();
            if (st === 2) break;
            if (st === 1) { PlayModule.ccall("initVmPhase2", "", [], []); continue; }
            if (Date.now() - t0 > 60000) { console.error('PS2WEB(14): VM init timeout'); break; }
            await new Promise(r => setTimeout(r, 10));
        }
    }
    startMetrics(PlayModule); // PS2WEB: expose window.__ps2web_metrics + boot hook
};
