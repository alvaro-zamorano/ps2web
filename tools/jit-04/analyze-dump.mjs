// JIT-04: disassemble + diff the wasm the batcher actually emitted, against the solo module
// whose body it lifted. The batched body is supposed to be a byte-for-byte copy inside a module
// with an identical type/import section — if the emulator dies on it, the difference is here.
//
// Usage: node tools/jit-04/analyze-dump.mjs bench/results/wasm-dump-mode1.json
import fs from 'fs';

const SECTION = { 1: 'Type', 2: 'Import', 3: 'Function', 4: 'Table', 5: 'Memory', 6: 'Global', 7: 'Export', 8: 'Start', 9: 'Element', 10: 'Code', 11: 'Data' };

function readULeb(b, pos) {
  let result = 0, shift = 0, byte;
  do { byte = b[pos++]; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return [result >>> 0, pos];
}

function sections(bytes) {
  const out = [];
  let pos = 8; // magic + version
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size; [size, pos] = readULeb(bytes, pos);
    out.push({ id, name: SECTION[id] || `?${id}`, start: pos, size });
    pos += size;
  }
  return out;
}

// Pull every function body out of the Code section (locals decl + code, as stored).
function bodies(bytes) {
  const code = sections(bytes).find(s => s.id === 10);
  if (!code) return [];
  let pos = code.start;
  let count; [count, pos] = readULeb(bytes, pos);
  const out = [];
  for (let i = 0; i < count; i++) {
    let size; [size, pos] = readULeb(bytes, pos);
    out.push(bytes.slice(pos, pos + size));
    pos += size;
  }
  return out;
}

function typeSection(bytes) {
  const t = sections(bytes).find(s => s.id === 1);
  if (!t) return [];
  let pos = t.start;
  let count; [count, pos] = readULeb(bytes, pos);
  const out = [];
  for (let i = 0; i < count; i++) {
    pos++; // 0x60 func
    let np; [np, pos] = readULeb(bytes, pos);
    const params = [...bytes.slice(pos, pos + np)]; pos += np;
    let nr; [nr, pos] = readULeb(bytes, pos);
    const results = [...bytes.slice(pos, pos + nr)]; pos += nr;
    const T = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128' };
    out.push(`(${params.map(p => T[p] || p).join(',')})->(${results.map(r => T[r] || r).join(',')})`);
  }
  return out;
}

const file = process.argv[2];
if (!file) { console.error('usage: analyze-dump.mjs <wasm-dump-modeN.json>'); process.exit(1); }
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!dump.batch) { console.error('dump has no batch module'); process.exit(1); }

const solo = Uint8Array.from(dump.solo || []);
const batch = Uint8Array.from(dump.batch);
fs.writeFileSync('/tmp/solo.wasm', solo);
fs.writeFileSync('/tmp/batch.wasm', batch);

console.log(`solo:  ${solo.length} B  valid=${solo.length ? WebAssembly.validate(solo) : 'n/a'}`);
console.log(`batch: ${batch.length} B  valid=${WebAssembly.validate(batch)}`);

for (const [label, bytes] of [['SOLO', solo], ['BATCH', batch]]) {
  if (!bytes.length) continue;
  console.log(`\n=== ${label} sections ===`);
  for (const s of sections(bytes)) console.log(`  ${String(s.id).padStart(2)} ${s.name.padEnd(9)} size=${s.size}`);
  console.log(`  types: ${typeSection(bytes).join(' | ')}`);
}

const soloBodies = bodies(solo);
const batchBodies = bodies(batch);
console.log(`\n=== bodies: solo=${soloBodies.length} batch=${batchBodies.length} ===`);

// THE check: the solo module's single body must appear VERBATIM in the batch module.
if (soloBodies.length === 1) {
  const s = soloBodies[0];
  const idx = batchBodies.findIndex(b => b.length === s.length && b.every((v, i) => v === s[i]));
  if (idx >= 0) {
    console.log(`  ✅ solo body (${s.length} B) found VERBATIM in batch at index ${idx}`);
  } else {
    console.log(`  ❌ solo body NOT found verbatim in the batch — the lift/re-emit CORRUPTS it`);
    const b = batchBodies[0];
    console.log(`     solo[0..24]  = ${[...s.slice(0, 24)].map(x => x.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`     batch[0..24] = ${[...b.slice(0, 24)].map(x => x.toString(16).padStart(2, '0')).join(' ')}`);
    for (let i = 0; i < Math.min(s.length, b.length); i++) {
      if (s[i] !== b[i]) { console.log(`     first diff at byte ${i}: solo=0x${s[i].toString(16)} batch=0x${b[i].toString(16)}`); break; }
    }
  }
}

// Type tables must be IDENTICAL, or every call_indirect signature index in the lifted body
// silently points at the wrong type.
const ts = typeSection(solo).join('|'), tb = typeSection(batch).join('|');
console.log(`\n=== type table identical? ${ts === tb ? '✅ YES' : '❌ NO — call_indirect sig indices are invalid'} ===`);
if (ts !== tb) { console.log(`  solo:  ${ts}`); console.log(`  batch: ${tb}`); }

// Instantiate the batch for real and confirm every export is callable.
try {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 32768, shared: true });
  const fctTable = new WebAssembly.Table({ initial: 32, element: 'anyfunc' });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(batch), { env: { memory, fctTable } });
  console.log(`\n=== batch instantiates: ✅  exports=${Object.keys(inst.exports).length} ===`);
} catch (e) {
  console.log(`\n=== batch FAILS to instantiate: ${e.message} ===`);
}
