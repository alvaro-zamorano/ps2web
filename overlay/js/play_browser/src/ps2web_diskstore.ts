// PS2WEB(F5 W1): persistent game library on OPFS (/games/). "Import once, play forever".
// Uses FileSystemWritable for import (main thread). Sync-access-handle read path (IO-02) is F5 W2.
async function gamesDir(): Promise<any> {
  const root = await (navigator as any).storage.getDirectory();
  return root.getDirectoryHandle('games', { create: true });
}
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
  async load(name: string): Promise<Uint8Array> {
    const dir = await gamesDir();
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return new Uint8Array(await f.arrayBuffer());
  },
  async remove(name: string) {
    const dir = await gamesDir();
    await dir.removeEntry(name);
  },
};
