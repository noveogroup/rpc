import Server from '../src/server';
import { ReconnectingClient } from '../src/client';

const port = 3669;
const serverParams = () => ({
  address: `ws://localhost:${port}`,
  token: `good-client-${Math.random()}`,
});

interface ServerSingleton {
  instance?: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const server: ServerSingleton = {
  instance: undefined,
  start: async function() {
    if (this.instance) {
      await this.stop();
    }
    this.instance = new Server({ port });
    this.instance.register('ping', () => ({ server: 'pong' }));
  },
  stop: function() {
    return new Promise((resolve, reject) => {
      if (this.instance) {
        this.instance.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.instance = undefined;
            resolve();
          }
        });
      }
    });
  },
};

afterAll(() => server.stop());

test('simple reconnection', async () => {
  await server.start();
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await server.stop();
  return new Promise(async (resolve) => {
    client.addEventListener('connect', async () => {
      await expect(client.call('ping')).resolves.toEqual({ server: 'pong' });
      resolve();
    });
    await server.start();
  });
});

test('connect when the server does not yet started', async () => {
  jest.setTimeout(15000);
  await server.stop();
  const client = new ReconnectingClient(serverParams());
  await Promise.all([
    new Promise(async (resolve) => {
      client.addEventListener('connect', async () => {
        await expect(client.call('ping')).resolves.toEqual({ server: 'pong' });
        jest.setTimeout(5000);
        resolve();
      });
      await server.start();
    }),
    (async () => {
      await expect(client.init()).resolves;
    })(),
  ]);
});

test('disconnect the client correctly', () => {});
