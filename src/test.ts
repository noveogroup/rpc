import { Server } from './index';

const ws = new Server({
  port: 8080,
  handshake: async (token) => {
    console.log('connected', token);
    return true;
  },
});

ws.register('ping', (ctx, params) => {
  console.log(ctx.id, 'server ping from', ctx.token, params);
  return Promise.resolve({ server: 'pong' });
});

ws.register('exception', () => {
  throw new Error('server exception');
});
