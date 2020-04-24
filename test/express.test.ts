import express from 'express';
import http from 'http';
import { Server } from '../src';
import { ReconnectingClient } from '../src/client';

let server!: http.Server;
let wsServer!: Server;
let app!: express.Express;

beforeAll(
  () =>
    new Promise((resolve) => {
      app = express();
      server = http.createServer(app);
      wsServer = new Server({
        server,
        handshake: (token) => {
          if (token === 'handshakeThrow') {
            throw new Error('throw in handshake');
          }
          return !token.startsWith('bad');
        },
      });
      server.listen(4011, resolve);
    }),
);

afterAll(
  () =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject() : resolve(err)));
    }),
);

test('First connection emits `connect` event', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:4011',
    token: 'good-client-1',
  });

  await new Promise((resolve, reject) => {
    client.addEventListener('connect', () => {
      client.disconnect();
      resolve();
    });
    client.addEventListener('connectError', reject);
    client.init();
  });
});
