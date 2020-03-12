import Server from './server';
import Client from './client';

const server = new Server({
  port: 8080,
});

const client = new Client('ws://localhost:8080', '1');

client.register('hi', (params: any) => {
  console.log('client hi', params);
});

server.register('hi', (params: any) => {
  console.log(params);
});
