import { Server } from './index';

/**
 * @hidden
 * @ignore
 */
const ws = new Server({
  port: 8080,
  handshake: async (token) => {
    console.log('connected', token);
    return true;
  },
  prepareContext: (ctx) => ({ ...ctx, useWS: true }),
});

ws.register('ping', (ctx, params) => {
  console.log(ctx.id, 'server ping from', ctx.token, params, ctx.useWS);
  return Promise.resolve({ server: 'pong' });
});

ws.register('exception', () => {
  throw new Error('server exception');
});

ws.register('run', async () => {
  console.log(await ws.call('id13', 'ping', {}));
  console.log(await ws.call('id13', 'ping', { a: 1 }));
  console.log(await ws.call('id13', 'ping'));
  console.log(await ws.call('id13', 'ping', undefined));
  try {
    console.log(await ws.call('id13', 'exception', { a: 1 }));
  } catch (e) {
    console.error('error', e.message);
  }
  try {
    console.log(await ws.call('id13', 'nonexists', { a: 1 }));
  } catch (e) {
    console.error('error', e.message);
  }
});
