import fs from 'fs';
const memory = new WebAssembly.Memory({ initial: 1, maximum: 32768, shared: true });
const fctTable = new WebAssembly.Table({ initial: 1, element: 'anyfunc' });
for (const N of [1, 2, 32]) {
  const bytes = fs.readFileSync(`mod_${N}.wasm`);
  const valid = WebAssembly.validate(bytes);
  if (!valid) { console.error(`N=${N}: BINARIO INVALIDO`); process.exit(1); }
  const mod = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(mod, { env: { memory, fctTable } });
  const exps = Object.keys(inst.exports);
  // llamar a todas las funciones exportadas (firma vi: void(i32))
  let called = 0;
  for (const e of exps) { inst.exports[e](0); called++; }
  const expected = N === 1 ? ['codeGenFunc'] : Array.from({length:N},(_,i)=>`codeGenFunc${i}`);
  const namesOk = JSON.stringify(exps.sort()) === JSON.stringify(expected.sort());
  console.log(`N=${String(N).padEnd(2)} valid=✓ instancia=✓ exports=${exps.length} nombres=${namesOk?'✓':'✗ '+exps.slice(0,3)} llamadas_ok=${called}`);
}
// back-compat CRÍTICO: N=1 debe exportar EXACTAMENTE "codeGenFunc" (el glue actual lo busca así)
const m1 = new WebAssembly.Module(fs.readFileSync('mod_1.wasm'));
const i1 = new WebAssembly.Instance(m1, { env: { memory, fctTable } });
if (typeof i1.exports.codeGenFunc !== 'function') { console.error('BACK-COMPAT ROTO: N=1 debe exportar codeGenFunc (lo busca MemoryFunction.cpp)'); process.exit(1); }
console.log('BACK-COMPAT N=1: exports.codeGenFunc = function OK (glue de MemoryFunction.cpp intacto)');
