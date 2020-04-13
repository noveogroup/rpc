import Server from '../src/server';
import { ReconnectingClient } from '../src/client';

let server!: Server;

beforeAll(() => {
  server = new Server({
    port: 3666,
  });
});

afterAll(() => {
  return server.close();
});

test('First connection emits events', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:3666',
    token: 'test-client',
  });

  return new Promise((resolve, reject) => {
    client.addEventListener('connect', resolve);
    client.addEventListener('connectError', reject);
    client.init();
  });
});
