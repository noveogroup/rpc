import Server from './server';

const server = new Server({
  port: 8081,
  handshake: async (id) => {
    console.log('connected', id);
    return Promise.resolve(true);
  },
});

server.register('hi', (token: string, params: any) => {
  console.log('server hi', params);
  return Promise.resolve(`${token}, hello, ${params.a}`);
});

server.register('ping', () => {
  return 'pong';
});

setInterval(async () => {
  try {
    const a = await server.call('id1', 'hi', { b: 2 });
    console.log(a);
  } catch (e) {}
}, 20000);

/*
В терминале
server hi { a: 1 }
client hi { b: 2 }
hello, 1 hello, 2
 */
