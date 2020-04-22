import { Server } from '../src';
import { ReconnectingClient } from '../src/client';
import { Errors } from '../src/errors';
import NotConnectedError = Errors.NotConnectedError;

let server!: Server;

beforeAll(() => {
  server = new Server({
    port: 3666,
    handshake: (token) => {
      if (token === 'handshakeThrow') {
        throw new Error('throw in handshake');
      }
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
  client.addEventListener('message', (m) => {
    console.log(1, m);
  });
  await expect(client.init()).rejects.toThrow(
    new Errors.NotConnectedError('Server rejected the connection'),
  );
});

test('First connection with throwing a server exception', async () => {
  const client = new ReconnectingClient({
    address: 'ws://localhost:3666',
    token: 'handshakeThrow',
  });
  client.addEventListener('message', (m) => {
    console.log(2, m);
  });
  // try {
  //   await client.init();
  // } catch (e) {
  //   console.log(e);
  //   console.log(e.message);
  // }
  await expect(client.init()).rejects.toThrow(
    new Errors.NotConnectedError('throw in handshake'),
  );
});
