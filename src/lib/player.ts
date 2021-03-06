import { EventEmitter } from 'events';
import * as vec from 'gl-vec3';
import * as pako from 'pako';

export const event = new EventEmitter();

import * as entity from './entity';
import * as worldManager from './worlds';
import * as registry from './registry';
import * as fs from 'fs';
import * as console from './console';
import * as types from '../types';
import * as chat from './chat';

import { PlayerInventory, ArmorInventory } from './inventory';
import { PlayerPermissionHolder } from './permissions';

import { serverConfig } from '../values';
import * as pClient from 'voxelsrv-protocol/js/client';
import { BaseSocket } from '../socket';

const players = {};
const chunksToSend = [];

export function create(id: string, data: any, socket: BaseSocket): Player {
	players[id] = new Player(id, data.username, socket);

	event.emit('create', players[id]);

	return players[id];
}

export function read(id: string): object | null {
	try {
		let r = null;
		const name = id + '.json';
		const data = fs.readFileSync('./players/' + name);
		r = JSON.parse(data.toString());

		return r;
	} catch (e) {
		console.error('Tried to load data of player ' + id + ', but it failed! Error: ', e);
	}
}

export function exist(id: string): boolean {
	const name = id + '.json';
	const r = fs.existsSync('./players/' + name);
	return r;
}

export function save(id: string, data: Object) {
	fs.writeFile('./players/' + id + '.json', JSON.stringify(data), function (err) {
		if (err) console.error('Cant save player ' + id + '! Reason: ' + err);
	});
}

export function get(id: string): Player | null {
	if (players[id] != undefined) return players[id];
	else return null;
}

export function getAll(): { [index: string]: Player } {
	return players;
}

export function sendPacketAll(type: string, data: any) {
	Object.values(players).forEach((p: Player) => {
		p.sendPacket(type, data);
	});
}

entity.event.on('entity-create', (data) => {
	sendPacketAll('EntityCreate', data);
});
entity.event.on('entity-move', (data) => {
	sendPacketAll('EntityMove', data);
});
entity.event.on('entity-remove', (data) => {
	sendPacketAll('EntityRemove', data);
});

export class Player {
	readonly id: string;
	readonly nickname: string;
	displayName: string;
	entity: entity.Entity;
	world: worldManager.World;
	inventory: PlayerInventory;
	hookInventory: any;
	readonly socket: BaseSocket;
	permissions: PlayerPermissionHolder;
	chunks: types.anyobject;

	constructor(id: string, name: string, socket: BaseSocket) {
		this.id = id;
		this.nickname = name;
		this.displayName = name;
		let data: types.anyobject | null;
		if (exist(this.id)) data = read(this.id);

		if (data == null) {
			this.entity = entity.create(
				'player',
				{
					name: name,
					nametag: true,
					health: 20,
					maxHealth: 20,
					model: 'player',
					texture: 'entity/steve',
					position: serverConfig.world.spawn,
					rotation: 0,
					pitch: 0,
					hitbox: [0.55, 1.9, 0.55],
					armor: new ArmorInventory(null),
				},
				'default',
				null
			);

			this.world = worldManager.get('default');

			this.inventory = new PlayerInventory(10, null);
			this.hookInventory = null;
			this.permissions = new PlayerPermissionHolder({}, ['default']);
			event.emit('player-firstjoin', this);
			event.emit('player-join', this);
		} else {
			this.entity = entity.recreate(
				data.entity.id,
				'player',
				{
					name: data.entity.data.name,
					nametag: data.entity.data.nametag,
					health: data.entity.data.health,
					maxHealth: data.entity.data.maxhealth,
					model: 'player',
					texture: 'entity/steve',
					position: data.entity.data.position,
					rotation: data.entity.data.rotation,
					pitch: data.entity.data.pitch,
					hitbox: [0.55, 1.9, 0.55],
					armor: new ArmorInventory(data.entity.data.armor),
				},
				data.world,
				null
			);

			this.world = worldManager.get(data.world);

			this.inventory = new PlayerInventory(10, data.inventory);
			if (!!data.permissions) this.permissions = new PlayerPermissionHolder(data.permissions, [...data.permissionparents, 'default']);
			else this.permissions = new PlayerPermissionHolder({}, ['default']);
			event.emit('player-join', this);
		}

		this.socket = socket;
		this.chunks = {};
		save(this.id, this.getObject());

		this.inventory.event.on('slot-update', (data) => {
			this.sendPacket('PlayerSlotUpdate', {
				slot: parseInt(data.slot),
				data: JSON.stringify(data.data),
				type: data.type,
			});
		});

		event.emit('player-created', this);
	}

	getObject() {
		return {
			id: this.id,
			nickname: this.nickname,
			entity: this.entity.getObject(),
			inventory: this.inventory.getObject(),
			world: this.world.name,
			permissions: this.permissions.permissions,
			permissionparents: Object.keys(this.permissions.parents),
		};
	}

