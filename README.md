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

## Example of usage

```javascript
const { Server, Client } = require('@noveo/dual-rpc-ws');

const server = new Server({
	port: 8080,
});

const client = new Client('id1', 'ws://localhost:8080');

client.register('hi', (params) => {
	console.log('client hi', params);
	return Promise.resolve(`hello, ${params.b}`);
});

server.register('hi', (params) => {
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
```
