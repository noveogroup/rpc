import kindOf from 'kind-of';
import Server from '../src/server';
import { ReconnectingClient } from '../src/client';
import { Errors } from '../src/errors';

const port = 3668;
const token = 'good-client';
let server!: Server;
let client!: ReconnectingClient;

beforeAll(async () => {
  server = new Server({ port, prepareContext: (id) => id });
  client = new ReconnectingClient({
    address: `ws://localhost:${port}`,
    token,
  });
  client.register('promise', () => Promise.resolve({ server: 'pong' }));
  client.register('simple', () => ({ client: 'pong' }));
  client.register('string', () => '42');
  client.register('number', () => 42);
  await client.init();
  client.register('boolean', () => true);
  client.register('array', () => [1, 2, 3]);
  client.register('exception', async () => {
    throw new Error('client exception');
  });
  client.register('mirror', (_ctx, params) => params);
});

afterAll(() => {
  server.close();
});

test('simple call with promise object value', async () => {
  await expect(server.call(token, 'promise')).resolves.toMatchObject({
    server: 'pong',
  });
});

test('simple call with simple value', async () => {
  await expect(server.call(token, 'simple')).resolves.toMatchObject({
    client: 'pong',
  });
});

test('simple call with different return types', async () => {
  for (const type of ['string', 'number', 'boolean', 'array']) {
    await expect(server.call(token, type).then(kindOf)).resolves.toStrictEqual(
      type,
    );
  }
});

test('call with exception', async () => {
  await expect(server.call(token, 'exception')).rejects.toBeInstanceOf(
    Errors.RequestError,
  );
});

test('call nonexistent method', async () => {
  await expect(server.call(token, 'quasi method')).rejects.toBeInstanceOf(
    Errors.ProcedureNotFoundError,
  );
});
