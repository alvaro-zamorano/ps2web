#pragma once
#include "Types.h"
#include <vector>
#include <cstring>
namespace Framework {
class CStream {
public:
  std::vector<uint8> buf;
  void Write8(uint8 v){ buf.push_back(v); }
  void Write32(uint32 v){ for(int i=0;i<4;i++) buf.push_back((v>>(8*i))&0xFF); } // little-endian
  void Write(const void* p, size_t n){ const uint8* b=(const uint8*)p; buf.insert(buf.end(), b, b+n); }
};
}
