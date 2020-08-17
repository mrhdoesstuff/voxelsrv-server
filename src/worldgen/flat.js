const block = require('../registry').blockPalette

module.exports = class {
	constructor(seed) {
		this.chunkWitdh = 24
		this.chunkHeight = 120
		this.seed = seed
	}

	getBlock(x, y, z) {
		if (y == 40) return block.grass
		else if (35 < y && y < 40) return block.dirt
		else if (y <= 35) return block.stone
		else return 0
	}


	generateChunk(id, chunk) {
		for (var x = 0; x < this.chunkWitdh; x++) {
			for (var z = 0; z < this.chunkWitdh; z++) {
				for (var y = 0; y < this.chunkHeight; y++) {
					var block = this.getBlock(x+id[0]*24, y, z+id[1]*24)
					if (block != 0) chunk.set(x, y, z, block)
				}
			}
		}
		return chunk
	}

	getHeightMap() {
		return 40
	}

	getBiome() {
		return 'plants'
	}

}