	sendPacket(type: string, data: Object) {
		this.socket.send(type, data);
	}

	remove() {
		event.emit('player-remove', this);
		save(this.id, this.getObject());
		this.entity.remove();

		setTimeout(() => {
			delete players[this.id];
		}, 10);
	}

	teleport(pos: types.XYZ, eworld: string | worldManager.World) {
		this.entity.teleport(pos, eworld);
		this.world = typeof eworld == 'string' ? worldManager.get(eworld) : eworld;
		this.sendPacket('PlayerTeleport', { x: pos[0], y: pos[1], z: pos[2] });
	}

	move(pos: types.XYZ) {
		event.emit('player-move', { id: this.id, pos: pos });
		this.entity.move(pos);
	}

	send(msg: string | chat.ChatMessage) {
		if (typeof msg == 'string') msg = chat.convertFromPlain(msg);
		this.sendPacket('ChatMessage', { message: msg, time: Date.now() });
	}

	rotate(rot: number | null, pitch: number | null) {
		event.emit('player-rotate', { id: this.id, rot, pitch });
		this.entity.rotate(rot, pitch);
	}

	kick(reason: string) {
		this.sendPacket('PlayerKick', { reason: reason, date: Date.now() });
	}

	updateMovement(key: string, value: number) {
		this.sendPacket('PlayerUpdateMovement', { key: key, value: value });
	}

	updatePhysics(key: string, value: number) {
		this.sendPacket('PlayerUpdatePhysics', { key: key, value: value });
	}

	applyForce(x: number, y: number, z: number) {
		this.sendPacket('PlayerApplyImpulse', { x, y, z });
	}

	get getID() {
		return this.id;
	}

	action_blockbreak(data: pClient.IActionBlockBreak & { cancel: boolean }) {
		if (data.x == undefined || data.y == undefined || data.z == undefined) return;

		data.cancel = false;
		for (let x = 0; x <= 5; x++) {
			event.emit(`player-blockbreak-${x}`, this, data);
			if (data.cancel) return;
		}

		const blockpos: types.XYZ = [data.x, data.y, data.z];
		const block = this.world.getBlock(blockpos, false);
		const pos = this.entity.data.position;

		if (vec.dist(pos, [data.x, data.y, data.z]) < 14 && block != undefined && block.unbreakable != true) {
			this.world.setBlock(blockpos, 0, false);
			sendPacketAll('WorldBlockUpdate', {
				id: 0,
				x: data.x,
				y: data.y,
				z: data.z,
			});
		}
	}

	action_blockplace(data: pClient.IActionBlockPlace & { cancel: boolean }) {
		data.cancel = false;
		for (let x = 0; x <= 5; x++) {
			event.emit(`player-blockplace-${x}`, this, data);
			if (data.cancel) return;
		}

		const inv = this.inventory;
		const itemstack = inv.items[inv.selected];
		const pos = this.entity.data.position;

		if (vec.dist(pos, [data.x, data.y, data.z]) < 14 && itemstack != undefined && itemstack.id != undefined) {
			if (itemstack != null && itemstack.item.block != undefined) {
				//player.inv.remove(id, item.id, 1, {})
				this.world.setBlock([data.x, data.y, data.z], itemstack.item.block.getRawID(), false);
				sendPacketAll('WorldBlockUpdate', {
					id: registry.blockPalette[itemstack.item.block.id],
					x: data.x,
					y: data.y,
					z: data.z,
				});
			}
		}
	}

	action_invclick(data: pClient.IActionInventoryClick & { cancel: boolean }) {
		if (data.inventory == undefined) data.inventory = 'main';

		data.cancel = false;
		for (let x = 0; x <= 5; x++) {
			event.emit(`player-invclick-${x}`, this, data);
			if (data.cancel) return;
		}

		let inventory;
		let type = 'main';
		switch (data.inventory) {
			case 'main':
				inventory = this.inventory;
				type = 'main';
				break;
			case 'hook':
				inventory = this.hookInventory != null ? this.hookInventory : this.inventory;
				type = 'hook';
				break;
			case 'armor':
				inventory = this.entity.data.armor;
				type = 'armor';
				break;
		}

		if (-2 < data.slot && data.slot <= this.inventory.size) {
			if (data.type == 'left') this.inventory.action_left(inventory, data.slot, type);
			else if (data.type == 'right') this.inventory.action_right(inventory, data.slot, type);
			else if (data.type == 'switch') this.inventory.action_switch(data.slot, data.slot2);
			else if (-1 < data.slot && data.slot < 9 && data.type == 'select') this.inventory.select(data.slot);
		}
	}

