import { Server, Client } from './index';

const server = new Server({
  port: 8081,
});

const client = new Client('id1', 'ws://localhost:8081');

client.register('hi', (params: any) => {
  console.log('client hi', params);
  return Promise.resolve(`hello, ${params.b}`);
});

server.register('hi', (params: any) => {
  console.log('server hi', params);
  return Promise.resolve(`hello, ${params.a}`);
});

setTimeout(async () => {
  const [a, b] = await Promise.all([
    client.call('hi', { a: 1 }),
    server.call('id1', 'hi', { b: 2 }),
  ]);
  console.log(a, b);
}, 2000);

/*
В терминале
server hi { a: 1 }
client hi { b: 2 }
hello, 1 hello, 2
 */
