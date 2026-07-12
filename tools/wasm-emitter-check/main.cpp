#include "WasmModuleBuilder.h"
#include "WasmDefs.h"
#include <cstdio>
#include <string>
// cuerpo mínimo válido de un "bloque": (func (param i32)) que hace nop y termina.
static CWasmModuleBuilder::FUNCTION MakeBody(int seed){
  CWasmModuleBuilder::FUNCTION f;
  // i32.const seed ; drop ; end     -> cuerpo válido para signature "vi" (void(i32))
  f.code = { 0x41, (uint8)(seed & 0x3F), 0x1a, 0x0b };
  f.localI32Count = 2;
  return f;
}
int main(int argc, char** argv){
  int N = (argc>1)? atoi(argv[1]) : 1;
  CWasmModuleBuilder b;
  // tabla de tipos CANÓNICA (las 7 firmas reales de Ps2VmJs.cpp), "vi" en índice 0
  auto addType=[&](std::vector<uint32> params, std::vector<uint32> results){
    CWasmModuleBuilder::FUNCTION_TYPE t; t.params=params; t.results=results; b.AddFunctionType(t);
  };
  const uint32 I=Wasm::TYPE_I32, J=Wasm::TYPE_I64;
  addType({I},{});            // 0: vi   <-- firma del bloque, DEBE ser 0
  addType({I,I},{I});         // 1: iii
  addType({I,I},{J});         // 2: jii
  addType({I,I,I},{});        // 3: viii
  addType({I,J,I},{});        // 4: viji
  addType({I,I,I},{I});       // 5: iiii
  addType({I,J,I},{J});       // 6: jiji
  for(int i=0;i<N;i++) b.AddFunction(MakeBody(i));
  Framework::CStream s;
  b.WriteModule(s);
  char path[64]; snprintf(path,64,"mod_%d.wasm",N);
  FILE* fp=fopen(path,"wb"); fwrite(s.buf.data(),1,s.buf.size(),fp); fclose(fp);
  printf("N=%-3d -> %s (%zu bytes)\n", N, path, s.buf.size());
  return 0;
}
