// PS2WEB(F5 W1): persistent game library on OPFS (/games/). "Import once, play forever".
// Uses FileSystemWritable for import (main thread). Sync-access-handle read path (IO-02) is F5 W2.
async function gamesDir(): Promise<any> {
  const root = await (navigator as any).storage.getDirectory();
  return root.getDirectoryHandle('games', { create: true });
}

export interface DiskEntry { name: string; size: number; }

export const DiskStore = {
  async save(name: string, bytes: Uint8Array) {
    const dir = await gamesDir();
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
    return { name, size: bytes.length };
  },
  async list(): Promise<string[]> {
    const dir = await gamesDir();
    const names: string[] = [];
    for await (const [n, h] of (dir as any).entries()) { if (h.kind === 'file') names.push(n); }
    return names.sort();
  },
  // Sprint 1: list with sizes so the library UI can show them without loading bytes.
  async listDetailed(): Promise<DiskEntry[]> {
    const dir = await gamesDir();
    const out: DiskEntry[] = [];
    for await (const [n, h] of (dir as any).entries()) {
      if (h.kind !== 'file') continue;
      try { const f = await h.getFile(); out.push({ name: n, size: f.size }); }
      catch { out.push({ name: n, size: 0 }); }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
  async load(name: string): Promise<Uint8Array> {
    const dir = await gamesDir();
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return new Uint8Array(await f.arrayBuffer());
  },
  // Return the raw File handle (backed by disk) so disc images can be sliced lazily
  // instead of loaded fully into memory. Streaming read (IO-02) is F5 W2.
  async loadFile(name: string): Promise<File> {
    const dir = await gamesDir();
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  },
  async remove(name: string) {
    const dir = await gamesDir();
    await dir.removeEntry(name);
  },
};

// Boot a game already persisted in OPFS. Picks the ELF vs disc-image path by extension,
// mirroring upstream Actions.ts::bootFile but sourced from OPFS instead of a file input.
export async function bootFromOpfs(playModule: any, name: string): Promise<DiskEntry> {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.elf') {
    const bytes = await DiskStore.load(name);
    const s = playModule.FS.open(name, 'w+');
    playModule.FS.write(s, bytes, 0, bytes.length, 0);
    playModule.FS.close(s);
    playModule.bootElf(name);
    return { name, size: bytes.length };
  }
  // Disc image (ISO/CSO/CHD/ISZ/BIN): hand the File to the disc device (lazy slicing).
  const file = await DiskStore.loadFile(name);
  playModule.discImageDevice.setFile(file);
  playModule.bootDiscImage(name);
  return { name, size: file.size };
}

// Stream a File into OPFS in bounded chunks. A PS2 DVD can be ~4.7 GB; loading it into a
// single ArrayBuffer (a) blows up memory and (b) hits the hard limit
// "FileSystemWritableFileStream.write can't take an ArrayBuffer(View) larger than 2 GB".
// Writing File.slice() Blobs is lazy (disk-backed) and each write stays well under 2 GB.
const IMPORT_CHUNK = 64 * 1024 * 1024; // 64 MB per write
export async function saveFile(
  file: File,
  onProgress?: (written: number, total: number) => void,
): Promise<DiskEntry> {
  const dir = await gamesDir();
  const fh = await dir.getFileHandle(file.name, { create: true });
  const w = await fh.createWritable();
  try {
    let off = 0;
    while (off < file.size) {
      const end = Math.min(off + IMPORT_CHUNK, file.size);
      await w.write(file.slice(off, end)); // Blob slice: bounded, no full-file buffer
      off = end;
      if (onProgress) onProgress(off, file.size);
    }
    await w.close(); // size 0 falls through here, creating an empty file
  } catch (e) {
    try { await (w as any).abort(); } catch { /* ignore */ }
    throw e;
  }
  return { name: file.name, size: file.size };
}

// Import a File from the picker: persist to OPFS first (so it survives reload), then
// return the entry. Booting is a separate explicit action from the library.
export async function importFile(
  file: File,
  onProgress?: (written: number, total: number) => void,
): Promise<DiskEntry> {
  return saveFile(file, onProgress);
}
