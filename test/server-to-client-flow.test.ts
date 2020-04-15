import kindOf from 'kind-of';
import Server from '../src/server';
import { ReconnectingClient } from '../src/client';
import { Errors } from '../src/errors';

const timeOut = 10000;
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
  client.register('mirror', (params, _ctx) => params);
  client.register('wait', async () => {
    await new Promise((resolve) => setTimeout(resolve, timeOut));
    return 'time!';
  });
});

afterAll(() => server.close());

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

test('call with the wrong message', async () => {
  await new Promise((resolve) => {
    client.addEventListener('error', (e) => {
      expect(e.type).toBe('InvalidJSONRPCError');
      expect((e as CustomEvent).detail).toBe(
        'Malformed message: bad json-rpc message',
      );
      resolve();
    });
    // @ts-ignore
    server.devices.get(token).send('bad json-rpc message');
  });
});

test('call with the parameters', async () => {
  const result = await server.call(token, 'mirror', { a: 1, b: { c: 2 } });
  expect(result).toEqual({ a: 1, b: { c: 2 } });
});

test('call without params', async () => {
  await expect(server.call(token, 'mirror')).resolves.toEqual(null);
  await expect(server.call(token, 'mirror', undefined)).resolves.toEqual(null);
});

test('call when not connected', async () => {
  expect(() => {
    server.call('nonexistent client', 'ping');
  }).toThrowError(Errors.NotConnectedError);
});

test('unregister method', async () => {
  await expect(server.call(token, 'simple')).resolves.toEqual({
    client: 'pong',
  });
  // @ts-ignore
  const methodCount = client.methods.size;
  client.unregister('simple');
  // @ts-ignore
  expect(client.methods.size).toEqual(methodCount - 1);
  await expect(server.call(token, 'simple')).rejects.toBeInstanceOf(
    Errors.ProcedureNotFoundError,
  );
});

test('request timeout', async () => {
  jest.setTimeout(timeOut);
  await Promise.all([
    expect(server.call(token, 'wait')).rejects.toBeInstanceOf(
      Errors.RequestError,
    ),
    (() => {
      console.log(server.stats);
      expect(server.stats.requestsInProgress).toBeGreaterThan(0);
    })(),
  ]);
});
