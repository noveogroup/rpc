# Dual rpc via websockets

## Client class

### Constructor (token: string, address: string)
Connect to the server using an address and unique id that concrete the client

### Methods

### call(method: string, params?: object|Array): Promise\<object\>
Call the server method using params as one argument construction.
Returns a Promise with the JSON response from the server

### register(method: string, handler: Function\<Promise\>): void
Register the method on the client side, handler must return an object or a Promise\<object\> 
which will be held on the server side 

### Events

### handshake(event: {detail: boolean})
In this time we can send messages to the server, the connection is accepted
when `detail` argument is true. Otherwise the connection is aborted

## Server class
### Constructor ({handshake?: (token: string, ws: DeviceSocket) => Promise\<boolean\>, ...ws.ServerOptions})
Setup the server with ws.ServerOptions object.
`hanshake` is the handler for the new connections. It accepts client token, Websocket instance
 of the new connection and returns `true`
if connection can be established and false to broke the connection

### Methods

### call(token: string, method: string, params?: object|Array): Promise\<object\>
Call the client with the token method using params as one argument construction.
Returns a Promise with the JSON response from the client

### register(method: string, handler: (token: string, params: object) => Promise\<object\>): void
Register the method on the server side, handler accepts token of the client it was called
and params as an object and must return an object or a Promise\<object\> 
which will be held on the client side 

### Example of usage
Client
```javascript
const client = new Client('id1', 'ws://localhost:8081');
client.addEventListener('handshake', (event) => {
    console.log('We can send messages to the server with this token:', event.detail);
    if (event.detail === true) {
        client.call('ping').then((data) => {
            console.log('ping data:', data)
        });
        setInterval(async () => {
            try {
                const a = await client.call('hi', { a: 2 });
                console.log(a);
            } catch (e) {}
        }, 20000);
    }
});
client.register('hi', (params) => {
    console.log('client hi', params);
    return Promise.resolve(`hello, ${params.b}`);
});
```
Server
```typescript
import Server from '@noveo/dual-rpc-ws';

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

setInterval(async () => {
  try {
    const a = await server.call('id1', 'hi', { b: 2 });
    console.log(a);
  } catch (e) {}
}, 20000);
```
