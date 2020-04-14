import Server from '../src/server';
import { ReconnectingClient } from '../src/client';

let server!: Server;

beforeAll(() => {
  server = new Server({
    port: 3666,
    handshake: (token) => {
      return !token.startsWith('bad');
    },
  });
});

afterAll(() => {
  server.close();
});

test('First connection emits `connect` event', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:3666',
    token: 'good-client-1',
  });

  await new Promise((resolve, reject) => {
    client.addEventListener('connect', resolve);
    client.addEventListener('connectError', reject);
    client.init();
  });
});

test('First connection emits `connectError` event', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:3666',
    token: 'bad-client-1',
  });

  await new Promise((resolve, reject) => {
    client.addEventListener('connectError', resolve);
    client.addEventListener('connect', reject);
    client.init().catch(() => {}); // It must throws
  });
});

test('First connection with promise resolves', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:3666',
    token: 'good-client-2',
  });
  await client.init();
});

test('First connection with promise rejects', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:3666',
    token: 'bad-client-2',
  });
  await expect(client.init()).rejects;
});
