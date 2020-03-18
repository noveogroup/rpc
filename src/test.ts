import Server from './server';

const server = new Server({
  port: 8081,
});

server.register('hi', (params: any) => {
  console.log('server hi', params);
  return Promise.resolve(`hello, ${params.a}`);
});

server.on('handshake', (id, callback) => {
  console.log('connected', id);
  callback(false);
});

setInterval(async () => {
  try {
    const [a, b] = await Promise.all([server.call('id1', 'hi', { b: 2 })]);
    console.log(a, b);
  } catch (e) {}
}, 20000);

/*
В терминале
server hi { a: 1 }
client hi { b: 2 }
hello, 1 hello, 2
 */
