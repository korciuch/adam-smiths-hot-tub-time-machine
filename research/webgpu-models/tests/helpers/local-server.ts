import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * navigator.gpu only exists in secure contexts. about:blank and data: URLs
 * do NOT count as secure contexts, so tests must be served from
 * http://127.0.0.1 (which Chrome treats as secure) rather than navigating
 * to about:blank. See ../FINDINGS.md.
 */
export async function startLocalServer(html: string) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => server.close(),
  };
}