	action_chatsend(data: pClient.IActionMessage & { cancel: boolean }) {
		data.cancel = false;
		for (let x = 0; x <= 5; x++) {
			event.emit(`player-message-${x}`, this, data);
			if (data.cancel) return;
		}

		if (data.message.charAt(0) == '/') {
			const arg = data.message.split(' ');
			const command = arg[0];
			arg.shift();
			event.emit('player-executecommand', this, command, arg);

			if (registry.commandRegistry[command]) {
				try {
					registry.commandRegistry[command].trigger(this, arg);
				} catch (e) {
					console.error(`User ^R${this.nickname}^r tried to execute command ^R${command}^r and it failed! \n ^R`, e);
					this.send([new chat.ChatComponent('An error occurred during the execution of this command!', 'red')]);
				}
			} else this.send([new chat.ChatComponent("This command doesn't exist! Check /help for list of available commands.", 'red')]);
		} else if (data.message != '') {
			const msg = [
				new chat.ChatComponent(this.displayName, 'white'),
				new chat.ChatComponent(' » ', '#eeeeee'),
				new chat.ChatComponent(data.message, 'white'),
			];

			chat.event.emit('chat-message', msg);

			chat.sendMlt([console.executorchat, ...Object.values(getAll())], msg);
		}
	}

	action_move(data: pClient.IActionMove & { cancel: boolean }) {
		if (data.x == undefined || data.y == undefined || data.z == undefined) return;

		data.cancel = false;
		if (this.world.chunks[this.entity.chunkID.toString()] == undefined) data.cancel = true;

		const pos = this.entity.data.position;
		const move: types.XYZ = [data.x, data.y, data.z]

		for (let x = 0; x <= 5; x++) {
			event.emit(`player-move-${x}`, this, data);
			if (data.cancel) {
				this.sendPacket('PlayerTeleport', { x: pos[0], y: pos[1], z: pos[2] });
				return;
			}
		}

		if (Math.abs(data.x) > 120000 || data.y > 120000 || Math.abs(data.z) > 120000) {
			this.sendPacket('PlayerTeleport', { x: pos[0], y: pos[1], z: pos[2] });
			return;
		}

		if (vec.dist(pos, move) < 20) this.move(move);

		this.rotate(data.rotation, data.pitch);
	}

	action_click(data: pClient.IActionClick & { cancel: boolean }) {
		data.cancel = false;
		for (let x = 0; x <= 5; x++) {
			event.emit(`player-click-${x}`, this, data);
			if (data.cancel) return;
		}
	}

	action_entityclick(data: pClient.IActionClickEntity & { cancel: boolean }) {
		data.cancel = false;
		for (let x = 0; x <= 5; x++) {
			event.emit(`player-entityclick-${x}`, this, data);
			if (data.cancel) return;
		}
	}
}

setInterval(async function () {
	const list = Object.keys(players);

	list.forEach(async function (id) {
		const chunk = players[id].entity.chunkID;
		const loadedchunks = { ...players[id].chunks };
		for (let w = 0; w <= serverConfig.viewDistance; w++) {
			for (let x = 0 - w; x <= 0 + w; x++) {
				for (let z = 0 - w; z <= 0 + w; z++) {
					const tempid = [chunk[0] + x, chunk[1] + z];
					if (loadedchunks[tempid.toString()] == undefined) {
						players[id].chunks[tempid] = true;
						chunksToSend.push([id, tempid]);
					}
					if (players[id].world.chunks[tempid.toString()] != undefined) players[id].world.chunks[tempid.toString()].keepAlive();
					loadedchunks[tempid.toString()] = false;
				}
			}
		}

		const toRemove = Object.entries(loadedchunks);
		toRemove.forEach(function (item) {
			if (item[1] == true) {
				delete players[id].chunks[item[0]];
				const cid = item[0].split(',');
				players[id].sendPacket('WorldChunkUnload', {
					x: parseInt(cid[0]),
					y: 0,
					z: parseInt(cid[1]),
					type: true,
				});
			}
		});
	});
}, 1000);

setInterval(async function () {
	if (chunksToSend[0] != undefined) {
		sendChunkToPlayer(chunksToSend[0][0], chunksToSend[0][1]);
		chunksToSend.shift();
	}
}, 50);

async function sendChunkToPlayer(id: string, cid: types.XZ) {
	event.emit('sendChunk', id, cid);
	if (players[id] != undefined) {
		const chunk = await players[id].world.getChunk(cid, true);
		if (chunk != undefined && players[id] != undefined) {
			chunk.keepAlive();

			const data = serverConfig.chunkTransportCompression ? pako.deflate(chunk.data.data) : chunk.data.data;
			players[id].sendPacket('WorldChunkLoad', {
				x: cid[0],
				y: 0,
				z: cid[1],
				data: data,
				type: true,
				compressed: serverConfig.chunkTransportCompression,
			});
		}
	}
}
