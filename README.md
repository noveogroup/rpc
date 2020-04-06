# Dual rpc via websockets

This library helps to organize the remote methods calls via websockets in both
directions: from the server to the client and vice versa.

Docs: https://agsh.github.io/dual-rpc-ws

The project splits into two parts:

## Clent-side class `Client`
Can be imported from the `@noveo/dual-rpc-ws/client`
```typescript
import Client from '@noveo/dual-rpc-ws/client';
```
Documentation for it can be found here: https://agsh.github.io/dual-rpc-ws/classes/client.html

## Server-side class `Server`
Can be imported from the `@noveo/dual-rpc-ws/server`
```typescript
import Server from '@noveo/dual-rpc-ws/server';
// or
import { Server } from '@noveo/dual-rpc-ws';
```
Documentation for it can be found here: https://agsh.github.io/dual-rpc-ws/classes/server.html
