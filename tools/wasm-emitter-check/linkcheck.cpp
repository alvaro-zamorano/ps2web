// Gate de LINKADO: fuerza exactamente los usos que rompieron el CI (move-construcción de
// CMemoryFunction, que upstream declara pero no define). Si falta el símbolo, esto no linka.
#include "MemoryFunction.h"
#include <vector>
#include <utility>
int main(){
  CMemoryFunction a;                       // default ctor
  CMemoryFunction b(std::move(a));         // MOVE CTOR  <-- el símbolo que faltaba
  std::vector<CMemoryFunction> v;
  v.push_back(std::move(b));               // move-construcción dentro de vector (CreateBatch)
  CMemoryFunction c;
  c = std::move(v[0]);                     // move assignment (Ps2webRepoint)
  return c.IsEmpty() ? 0 : 0;
}
