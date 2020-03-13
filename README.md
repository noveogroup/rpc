# Dual rpc via websockets

## Example of usage

```javascript
const { Server, Client } = require('@noveo/dual-rpc-ws');

const server = new Server({
	port: 8080,
});

const client = new Client('ws://localhost:8080', '1');

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
		server.call('1', 'hi', { b: 2 }),
	]);
	console.log(a, b);
}, 2000);
```
