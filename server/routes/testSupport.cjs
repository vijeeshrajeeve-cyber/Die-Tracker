'use strict';
// Helpers for route tests. Not named *.test.cjs, so the runner never runs it
// on its own.
const Module = require('node:module');

// Stand in for db.cjs, so a route module can be required without creating a
// pg pool and nothing in the test can reach a real database. Call it before
// requiring the route module.
function installFakeDb(query) {
  const dbPath = require.resolve('../db.cjs');
  const fake = new Module(dbPath);
  fake.filename = dbPath;
  fake.loaded = true;
  fake.exports = { pool: { query, connect: async () => ({ query, release() {} }) } };
  require.cache[dbPath] = fake;
}

// Serve an express app on a free local port.
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

// POST when there is a body, GET otherwise, unless a method is given; always
// parses the JSON answer.
async function request(base, path, { token, body, method } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

module.exports = { installFakeDb, listen, request };
