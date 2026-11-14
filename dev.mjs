// Penyaji berkas statis untuk web/ (hanya localhost).
import { join, normalize } from 'node:path';
const root = join(import.meta.dir, 'web');
const server = Bun.serve({
  hostname: '127.0.0.1', port: 4777,
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname));   // normalize membuang ".." sehingga tidak keluar dari web/
    const file = Bun.file(join(root, path.endsWith('/') ? path + 'index.html' : path));
    return (await file.exists()) ? new Response(file) : new Response('Tidak ditemukan', { status: 404 });
  },
});
console.log(`http://${server.hostname}:${server.port}`);
