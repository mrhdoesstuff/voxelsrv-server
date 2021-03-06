import { EventEmitter } from 'events';

import * as players from './player';
import * as registry from './registry';
import * as console from './console';
import * as protocol from './protocol';
import * as entity from './entity';
import * as chat from './chat';

import { serverVersion, serverProtocol, serverConfig, invalidNicknameRegex } from '../values';
import { BaseSocket } from '../socket';

export function setupConnectionHandler(wss) {
	const connections = {};
	let playerCount = 0;

	function sendChat(msg) {
		chat.sendMlt([console.executorchat, ...Object.values(players.getAll())], msg);
	}

	function verifyLogin(data) {
		if (data == undefined) return 'No data!';
		else if (data.username == undefined || invalidNicknameRegex.test(data.username)) return 'Illegal username - ' + data.username;
		else if (data.protocol == undefined || data.protocol != serverProtocol) return 'Unsupported protocol';

		return 0;
	}

	wss.on('connection', async function (socket: BaseSocket) {
		socket.send('LoginRequest', {
			name: serverConfig.name,
			motd: serverConfig.motd,
			protocol: serverProtocol,
			maxplayers: serverConfig.maxplayers,
			numberplayers: playerCount,
			software: `VoxelSrv-Server`,
		});


		let loginTimeout = true;

		socket.on('LoginResponse', function (data) {
			loginTimeout = false;

			if (playerCount >= serverConfig.maxplayers) {
				socket.send('PlayerKick', { reason: 'Server is full', time: Date.now() });
				socket.close();
				return;
			}

			const check = verifyLogin(data);
			if (data.username == '' || data.username == null || data.username == undefined) data.username = 'Player' + Math.round(Math.random() * 100000);

			const id = data.username.toLowerCase();

			if (check != 0) {
				socket.send('PlayerKick', { reason: check, time: Date.now() });
				socket.close();
			}
			if (connections[id] != undefined) {
				socket.send('PlayerKick', {
					reason: 'Player with that nickname is already online!',
					time: Date.now(),
				});
				socket.close();
			} else {
				players.event.emit('connection', id);
				var player = players.create(id, data, socket);

				socket.send('LoginSuccess', {
					xPos: player.entity.data.position[0],
					yPos: player.entity.data.position[1],
					zPos: player.entity.data.position[2],
					inventory: JSON.stringify(player.inventory),
					blocksDef: JSON.stringify(registry.blockRegistryObject),
					itemsDef: JSON.stringify(registry.itemRegistryObject),
					armor: JSON.stringify(player.entity.data.armor),
				});

				connections[id] = socket;

				socket.send('PlayerEntity', { uuid: player.entity.id });

				Object.entries(player.world.entities).forEach(function (data: any) {
					socket.send('EntityCreate', {
						uuid: data[0],
						data: JSON.stringify(data[1].data),
					});
				});

				const joinMsg = [new chat.ChatComponent(`${player.displayName} joined the game!`, '#b5f598')];
				sendChat(joinMsg);
				chat.event.emit('system-message', joinMsg);
				playerCount = playerCount + 1;

				socket.on('close', function () {
					players.event.emit('disconnect', id);
					const leaveMsg = [new chat.ChatComponent(`${player.displayName} left the game!`, '#f59898')];
					sendChat(leaveMsg);
					chat.event.emit('system-message', leaveMsg);
					player.remove();
					delete connections[id];
					playerCount = playerCount - 1;
				});
				socket.on('ActionMessage', function (data) {
					player.action_chatsend(data);
				});

				socket.on('ActionBlockBreak', function (data) {
					player.action_blockbreak(data);
				});

				socket.on('ActionBlockPlace', function (data) {
					player.action_blockplace(data);
				});

				socket.on('ActionMove', function (data) {
					player.action_move(data);
				});

				socket.on('ActionInventoryClick', function (data) {
					player.action_invclick(data);
				});

				socket.on('ActionClick', function (data) {
					player.action_click(data);
				});
				
				socket.on('ActionClickEntity', function (data) {
					player.action_click(data);
				});
			}
		});

		setTimeout(function () {
			if (loginTimeout == true) {
				socket.send('PlayerKick', { reason: 'Timeout!' });
				socket.close();
			}
		}, 10000);
	});
}
