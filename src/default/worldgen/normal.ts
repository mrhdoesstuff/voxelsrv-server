import { makeNoise2D, makeNoise3D, Noise2D, Noise3D } from 'open-simplex-noise';
import * as tree from './parts/tree';
import hash from 'murmur-numbers';
import { blockPalette } from '../../lib/registry';
import * as types from '../../types';
import * as biome from './parts/biomes';
import ndarray = require('ndarray');

function getHighestBlock(chunk: types.IView3duint16, x: number, z: number) {
	for (let y = 256 - 1; y >= 0; y = y - 1) {
		const val = chunk.get(x, y, z);
		if (val != 0) return { level: y, block: val };
	}
	return null;
}

export default class normalGenerator {
	name: string = 'normal';
	chunkWitdh: number = 32;
	chunkHeight: number = 256;
	waterLevel: number = 60;
	seed: number;
	biomeNoise1: Noise2D;
	biomeNoise2: Noise2D;
	biomeNoise3: Noise2D;
	plantSeed: number;
	biomeSpacing: number = 100;
	blocks: any;
	biomes: any;
	hash: hash;
	features = {
		oakTree: -1,
		birchTree: -2,
		cactus: -3,
	};

	constructor(seed: number) {
		this.seed = seed;
		this.biomeNoise1 = makeNoise2D(Math.round(seed * Math.sin(seed ^ 3) * 10000));
		this.biomeNoise2 = makeNoise2D(Math.round(seed * Math.sin(seed ^ 4) * 10000));
		this.biomeNoise3 = makeNoise2D(Math.round(seed * Math.sin(seed ^ 5) * 10000));
		this.plantSeed = Math.round(seed * Math.sin(seed ^ 6) * 10000);
		this.blocks = blockPalette;
		this.hash = hash(this.plantSeed);

		this.biomes = {
			mountains: new biome.MountainsBiome(this.blocks, this.features, seed),
			plains: new biome.PlainsBiome(this.blocks, this.features, seed),
			desert: new biome.DesertBiome(this.blocks, this.features, seed),
			forest: new biome.ForestBiome(this.blocks, this.features, seed),
		};
	}

	getBlock(x: number, y: number, z: number, biomes): number {
		let value = 0;
		let key = '';

		for (key in biomes.possible) {
			value = value + this.biomes[key].getHeightMap(x, y, z) * biomes.possible[key];
		}
		value = value / biomes.size;

		return y <= value ? 1 : 0;
	}

	getBiomesAt(x: number, z: number): { main: biome.BaseBiome; possible: { [index: string]: number }; height: number; size: number } {
		const main = this.getBiome(x, z);

		let x1;
		let z1;

		const possible = {};
		let biome: biome.BaseBiome;
		let height: number = 0;
		let size = 0;

		for (x1 = -10; x1 <= 10; x1++) {
			for (z1 = -10; z1 <= 10; z1++) {
				if (dist2(x1, z1) > 10) continue;
				biome = this.getBiome(x + x1, z + z1);
				if (possible[biome.id] == undefined) possible[biome.id] = 0;
				possible[biome.id] = possible[biome.id] + 1;
				if (height < biome.height) height = biome.height;

				size = size + 1;
			}
		}

		return {
			main,
			possible,
			height,
			size,
		};
	}

	getBiome(x: number, z: number): biome.BaseBiome {
		let wierdness = this.biomeNoise1(x / 600, z / 600);
		const heat = this.biomeNoise2(x / 300, z / 300);
		//const water = this.biomeNoise3(x / 400, z / 400);

		if (heat < 0.2) {
			if (wierdness > 0.7) return this.biomes.mountains;
			else if (wierdness > 0.4) return this.biomes.forest;
			return this.biomes.plains;
		} else if (heat > 0.15) {
			return this.biomes.desert;
		}
	}

	async generateChunk(id: types.XZ, chunk: types.IView3duint16): Promise<types.IView3duint16> {
		const xoff = id[0] * this.chunkWitdh;
		const zoff = id[1] * this.chunkWitdh;

		let x: number, y: number, z: number;
		let block: number;
		let biomes: { main: biome.BaseBiome; possible: { [index: string]: number }; height: number };
		let biome;
		let chunkTemp = new ndarray(new Uint16Array(this.chunkWitdh * this.chunkHeight * this.chunkWitdh), [
			this.chunkWitdh,
			this.chunkHeight,
			this.chunkWitdh,
		]);

		function get(y1: number) {
			return chunkTemp.get(x, y1, z);
		}

		for (x = 0; x < this.chunkWitdh; x++) {
			for (z = 0; z < this.chunkWitdh; z++) {
				biomes = this.getBiomesAt(x + xoff, z + zoff);
				for (y = 0; y <= biomes.height; y++) {
					chunkTemp.set(x, y, z, this.getBlock(x + xoff, y, z + zoff, biomes));
				}
			}
		}

		for (x = 0; x < this.chunkWitdh; x++) {
			for (z = 0; z < this.chunkWitdh; z++) {
				biome = this.getBiome(x + xoff, z + zoff);
				for (y = 0; y <= 200; y++) {
					block = biome.getBlock(x + xoff, y, z + zoff, get);
					if (block > 0) {
						chunk.set(x, y, z, block);
					} else if (block < 0) {
						if (block == this.features.oakTree) pasteStructure(chunk, tree.oakTree(hash(x + xoff, z + zoff) * 1000, this.hash, this.blocks), x, y, z);
						else if (block == this.features.birchTree)
							pasteStructure(chunk, tree.birchTree(hash(x + xoff, z + zoff) * 1000, this.hash, this.blocks), x, y, z);
						else if (block == this.features.cactus) {
							chunk.set(x, y, z, this.blocks.cactus);
							chunk.set(x, y + 1, z, this.blocks.cactus);
							if (hash(x, z) > 0.5) chunk.set(x, y + 2, z, this.blocks.cactus);
						}
					}
				}
			}
		}
		return chunk;
	}
}

function pasteStructure(chunk: types.IView3duint16, gen: types.IView3duint16, x: number, y: number, z: number) {
	const xm = Math.round(gen.shape[0] / 2);
	const zm = Math.round(gen.shape[2] / 2);
	for (var i = 0; i < gen.shape[0]; i++) {
		// x
		let x2 = x - xm + i;
		if (x2 >= chunk.shape[0] || x2 < 0) continue;
		for (var k = 0; k < gen.shape[2]; k++) {
			// z
			let z2 = z - zm + k;
			if (z2 >= chunk.shape[2] || z2 < 0) continue;
			for (var j = 0; j < gen.shape[1]; j++) {
				// y
				if (gen.get(i, j, k) != 0) {
					chunk.set(x2, y + j, z2, gen.get(i, j, k));
				}
			}
		}
	}
}

function dist2(x: number, z: number): number {
	return Math.sqrt(x * x + z * z);
}
