// PS2WEB diagnostic: WebGL2 probe for the GS renderer (paste into the DevTools console of the
// live site loaded with ?gsproxy=1, so the GL context lives on the main thread, BEFORE booting).
// - Tracks textures (size/format, render-target or uploaded), FBOs, programs, blend and colour masks.
// - __gl.start(n) records the next n draws; __gl.skip = (d) => bool skips matching draws (bisect).
// - Shader hot-fix used to validate patch 17: indexed reads take alpha when the bound texture is a
//   render target (__gl.alphaFix = true/false toggles it live for A/B on the same frame).
// - __seq(['Enter','KeyZ',...], gapMs) drives the pad from the keyboard mapping.
// See docs/GS-ALPHA-AS-INDEX.md for how it was used.
(() => {
  if (window.__gl) return 'already installed';
  const P = WebGL2RenderingContext.prototype;
  const O = {};
  const S = window.__gl = { meta: new WeakMap(), byId: new Map(), pid: new WeakMap(), fboColor: new WeakMap(), loc: new WeakMap(),
    nT: 1, nP: 1, unit: 0, bound: [], prog: null, fbo: null, blend: false, bf: '', be: '', cm: '',
    rec: null, recN: 0, skip: null, skipped: 0, draws: 0, alphaFix: true, fixHits: 0, patched: 0, O };
  const tm = (t) => { if (!t) return null; let m = S.meta.get(t); if (!m) { m = { id: S.nT++, w: 0, h: 0, fmt: 0, up: 0, sub: 0, rt: false }; S.meta.set(t, m); S.byId.set(m.id, t); } return m; };
  const tid = (t) => { const m = tm(t); return m ? m.id : 0; };
  const W = (name, fn) => { const o = P[name]; O[name] = o; P[name] = function (...a) { return fn.call(this, o, a); }; };
  W('shaderSource', function (o, a) {
    let src = a[1];
    if (src.includes('uniform sampler2D g_palette;') && /\)\.r \* 255\.0/.test(src)) {
      src = src.replace('uniform sampler2D g_palette;', 'uniform sampler2D g_palette;\nuniform float ps2webAlphaIdx;\nfloat ps2webIdx(vec4 s) { return (ps2webAlphaIdx > 0.5) ? s.a : s.r; }');
      src = src.replace(/texture\(g_texture, ([^;]*?)\)\.r \* 255\.0/g, 'ps2webIdx(texture(g_texture, $1)) * 255.0');
      S.patched++;
    }
    return o.call(this, a[0], src);
  });
  W('activeTexture', function (o, a) { S.unit = a[0] - this.TEXTURE0; return o.apply(this, a); });
  W('bindTexture', function (o, a) { if (a[0] === this.TEXTURE_2D) S.bound[S.unit] = a[1]; return o.apply(this, a); });
  W('texImage2D', function (o, a) { const m = tm(S.bound[S.unit]); if (m && a.length >= 8) { m.w = a[3]; m.h = a[4]; m.fmt = a[2]; m.up++; } return o.apply(this, a); });
  W('texStorage2D', function (o, a) { const m = tm(S.bound[S.unit]); if (m) { m.w = a[3]; m.h = a[4]; m.fmt = a[2]; } return o.apply(this, a); });
  W('framebufferTexture2D', function (o, a) { const m = tm(a[3]); if (m && a[1] === this.COLOR_ATTACHMENT0) { m.rt = true; if (S.fbo) S.fboColor.set(S.fbo, a[3]); } return o.apply(this, a); });
  W('bindFramebuffer', function (o, a) { if (a[0] === this.FRAMEBUFFER || a[0] === this.DRAW_FRAMEBUFFER) S.fbo = a[1]; return o.apply(this, a); });
  W('useProgram', function (o, a) { S.prog = a[0]; if (a[0] && !S.pid.get(a[0])) S.pid.set(a[0], S.nP++); return o.apply(this, a); });
  W('enable', function (o, a) { if (a[0] === this.BLEND) S.blend = true; return o.apply(this, a); });
  W('disable', function (o, a) { if (a[0] === this.BLEND) S.blend = false; return o.apply(this, a); });
  W('blendFuncSeparate', function (o, a) { S.bf = a.map(x => x.toString(16)).join(','); return o.apply(this, a); });
  W('colorMask', function (o, a) { S.cm = a.map(x => x ? 1 : 0).join(''); return o.apply(this, a); });
  const draw = function (o, a, k) {
    S.draws++;
    const p = S.prog;
    if (p) {
      let loc = S.loc.get(p);
      if (loc === undefined) { loc = this.getUniformLocation(p, 'ps2webAlphaIdx'); S.loc.set(p, loc); }
      if (loc) {
        const m0 = S.bound[0] && S.meta.get(S.bound[0]);
        const v = (S.alphaFix && m0 && m0.rt && S.bound[1]) ? 1 : 0;
        if (v) S.fixHits++;
        this.uniform1f(loc, v);
      }
    }
    if (S.rec || S.skip) {
      const fc = S.fbo ? S.fboColor.get(S.fbo) : null;
      const d = { i: S.draws, n: k === 'a' ? a[2] : a[1], p: S.pid.get(p) || 0, fb: S.fbo ? (fc ? tid(fc) : -1) : 0,
        t0: tid(S.bound[0]), t1: tid(S.bound[1]), bl: S.blend ? S.bf : '-', cm: S.cm };
      if (S.rec && S.rec.length < S.recN) S.rec.push(d);
      if (S.skip && S.skip(d)) { S.skipped++; return; }
    }
    return o.apply(this, a);
  };
  W('drawArrays', function (o, a) { return draw.call(this, o, a, 'a'); });
  W('drawElements', function (o, a) { return draw.call(this, o, a, 'e'); });
  S.start = (n) => { S.rec = []; S.recN = n; return 'recording ' + n; };
  S.texInfo = (id) => { const t = S.byId.get(id); return t ? S.meta.get(t) : null; };
  window.__keys = ['Enter','KeyZ','KeyX','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  window.__release = () => { const c = document.getElementById('outputCanvas'); for (const k of window.__keys) c.dispatchEvent(new KeyboardEvent('keyup', { code: k, key: k, bubbles: true })); };
  window.__press = async (code, ms = 400) => { window.__release(); const c = document.getElementById('outputCanvas'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); await new Promise(r => setTimeout(r, ms)); c.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true })); await new Promise(r => setTimeout(r, 250)); };
  window.__seq = async (codes, gap = 400) => { window.__seqDone = false; for (const c of codes) { await window.__press(c); await new Promise(r => setTimeout(r, gap)); } window.__seqDone = true; return 'ok'; };
  return 'hooks2 installed';
})();
