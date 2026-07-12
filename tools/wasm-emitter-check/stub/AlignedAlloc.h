#pragma once
#include <cstdlib>
inline void* framework_aligned_alloc(size_t s, size_t a){ void* p=nullptr; if(posix_memalign(&p,a,s)) return nullptr; return p; }
inline void framework_aligned_free(void* p){ free(p); }
