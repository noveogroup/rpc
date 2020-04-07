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
