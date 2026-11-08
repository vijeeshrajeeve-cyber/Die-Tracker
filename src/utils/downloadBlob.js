// Save a Blob through a temporary <a download>. The object URL is revoked a moment
// later, not right after click(): Firefox and Safari start the download after the
// click returns, and a URL revoked synchronously can abort it.
// `env` is for tests only (no DOM under node:test).

export const REVOKE_DELAY_MS = 1000;

export function downloadBlob(blob, name, env = {}) {
  const doc = env.document || globalThis.document;
  const urls = env.URL || globalThis.URL;
  const schedule = env.setTimeout || globalThis.setTimeout;
  const url = urls.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  schedule(() => urls.revokeObjectURL(url), REVOKE_DELAY_MS);
}
