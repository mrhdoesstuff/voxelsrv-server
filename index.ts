import WebSocket from 'ws';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { WSSocket } from './src/socket';

import { startServer } from './src/server';

let json = '{"port": 3000}';
if (fs.existsSync('./config/') && fs.existsSync('./config/config.json')) json = fs.readFileSync('./config/config.json').toString();

const cfg = JSON.parse(json.toString());

const wss = new WebSocket.Server({ port: cfg.port });

const event = new EventEmitter();

wss.on('connection', (s) => {
	event.emit('connection', new WSSocket(s));
});

startServer(event);
