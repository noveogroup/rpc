# Dual rpc via websockets

![Tests](https://github.com/agsh/rpc/workflows/Tests/badge.svg)
[![Test Coverage](https://api.codeclimate.com/v1/badges/5ea026bd273c2043f2cb/test_coverage)](https://codeclimate.com/github/agsh/rpc/test_coverage)

This library helps to organize the remote methods calls via websockets in both
directions: from the server to the client and vice versa.

Docs: https://agsh.github.io/rpc

The project splits into two parts:

## Clent-side class `Client`
Can be imported from the `@noveo/dual-rpc-ws/client`
```typescript
import Client from '@noveo/dual-rpc-ws/client';
```
Documentation for it can be found here: https://agsh.github.io/rpc/classes/client.html

## Server-side class `Server`
Can be imported from the `@noveo/dual-rpc-ws/server`
```typescript
import Server from '@noveo/dual-rpc-ws/server';
// or
import { Server } from '@noveo/dual-rpc-ws';
```
Documentation for it can be found here: https://agsh.github.io/rpc/classes/server.html
