import kindOf from 'kind-of';
import Server from '../src/server';
import { ReconnectingClient } from '../src/client';
import { Errors } from '../src/errors';

const port = 3667;
const timeOut = 10000;
const serverParams = () => ({
  address: `ws://localhost:${port}`,
  token: `good-client-${Math.random()}`,
});
let server!: Server;

beforeAll(() => {
  server = new Server({ port, prepareContext: (id) => id });
  server.register('promise', () => Promise.resolve({ server: 'pong' }));
  server.register('simple', () => ({ server: 'pong' }));
  server.register('string', () => '42');
  server.register('number', () => 42);
  server.register('boolean', () => true);
  server.register('array', () => [1, 2, 3]);
  server.register('exception', async () => {
    throw new Error('server exception');
  });
  server.register('mirror', (_ctx, params) => params);
  server.register('wait', async () => {
    await new Promise((resolve) => setTimeout(resolve, timeOut));
    return 'time!';
  });
});

afterAll(() => server.close());

test('simple call with promise object value', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await expect(client.call('promise')).resolves.toMatchObject({
    server: 'pong',
  });
});

test('simple call with simple value', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await expect(client.call('simple')).resolves.toMatchObject({
    server: 'pong',
  });
});

test('simple call with different return types', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  for (const type of ['string', 'number', 'boolean', 'array']) {
    await expect(client.call(type).then(kindOf)).resolves.toStrictEqual(type);
  }
});

test('call with exception', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await expect(client.call('exception')).rejects.toBeInstanceOf(
    Errors.RequestError,
  );
});

test('call nonexistent method', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await expect(client.call('quasi method')).rejects.toBeInstanceOf(
    Errors.ProcedureNotFoundError,
  );
});

test('call with the wrong message', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await new Promise((resolve) => {
    server.once('error', (e) => {
      expect(e).toBeInstanceOf(Errors.InvalidJSONRPCError);
      expect(e.message).toStrictEqual(
        'Malformed message: bad json-rpc message',
      );
      resolve();
    });
    // @ts-ignore
    client.instance.send('bad json-rpc message');
  });
});

test('call with message without id', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await new Promise((resolve) => {
    server.once('error', (e) => {
      expect(e).toBeInstanceOf(Errors.InvalidJSONRPCError);
      resolve();
    });
    // @ts-ignore
    client.instance.send(
      JSON.stringify({ jsonrpc: '2.0', method: 'ping', params: null }),
    );
  });
});

test('call with the parameters', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  const result = await client.call('mirror', { a: 1, b: { c: 2 } });
  expect(result).toEqual({ a: 1, b: { c: 2 } });
});

test('call without params', async () => {
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await expect(client.call('mirror')).resolves.toEqual(null);
  await expect(client.call('mirror', undefined)).resolves.toEqual(null);
});

test('call when not connected', async () => {
  const client = new ReconnectingClient(serverParams());
  expect(() => {
    client.call('ping');
  }).toThrowError(Errors.NotConnectedError);
});

test('request timeout', async () => {
  jest.setTimeout(timeOut);
  const client = new ReconnectingClient(serverParams());
  await client.init();
  await expect(client.call('wait')).rejects.toBeInstanceOf(Errors.RequestError);
});
