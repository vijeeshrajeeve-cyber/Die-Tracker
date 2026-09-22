import test from 'node:test';
import assert from 'node:assert/strict';

// api.js reads the token out of localStorage on every request, so it needs a
// stub before the module is imported.
globalThis.localStorage = { getItem: () => 'test-token', setItem: () => {}, removeItem: () => {} };

const { workQueueAPI } = await import('./workQueueAPI.js');

const respondWith = (body, status = 200, contentType = 'application/json') => {
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url, options });
    return new Response(body, { status, headers: { 'Content-Type': contentType } });
  };
  return seen;
};

test('a queue request goes to /api/work-queue with the bearer token', async () => {
  const seen = respondWith(JSON.stringify({ items: [] }));
  assert.deepEqual(await workQueueAPI.list({ scope: 'mine', stage: '' }), { items: [] });
  assert.equal(seen[0].url, '/api/work-queue/items?scope=mine');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer test-token');
});

// WorkItemDetail and WorkQueueSettings reload on a 409 instead of showing a
// plain failure, so the status has to survive whichever wrapper sends the call.
test('a queue failure keeps its HTTP status', async () => {
  respondWith(JSON.stringify({ error: 'This item changed. Reload before saving.' }), 409);
  await assert.rejects(workQueueAPI.detail(12), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.message, 'This item changed. Reload before saving.');
    return true;
  });
});

// nginx answers 502 with its own HTML page when the backend is down. The queue
// should say the same plain thing every other page in the app says.
test('a proxy 502 page gives the queue the app-wide message', async () => {
  respondWith('<html><body>502 Bad Gateway</body></html>', 502, 'text/html');
  await assert.rejects(workQueueAPI.list({}), {
    message: 'The server is not responding. Please try again in a moment.',
    status: 502,
  });
});
