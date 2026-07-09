# Standalone build of the ps2sdk 'cube' sample against an installed $PS2SDK
# (ps2dev toolchain). Source (c) 2005 Naomi Peori, Academic Free License v2.0.
EE_BIN = cube.elf
EE_OBJS = cube.o
EE_LIBS = -ldraw -lgraph -lmath3d -lpacket -ldma

all: $(EE_BIN)
	$(EE_STRIP) --strip-all $(EE_BIN)

clean:
	rm -f $(EE_BIN) $(EE_OBJS)

include $(PS2SDK)/samples/Makefile.pref
include $(PS2SDK)/samples/Makefile.eeglobal
