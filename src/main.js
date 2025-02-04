import { mat4, quat, vec3 } from 'gl-matrix'
import { Peer } from 'peerjs'

// 0 = march
let RENDER_MODE = 1

// @ts-ignore
import SHADER from './shaders/dda.wgsl?raw'

class Entity
{
	/** @type {Entity[]} */
	static all = []
	static nextId = 1

	id = 0
    /** @type {Entity} */ parent = null
    /** @type {Entity[]} */ children = []

	position = vec3.create()
	rotation = quat.create()
	scale = vec3.fromValues(1, 1, 1)
	dirty = true
	transform = mat4.create()

	worldPosition = vec3.create()
	worldRotation = quat.create()
	worldScale = vec3.fromValues(1, 1, 1)
	worldTransform = mat4.create()

    /** @type {Model} */ model = null
	model_id = -1
	frame = 0
	frame_time = 0
	animationFrame = 0

	height = 0
	radius = 0
	vel = vec3.create()
	gravity = false

	constructor()
	{
		Entity.all.push(this)
	}

	/**
	 * 
	 * @param {mat4} parentTransform 
	 */
	updateTransform(parentTransform)
	{
		if (this.dirty)
		{
			mat4.fromRotationTranslationScale(this.transform, this.rotation, this.position, this.scale)
			if (parentTransform)
			{
				mat4.multiply(this.worldTransform, parentTransform, this.transform)
			} else
			{
				mat4.copy(this.worldTransform, this.transform)
			}

			mat4.getTranslation(this.worldPosition, this.worldTransform)
			mat4.getRotation(this.worldRotation, this.worldTransform)
			mat4.getScaling(this.worldScale, this.worldTransform)
			this.dirty = false
		}

		for (const child of this.children)
		{
			child.dirty = true
			child.updateTransform(this.worldTransform)
		}
	}

	/**
	 * 
	 * @param {*} data
	 * @returns {Entity}
	 */
	static deserialize(data)
	{
		let entity

		switch (data.type.toUpperCase())
		{
			case 'PLAYER':
				return null
			case 'SPAWN':
				entity = new Spawn()
				break
			default:
				entity = new Entity()
				break
		}

		entity.position = vec3.fromValues(data.x / 32, data.y / 32, 1)

		for (const property of data.properties ?? [])
		{
			switch (property.name)
			{
				case 'rotation':
					quat.fromEuler(entity.rotation, 0, 0, property.value)
					break
				case 'scale':
					entity.scale = vec3.fromValues(property.value, property.value, property.value)
					entity.radius = property.value
					break
				case 'model_id':
					entity.model_id = property.value
					break
			}
		}
		entity.model = models[entity.model_id]
		return entity
	}

	/**
	 * @param {Level} terrain
	 * @returns {boolean}
	 */
	onGround(terrain)
	{
		const r = .85 * this.radius
		if (terrain.getVoxel(this.position[0], this.position[1], this.position[2] - Number.EPSILON))
		{
			return true
		}
		if (terrain.getVoxel(this.position[0] + r, this.position[1], this.position[2] - Number.EPSILON))
		{
			return true
		}
		if (terrain.getVoxel(this.position[0] - r, this.position[1], this.position[2] - Number.EPSILON))
		{
			return true
		}
		if (terrain.getVoxel(this.position[0], this.position[1] + r, this.position[2] - Number.EPSILON))
		{
			return true
		}
		if (terrain.getVoxel(this.position[0], this.position[1] - r, this.position[2] - Number.EPSILON))
		{
			return true
		}
		return false
	}

	/** 
	 * @param {number} elapsed 
	 */
	update(elapsed) { }
}

class Camera extends Entity
{
	fov = Math.PI / 3
	aspect = 1
	near = .1
	far = 1000
	projection = mat4.create()
	view = mat4.create()

	updateWorld()
	{
		mat4.fromRotationTranslation(this.worldTransform, this.rotation, this.position)
	}

	updateView()
	{
		mat4.invert(this.view, this.worldTransform)
	}

	updateProjection()
	{
		this.aspect = renderer.viewport[0] / renderer.viewport[1]
		mat4.perspective(this.projection, Math.PI / 3, this.aspect, .1, 1000)
		mat4.rotateX(this.projection, this.projection, -Math.PI / 2)
	}

	update()
	{
		mat4.invert(this.view, this.worldTransform)
		this.updateProjection()
	}
}


class Player extends Entity
{
	gravity = true
	height = .5
	radius = .25
	model = models['player']
	head = new Entity()

	constructor(id = Entity.nextId++)
	{
		super()
		this.id = id
		this.head.id = Entity.nextId++
		this.head.parent = this
		this.head.position = vec3.fromValues(0, 0, .8 * this.height)
		this.children.push(this.head)
	}

	respawn()
	{
		vec3.zero(this.position)
		vec3.zero(this.vel)
		quat.identity(this.rotation)
		quat.identity(this.head.rotation)

		for (const e of Entity.all)
		{
			if (e instanceof Spawn)
			{
				vec3.copy(this.position, e.position)
				quat.copy(this.rotation, e.rotation)
				this.dirty = true
				break
			}
		}
	}
}

class Spawn extends Entity
{
	gravity = true
	height = 0
	radius = 0
	model = models['spawn']
}

class Model
{
	static nextId = 0
	/** @type {Model[]} */ static models = []

	url = ''
	id = Model.nextId++
	sizeX = 0
	sizeY = 0
	sizeZ = 0
	voxels = null
	faces = null
	faceCount = 0
	palette = null
	paletteIndex = -1
	texture = null
	accelerationTexture = null
	/** @type {GPUBuffer} */ rasterBuffer = null
	bindGroup = null

	constructor(url = '')
	{
		this.url = url
	}

	async load()
	{
		const response = await fetch(this.url)
		if (!response.ok)
		{
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		if (response.headers.get('Content-Type') === 'text/html')
		{
			throw new Error('Invalid model: ' + this.url)
		}

		const buffer = await response.arrayBuffer()
		const dataView = new DataView(buffer)

		this.sizeX = dataView.getInt32(0, true)
		this.sizeY = dataView.getInt32(4, true)
		this.sizeZ = dataView.getInt32(8, true)

		const numVoxels = this.sizeX * this.sizeY * this.sizeZ
		const sourceVoxels = new Uint8Array(dataView.buffer, 12, numVoxels)
		this.voxels = new Uint8Array(numVoxels)

		// Transform from [x][y][z] to [z][y][x]
		for (let x = 0; x < this.sizeX; x++)
		{
			for (let y = 0; y < this.sizeY; y++)
			{
				for (let z = 0; z < this.sizeZ; z++)
				{
					const srcIdx = x * this.sizeY * this.sizeZ + y * this.sizeZ + z
					const dstIdx = (this.sizeZ - z - 1) * this.sizeY * this.sizeX + (this.sizeY - y - 1) * this.sizeX + x
					this.voxels[dstIdx] = sourceVoxels[srcIdx]
				}
			}
		}

		this.palette = new Uint8Array(256 * 4)
		for (let i = 0; i < 256; i++)
		{
			this.palette[i * 4 + 0] = dataView.getUint8(12 + numVoxels + i * 3 + 0) << 2
			this.palette[i * 4 + 1] = dataView.getUint8(12 + numVoxels + i * 3 + 1) << 2
			this.palette[i * 4 + 2] = dataView.getUint8(12 + numVoxels + i * 3 + 2) << 2
			this.palette[i * 4 + 3] = 255
		}

		renderer.registerModel(this)
	}
}

class Tileset
{
	url = ''
	tileWidth = 0
	tileHeight = 0
	numTiles = 0
	imageData = null
	texture = null

	constructor(url = '')
	{
		this.url = url
	}

	/**
	 * @param {string} url
	 * @returns {Promise<HTMLImageElement>}
	 */
	async #loadImage(url)
	{
		return new Promise((resolve, reject) =>
		{
			const img = new Image()
			img.src = url
			img.onload = () => resolve(img)
			img.onerror = reject
		})
	}

	async load()
	{
		const response = await fetch(this.url)
		if (!response.ok)
		{
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		let data
		try
		{
			data = await response.json()
		}
		catch (e)
		{
			console.error('Invalid tileset:', e)
			throw e
		}

		const tileWidth = data.tilewidth
		const tileHeight = data.tileheight
		const numTiles = data.tilecount

		const baseUrl = new URL(this.url, window.location.href).href

		const canvas = document.createElement('canvas')
		canvas.width = tileWidth
		canvas.height = tileHeight * numTiles
		const ctx = canvas.getContext('2d')

		if (!ctx)
		{
			throw new Error('Failed to create 2d context')
		}
		if (data.image)
		{
			const img = await this.#loadImage(new URL(data.image, baseUrl).href)
			ctx.drawImage(img, 0, 0)
		} else if (data.tiles)
		{
			await Promise.all(data.tiles.map(async (tile) =>
			{
				const img = await this.#loadImage(new URL(tile.image, baseUrl).href)
				ctx.drawImage(img, 0, tileHeight * tile.id, tileWidth, tileHeight)
			}))
		} else
		{
			throw new Error('Invalid tileset')
		}

		this.imageData = ctx.getImageData(0, 0, tileWidth, tileHeight * numTiles)
		this.tileWidth = tileWidth
		this.tileHeight = tileHeight
		this.numTiles = numTiles
		renderer.registerTileset(this)
	}
}

class Level
{
	url = ''
	sizeX = 0
	sizeY = 0
	sizeZ = 0
	voxels = null
	texture = null
	buffer = null
	bindGroup = null
	/** @type {GPUBuffer} */ rasterBuffer = null


	constructor(url = '')
	{
		this.url = url
	}

	getVoxel(x, y, z)
	{
		x = Math.floor(x)
		y = Math.floor(y)
		z = Math.floor(z)

		if (x < 0 || y < 0 || z < 0 || x >= this.sizeX || y >= this.sizeY || z >= this.sizeZ)
		{
			return 0
		}

		return this.voxels[z * this.sizeY * this.sizeX + y * this.sizeX + x]
	}

	async load()
	{
		const response = await fetch(this.url)
		if (!response.ok)
		{
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		let data
		try
		{
			data = await response.json()
		}
		catch
		{
			throw new Error('Invalid level')
		}

		this.sizeX = data.width
		this.sizeY = data.height
		this.sizeZ = 3
		this.voxels = new Uint16Array(this.sizeX * this.sizeY * this.sizeZ)

		for (const layer of data.layers)
		{
			if (layer.type === 'tilelayer')
			{
				const layerIndex = ['Floor', 'Walls', 'Ceiling'].indexOf(layer.name)
				if (layerIndex === -1)
				{
					console.log(`Unknown tilelayer name: ${layer.name}`)
					continue
				}
				for (let i = 0; i < layer.data.length; i++)
				{
					const x = i % this.sizeX
					const y = this.sizeY - Math.floor(i / this.sizeX) - 1
					const z = layerIndex
					const voxelIndex = z * this.sizeX * this.sizeY + y * this.sizeX + x
					this.voxels[voxelIndex] = layer.data[i]
				}
			} else if (layer.type === 'objectgroup')
			{
				for (const object of layer.objects)
				{
					for (let i = 0; i < 1; i++)
					{
						const entity = Entity.deserialize(object)
						entity.position[1] = this.sizeY - entity.position[1]
						entity.position[0] += .5 + 2 * i
					}
				}
			}
		}

		renderer.registerLevel(this)
	}
}

class Renderer
{
    /** @type {GPUDevice} */ device = null;
    /** @type {GPUCanvasContext} */ context = null;
    /** @type {number[]} */ viewport = [0, 0];
	/** @type {GPUBindGroupLayout} */ bindGroupLayout = null;
	/** @type {GPUBindGroup} */ commonBindGroup = null;
    /** @type {GPURenderPipeline} */ terrainPipeline = null;
    /** @type {GPURenderPipeline} */ modelPipeline = null;
    /** @type {GPUTexture} */ depthTexture = null;
    /** @type {GPUBuffer} */ frameUniforms = null;
	/** @type {GPUBuffer} */ objectUniforms = null;
	/** @type {number} */ objectUniformsOffset = 0;
	/** @type {GPUTexture} */ paletteTexture = null;
	/** @type {number} */ nextPaletteIndex = 0;
	/** @type {GPUSampler} */ tileSampler = null;

	/**
	 * @param {string} code
	 * @returns {Promise<GPUShaderModule>}
	 */
	async compileShader(code)
	{
		const module = this.device.createShaderModule({
			code: code,
		})

		const info = await module.getCompilationInfo()
		for (const message of info.messages)
		{
			console.log(message)
		}

		return module
	}

	async init()
	{
		if (!navigator.gpu)
		{
			throw new Error('WebGPU not supported')
		}
		const adapter = await navigator.gpu.requestAdapter()
		if (!adapter)
		{
			throw new Error('No GPU adapter found')
		}
		this.device = await adapter.requestDevice({
			requiredFeatures: ['timestamp-query']
		})
		const canvas = document.createElement('canvas')
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
		document.body.appendChild(canvas)
		this.viewport = [canvas.width, canvas.height]
		this.context = canvas.getContext('webgpu')
		this.context.configure({
			device: this.device,
			format: navigator.gpu.getPreferredCanvasFormat(),
			alphaMode: 'premultiplied',
		})
		window.addEventListener('resize', () =>
		{
			canvas.width = window.innerWidth
			canvas.height = window.innerHeight
			this.viewport = [canvas.width, canvas.height]
			this.createDepthTexture()
			this.context.configure({
				device: this.device,
				format: navigator.gpu.getPreferredCanvasFormat(),
				alphaMode: 'premultiplied',
			})
		})
		this.createDepthTexture()
		this.frameUniforms = this.device.createBuffer({
			size: 256,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
		this.objectUniforms = this.device.createBuffer({
			size: (256) * 100000,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
		this.transferBuffer = new ArrayBuffer(256 * 100000)
		this.paletteTexture = this.device.createTexture({
			format: 'rgba8unorm',
			size: [256, 256, 1],
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		})
		this.tileSampler = this.device.createSampler({
			magFilter: 'nearest',
			minFilter: 'nearest',
			addressModeU: 'repeat',
			addressModeV: 'repeat',
			addressModeW: 'repeat',
		})

		this.frameTimes = []
		this.lastTimePrint = performance.now()
		this.querySet = this.device.createQuerySet({
			type: "timestamp",
			count: 2,
		})
		this.queryResolve = this.device.createBuffer({
			size: 16, // 2 * 8-byte timestamps
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		})
		this.queryResult = this.device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		})

		const shader = await this.compileShader(SHADER)

		/** @type {GPUBindGroupLayoutDescriptor} */const bindGroupDescriptor = {
			label: 'common',
			entries: [
				// frame uniforms
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
					}
				},
				// object uniforms
				{
					binding: 1,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
						hasDynamicOffset: true,
					}
				},
				// voxels
				{
					binding: 2,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'uint',
						viewDimension: '3d',
					}
				},
				// palette
				{
					binding: 3,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'float',
						viewDimension: '2d',
					}
				},
				// tiles
				{
					binding: 4,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'float',
						viewDimension: '2d-array',
					}
				},
				// tile sampler
				{
					binding: 5,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: {
						type: 'non-filtering',
					}
				},
			]
		}
		if (RENDER_MODE === 1)
		{
			bindGroupDescriptor.entries = [...bindGroupDescriptor.entries, {
				binding: 6,
				visibility: GPUShaderStage.FRAGMENT,
				texture: {
					sampleType: 'uint',
					viewDimension: '3d',
				}
			}]
		}

		this.bindGroupLayout = this.device.createBindGroupLayout(bindGroupDescriptor)

		/** @type {GPURenderPipelineDescriptor} */const terrainPipelineDescriptor = {
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.bindGroupLayout]
			}),
			vertex: {
				module: shader,
				entryPoint: 'vs_main',
			},
			fragment: {
				module: shader,
				entryPoint: 'fs_terrain',
				targets: [
					{
						format: navigator.gpu.getPreferredCanvasFormat(),
					}
				],
			},
			primitive: {
				topology: 'triangle-list',
				cullMode: 'back',
			},
			depthStencil: {
				format: 'depth24plus',
				depthWriteEnabled: true,
				depthCompare: 'less',
			},
		}

		this.terrainPipeline = this.device.createRenderPipeline(terrainPipelineDescriptor)

		/** @type {GPURenderPipelineDescriptor} */const modelPipelineDescriptor = {
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.bindGroupLayout]
			}),
			vertex: {
				module: shader,
				entryPoint: 'vs_main',
			},
			fragment: {
				module: shader,
				entryPoint: 'fs_model_2',
				targets: [
					{
						format: navigator.gpu.getPreferredCanvasFormat(),
					}
				],

			},
			primitive: {
				topology: 'triangle-list',
				cullMode: 'back',
			},
			depthStencil: {
				format: 'depth24plus',
				depthWriteEnabled: true,
				depthCompare: 'less',
			},
		}


		this.modelPipeline = this.device.createRenderPipeline(modelPipelineDescriptor)
	}

	generateAccelerationData(voxels, sizeX, sizeY, sizeZ)
	{
		const regionSizeX = sizeX + 3 >> 2
		const regionSizeY = sizeY + 3 >> 2
		const regionSizeZ = sizeZ + 1 >> 1
		const data = new Uint32Array(regionSizeX * regionSizeY * regionSizeZ)

		for (let z = 0; z < sizeZ; z++)
		{
			for (let y = 0; y < sizeY; y++)
			{
				for (let x = 0; x < sizeX; x++)
				{
					const voxel = voxels[z * sizeY * sizeX + y * sizeX + x]
					if (voxel !== 255)
					{
						const regionX = x >> 2
						const regionY = y >> 2
						const regionZ = z >> 1
						const localX = x & 3
						const localY = y & 3
						const localZ = z & 1
						const bitIndex = localX + (localY * 4) + (localZ * 16)
						const regionIndex = regionZ * regionSizeY * regionSizeX +
							regionY * regionSizeX + regionX
						data[regionIndex] |= 1 << bitIndex
					}
				}
			}
		}
		return data
	}

	generateMipsData(voxels, sizeX, sizeY, sizeZ)
	{
		const regionSizeX = sizeX + 3 >> 2
		const regionSizeY = sizeY + 3 >> 2
		const regionSizeZ = sizeZ + 3 >> 2
		const mip1SizeX = sizeX + 7 >> 3
		const mip1SizeY = sizeY + 7 >> 3
		const mip1SizeZ = sizeZ + 7 >> 3

		const mip1Data = new Uint8Array(mip1SizeX * mip1SizeY * mip1SizeZ)

		for (let rz = 0; rz < regionSizeZ; rz++)
		{
			for (let ry = 0; ry < regionSizeY; ry++)
			{
				for (let rx = 0; rx < regionSizeX; rx++)
				{
					// Check if this region has any content
					let hasContent = false
					const baseX = rx * 4
					const baseY = ry * 4
					const baseZ = rz * 4

					for (let z = 0; z < 4 && baseZ + z < sizeZ; z++)
					{
						for (let y = 0; y < 4 && baseY + y < sizeY; y++)
						{
							for (let x = 0; x < 4 && baseX + x < sizeX; x++)
							{
								const voxel = voxels[(baseZ + z) * sizeY * sizeX + (baseY + y) * sizeX + (baseX + x)]
								if (voxel !== 255)
								{
									hasContent = true
									break
								}
							}
							if (hasContent) break
						}
						if (hasContent) break
					}

					if (hasContent)
					{
						const mipX = rx >> 1
						const mipY = ry >> 1
						const mipZ = rz >> 1
						const bitIndex = (rx & 1) + ((ry & 1) << 1) + ((rz & 1) << 2)
						const mipIndex = mipZ * mip1SizeY * mip1SizeX + mipY * mip1SizeX + mipX
						mip1Data[mipIndex] |= 1 << bitIndex
					}
				}
			}
		}

		return mip1Data
	}


	/**
	 * @param {Model} model
	 * @returns {void}
	 */
	registerModel(model)
	{
		const texture = this.device.createTexture({
			size: [model.sizeX, model.sizeY, model.sizeZ],
			dimension: '3d',
			format: 'r8uint',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			mipLevelCount: 2,
		})
		this.device.queue.writeTexture(
			{
				texture,
				mipLevel: 0
			},
			model.voxels,
			{
				bytesPerRow: model.sizeX,
				rowsPerImage: model.sizeY
			},
			[model.sizeX, model.sizeY, model.sizeZ]
		)
		const mip1Data = this.generateMipsData(model.voxels, model.sizeX, model.sizeY, model.sizeZ)

		this.device.queue.writeTexture(
			{
				texture,
				mipLevel: 1
			},
			mip1Data,
			{
				bytesPerRow: model.sizeX + 7 >> 3,
				rowsPerImage: model.sizeY + 7 >> 3,
			},
			[model.sizeX + 7 >> 3, model.sizeY + 7 >> 3, model.sizeZ + 7 >> 3],
		)

		model.texture = texture
		this.device.queue.writeTexture(
			{
				texture: this.paletteTexture,
				aspect: 'all',
				origin: [0, this.nextPaletteIndex, 0],
				mipLevel: 0,
			},
			model.palette, {
			bytesPerRow: 256 * 4,
		}, [255, 1, 1]
		)
		model.paletteIndex = this.nextPaletteIndex++

		if (RENDER_MODE == 1)
		{
			const acceleration = this.generateAccelerationData(model.voxels, model.sizeX, model.sizeY, model.sizeZ)
			let regionSizeX = model.sizeX + 3 >> 2
			let regionSizeY = model.sizeY + 3 >> 2
			let regionSizeZ = model.sizeZ + 1 >> 1
			const accelerationTexture = this.device.createTexture({
				size: [regionSizeX, regionSizeY, regionSizeZ],
				dimension: '3d',
				format: 'r32uint',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			})

			this.device.queue.writeTexture(
				{ texture: accelerationTexture },
				acceleration,
				{
					bytesPerRow: regionSizeX * 4,
					rowsPerImage: regionSizeY,
				},
				{
					width: regionSizeX,
					height: regionSizeY,
					depthOrArrayLayers: regionSizeZ
				}
			)
			model.accelerationTexture = accelerationTexture
		}
	}


	/**
	 * @param {Tileset} tileset
	 */
	registerTileset(tileset)
	{
		const width = tileset.tileWidth
		const height = tileset.tileHeight
		const count = tileset.numTiles

		const texture = this.device.createTexture({
			size: [width, height, count],
			format: 'rgba8unorm',
			dimension: '2d',
			usage: GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT
		})

		this.device.queue.writeTexture(
			{ texture },
			tileset.imageData.data,
			{
				bytesPerRow: width * 4,
				rowsPerImage: height
			},
			[width, height, count]
		)
		tileset.texture = texture
	}

	/**
	 * 
	 * @param {Level} level 
	 */
	registerLevel(level)
	{
		const texture = this.device.createTexture({
			size: [level.sizeX, level.sizeY, level.sizeZ],
			dimension: '3d',
			format: 'r16uint',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		})
		this.device.queue.writeTexture(
			{ texture },
			new Uint8Array(level.voxels.buffer),
			{
				bytesPerRow: level.sizeX * 2,
				rowsPerImage: level.sizeY
			},
			[level.sizeX, level.sizeY, level.sizeZ]
		)

		level.texture = texture
	}

	createDepthTexture()
	{
		if (this.depthTexture)
		{
			this.depthTexture.destroy()
		}

		this.depthTexture = this.device.createTexture({
			size: [this.viewport[0], this.viewport[1], 1],
			format: 'depth24plus',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		})
	}

	async draw()
	{
		const commandEncoder = this.device.createCommandEncoder()
		const renderPass = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
			depthStencilAttachment: {
				view: this.depthTexture.createView(),
				depthClearValue: 1.0,
				depthLoadOp: 'clear',
				depthStoreOp: 'store',
			},
			timestampWrites: {
				querySet: this.querySet,
				beginningOfPassWriteIndex: 0,
				endOfPassWriteIndex: 1,
			}
		})

		this.device.queue.writeBuffer(this.frameUniforms, 0, /** @type {Float32Array} */(camera.projection))
		this.device.queue.writeBuffer(this.frameUniforms, 64, /** @type {Float32Array} */(camera.view))
		this.device.queue.writeBuffer(this.frameUniforms, 128, /** @type {Float32Array} */(camera.worldPosition))
		this.device.queue.writeBuffer(this.frameUniforms, 144, new Float32Array(this.viewport))

		this.objectUniformsOffset = 0

		const viewProjectionMatrix = mat4.create()
		mat4.multiply(viewProjectionMatrix, camera.projection, camera.view)
		//this.drawLevel(level, viewProjectionMatrix, renderPass)


		renderPass.setPipeline(this.modelPipeline)
		for (const e of Entity.all)
		{
			if (e.model && e !== player)
			{
				const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.sizeX / 2, -e.model.sizeY / 2, 0])
				const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.rotation, e.position, vec3.scale(vec3.create(), e.scale, 1 / 32))
				mat4.multiply(modelMatrix, modelMatrix, offsetMatrix)
				const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix)
				this.drawModel(e.model, modelViewProjectionMatrix, modelMatrix, renderPass)
			}
			e.animationFrame++
			if (e.animationFrame > 16)
			{
				if (e.model == models['fatta'])
				{
					e.model = models['fatta']
				} else if (e.model == models['fattb'])
				{
					e.model = models['fattc']
				} else if (e.model == models['fattc'])
				{
					e.model = models['fattd']
				} else if (e.model == models['fattd'])
				{
					e.model = models['fatta']
				}
				e.animationFrame = 0
			}
		}

		this.device.queue.writeBuffer(this.objectUniforms, 0, this.transferBuffer, 0, this.objectUniformsOffset)



		renderPass.end()
		commandEncoder.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0)
		if (this.queryResult.mapState === 'unmapped')
		{
			commandEncoder.copyBufferToBuffer(this.queryResolve, 0, this.queryResult, 0, this.queryResult.size)
		}

		this.device.queue.submit([commandEncoder.finish()])

		if (this.queryResult.mapState === 'unmapped')
		{
			await this.queryResult.mapAsync(GPUMapMode.READ)
			const queryData = new BigUint64Array(this.queryResult.getMappedRange())
			const delta = queryData[1] - queryData[0]
			this.queryResult.unmap()
			const frameTimeMs = Number(delta) / 1e6
			this.frameTimes.push(frameTimeMs)
			const now = performance.now()
			if (now - this.lastTimePrint >= 1000)
			{
				const sum = this.frameTimes.reduce((a, b) => a + b, 0)
				const avgFrameTime = sum / this.frameTimes.length
				console.log(`Average frame time over last ${this.frameTimes.length} frames: ${avgFrameTime.toFixed(7)} ms`)
				this.frameTimes.length = 0
				this.lastTimePrint = now
			}
		}

	}

	/**
	* @param {Level} level
	* @param {mat4} mvpMatrix
	* @param {GPURenderPassEncoder} renderPass
	* @returns {void}
	*/
	drawLevel(level, mvpMatrix, renderPass)
	{
		this.device.queue.writeBuffer(this.objectUniforms, this.objectUniformsOffset, /** @type {Float32Array} */(mat4.create()))
		this.device.queue.writeBuffer(this.objectUniforms, this.objectUniformsOffset + 64, /** @type {Float32Array} */(mvpMatrix))
		this.device.queue.writeBuffer(this.objectUniforms, this.objectUniformsOffset + 128, /** @type {Float32Array} */(camera.worldPosition))

		if (!level.bindGroup)
		{
			level.bindGroup = this.device.createBindGroup({
				layout: this.bindGroupLayout,
				entries: [
					{
						binding: 0,
						resource: {
							buffer: this.frameUniforms,
							size: 256,
						},
					},
					{
						binding: 1,
						resource: {
							buffer: this.objectUniforms,
							size: 256,
						}
					},
					{
						binding: 2,
						resource: level.texture.createView()
					},
					{
						binding: 3,
						resource: this.paletteTexture.createView()
					},
					{
						binding: 4,
						resource: tileset.texture.createView()
					},
					{
						binding: 5,
						resource: this.tileSampler
					}
				],
			})
		}

		renderPass.setPipeline(this.terrainPipeline)
		renderPass.setBindGroup(0, level.bindGroup, [this.objectUniformsOffset])

		switch (RENDER_MODE)
		{
			case 0:
				renderPass.draw(36, 1, 0, 0)
				break
			case 1: case 2:
				renderPass.setVertexBuffer(0, level.rasterBuffer)
				renderPass.draw(6, level.rasterBuffer.size / 4, 0, 0)
				break
		}
		this.objectUniformsOffset += 256
	}

	/**
	 * 
	 * @param {Model} model 
	 * @param {mat4} modelViewProjectionMatrix 
	 * @param {mat4} modelMatrix 
	 * @param {GPURenderPassEncoder} renderPass
	 */
	drawModel(model, modelViewProjectionMatrix, modelMatrix, renderPass)
	{
		let floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset)
		let uintView = new Uint32Array(this.transferBuffer, this.objectUniformsOffset)

		floatView.set(modelMatrix, 0)
		floatView.set(modelViewProjectionMatrix, 16)

		uintView[35] = model.paletteIndex

		if (!model.bindGroup)
		{
			/** @type {GPUBindGroupDescriptor} */const descriptor = {
				layout: this.bindGroupLayout,
				entries: [
					{
						binding: 0,
						resource: {
							buffer: this.frameUniforms,
							size: 256,
						},
					},
					{
						binding: 1,
						resource: {
							buffer: this.objectUniforms,
							size: 256,
						}
					},
					{
						binding: 2,
						resource: model.texture.createView()
					},
					{
						binding: 3,
						resource: this.paletteTexture.createView()
					},
					{
						binding: 4,
						resource: tileset.texture.createView()
					},
					{
						binding: 5,
						resource: this.tileSampler
					}
				],
			}
			if (RENDER_MODE === 1)
			{
				descriptor.entries = [...descriptor.entries, {
					binding: 6,
					resource: model.accelerationTexture.createView()
				}]
			}

			model.bindGroup = this.device.createBindGroup(descriptor)
		}

		renderPass.setBindGroup(0, model.bindGroup, [this.objectUniformsOffset])
		renderPass.draw(36, 1, 0, 0)

		this.objectUniformsOffset += 256
	}
}

const MessageType = {
	PLAYER_JOIN: 0,
	PLAYER_LEAVE: 1,
	CHAT: 2,
	ENTITY_UPDATE: 3,
}

class Net
{
	constructor()
	{
		this.peer = null
		this.connections = []
		this.isHost = false
	}

	host(id)
	{
		this.peer = new Peer(id)
		this.isHost = true

		this.peer.on('open', (id) =>
		{
			console.log('Host ID:', id)
		})

		this.peer.on('connection', (conn) =>
		{
			this.connections.push(conn)
			conn.on('open', () =>
			{
				conn.send('Hello!')
			})
			conn.on('data', (data) =>
			{
				this.onData(conn, data)
			})
		})
	}

	join(hostid)
	{
		this.isHost = false
		this.peer = new Peer()
		this.peer.on('open', (id) =>
		{
			console.log('Client ID:', id)
			const conn = this.peer.connect(hostid)
			conn.on('open', () =>
			{
				conn.send({ msg: MessageType.PLAYER_JOIN })
			})
			conn.on('data', (data) =>
			{
				this.onData(conn, data)
			})
		})
	}

	onData(conn, data)
	{
		switch (data.msg)
		{
			case MessageType.PLAYER_JOIN:
				console.log('Player joined')
				if (this.isHost)
				{
					for (const conn of this.connections)
					{
						conn.send(data)
					}
				}
				break
			case MessageType.PLAYER_LEAVE:
				break
			case MessageType.CHAT:
				break
			case MessageType.ENTITY_UPDATE:
				if (!this.isHost)
				{
					for (const e of Entity.all)
					{
						if (e.id === data.id)
						{
							e.position[0] = data.pos[0]
							e.position[1] = data.pos[1]
							e.position[2] = data.pos[2]
							e.rotation[0] = data.ori[0]
							e.rotation[1] = data.ori[1]
							e.rotation[2] = data.ori[2]
							e.rotation[3] = data.ori[3]
						}
					}
					break
				}
				break
		}
	}

	update()
	{
		if (!this.isHost)
		{
			return
		}

		for (const e of Entity.all)
		{
			if (e.id > 0)
			{
				for (const conn of this.connections)
				{
					conn.send({
						msg: MessageType.ENTITY_UPDATE,
						id: e.id,
						pos: [e.position[0], e.position[1], e.position[2]],
						ori: [e.rotation[0], e.rotation[1], e.rotation[2], e.rotation[3]]
					})
				}
			}
		}
	}
}

function setupUI()
{

	for (const button of document.getElementsByClassName('bind-button'))
	{
		button.textContent = settings.keybinds[button.id]
	}

	/** @type {HTMLInputElement} */
	(document.getElementById('invert-mouse')).checked = settings.invertMouse

	const menu = document.getElementById('main-menu')

	let activeBinding = null

	menu.addEventListener('keyup', (event) =>
	{
		event.stopPropagation()

		if (activeBinding)
		{
			event.preventDefault()
			activeBinding = null
		}
	})

	menu.addEventListener('keydown', (event) =>
	{
		event.stopPropagation()

		if (!activeBinding)
		{
			return
		}
		activeBinding.textContent = event.code
		activeBinding.classList.remove('listening')
		settings.keybinds[activeBinding.id] = event.code
		localStorage.setItem('gameSettings', JSON.stringify(settings))
	})

	menu.addEventListener('blur', (event) =>
	{
		if (activeBinding && event.target == activeBinding)
		{
			activeBinding.textContent = settings.keybinds[activeBinding.id]
			activeBinding.classList.remove('listening')
			activeBinding = null
		}
	}, true)


	menu.addEventListener('click', (event) =>
	{
		event.stopPropagation()

		const button = /** @type {HTMLButtonElement} */ (event.target)
		if (button.classList?.contains('bind-button'))
		{
			activeBinding = button
			activeBinding.classList.add('listening')
			activeBinding.textContent = 'Press a key...'
			return
		}

		if (button.id === 'close-menu')
		{
			showingMenu = false
			menu.hidden = true
			//document.body.requestPointerLock()
		}

		if (button.id === 'host')
		{
			net.isHost = true
			const hostId = /** @type {HTMLInputElement} */ (document.getElementById('hostid')).value
			net.host(hostId)
		}

		if (button.id === 'join')
		{
			const hostId = /** @type {HTMLInputElement} */ (document.getElementById('hostid')).value
			net.join(hostId)
		}
	})

	if (showingMenu)
	{
		menu.hidden = false
	}

	document.addEventListener('keydown', onKeydown)

	document.addEventListener('keyup', (event) =>
	{
		key_states.delete(event.code)
	})

	document.addEventListener('mousemove', (event) =>
	{
		if (document.pointerLockElement)
		{
			mouseMoveX += event.movementX
			mouseMoveY += event.movementY
		}
	})

	document.addEventListener('click', (event) =>
	{
		if (event.target instanceof HTMLButtonElement)
		{
			if (event.target.id === 'toggle-menu')
			{
				showingMenu = !showingMenu
				document.getElementById('main-menu').hidden = !showingMenu
				if (showingMenu)
				{
					document.exitPointerLock()
				} else
				{
					document.body.requestPointerLock()
				}
				return
			}
		}

		if (!document.pointerLockElement)
		{
			document.body.requestPointerLock()
		}
		if (showingMenu)
		{
			showingMenu = false
			menu.hidden = true
		}
	})

	document.addEventListener('visibilitychange', () =>
	{
		lastTime = performance.now()
	})

	document.addEventListener('contextmenu', (event) =>
	{
		event.preventDefault()
	})

	document.addEventListener('pointerlockchange', () =>
	{
		if (!key_states.has('`'))
		{
			key_states.clear()
		}
	})

	window.addEventListener('error', (event) =>
	{
		const debug = document.getElementById('debug')
		debug.innerHTML = `${event.error} at ${event.filename}:${event.lineno}<br>${debug.innerHTML}`

	})

	window.addEventListener('unhandledrejection', (event) =>
	{
		const debug = document.getElementById('debug')

		debug.innerHTML = `${event.reason}<br>${debug.innerHTML}`
	})

	timeLabel = document.createElement('div')
	timeLabel.style.position = 'fixed'
	timeLabel.style.top = '0px'
	timeLabel.style.color = 'white'
	document.body.appendChild(timeLabel)
}

function onKeydown(event)
{
	key_states.add(event.code)

	switch (event.code)
	{
		case 'Backquote': {
			showingMenu = !showingMenu
			document.getElementById('main-menu').hidden = !showingMenu
			if (showingMenu)
			{
				document.exitPointerLock()
			} else
			{
				document.body.requestPointerLock()
			}
			break
		}
		case 'Escape': {
			if (showingMenu)
			{
				showingMenu = false
				document.getElementById('main-menu').hidden = true
				setTimeout(() => document.body.requestPointerLock(), 150)
			}
			break
		}

		case settings.keybinds.godMode: {
			godMode = !godMode
			break
		}
		case settings.keybinds.respawn: {
			player.respawn()
			break
		}
		default:
			break
	}
}

function processInput(elapsed)
{
	const right = vec3.fromValues(1, 0, 0)
	vec3.transformQuat(right, right, player.rotation)

	const forward = vec3.fromValues(0, 1, 0)
	vec3.transformQuat(forward, forward, player.rotation)

	const up = vec3.fromValues(0, 0, 1)
	vec3.transformQuat(up, up, player.rotation)
	const speed = 10


	if (!godMode)
	{
		forward[2] = 0
		vec3.normalize(forward, forward)
		right[2] = 0
		vec3.normalize(right, right)
	} else
	{
		player.vel[2] = 0
	}

	player.vel[0] = 0
	player.vel[1] = 0

	if (key_states.has(settings.keybinds.forward))
	{
		vec3.scaleAndAdd(player.vel, player.vel, forward, speed)
	}
	if (key_states.has(settings.keybinds.backward))
	{
		vec3.scaleAndAdd(player.vel, player.vel, forward, -speed)
	}
	if (key_states.has(settings.keybinds.left))
	{
		vec3.scaleAndAdd(player.vel, player.vel, right, -speed)
	}
	if (key_states.has(settings.keybinds.right))
	{
		vec3.scaleAndAdd(player.vel, player.vel, right, speed)
	}
	if (godMode && key_states.has(settings.keybinds.up))
	{
		vec3.scaleAndAdd(player.vel, player.vel, up, speed)
	}
	if (godMode && key_states.has(settings.keybinds.down))
	{
		vec3.scaleAndAdd(player.vel, player.vel, up, -speed)
	}
	if (key_states.has(settings.keybinds.jump))
	{
		if (player.gravity && !godMode && player.onGround(level))
		{
			player.vel[2] += 5
		}
		key_states.delete(settings.keybinds.jump)
	}

	const dx = mouseMoveX
	const dy = settings.invertMouse ? -mouseMoveY : mouseMoveY

	quat.rotateZ(player.rotation, player.rotation, -dx * elapsed / 1000)
	quat.rotateX(player.head.rotation, player.head.rotation, dy * elapsed / 1000)


	const angle = quat.getAxisAngle(vec3.create(), player.head.rotation)
	if (angle > Math.PI / 2)
	{
		if (dy > 0)
		{
			quat.setAxisAngle(player.head.rotation, vec3.fromValues(1, 0, 0), Math.PI / 2)
		} else
		{
			quat.setAxisAngle(player.head.rotation, vec3.fromValues(1, 0, 0), -Math.PI / 2)
		}
	}

	player.dirty = true
	player.head.dirty = true

	mouseMoveX = 0
	mouseMoveY = 0
}

function loop()
{
	const elapsed = performance.now() - lastTime
	lastTime = performance.now()

	localStorage.setItem('gameState', JSON.stringify({
		playerPos: Array.from(player.position),
		playerOrientation: Array.from(player.rotation),
		playerHeadRotation: Array.from(player.head.rotation),
		showingMenu: showingMenu,
		godMode: godMode
	}))

	timeLabel.innerHTML = `<span style="color: #FFD700;">cam_pos: ${camera.worldPosition[0].toFixed(2)}, ${camera.worldPosition[1].toFixed(2)}, ${camera.worldPosition[2].toFixed(2)}
		${godMode ? '<span style="color: #FFD700;">{ God Mode }</span>' : ' { Peon Mode }'}`

	processInput(elapsed)

	for (const e of Entity.all)
	{
		e.update(elapsed)
		if (e.gravity && !(e instanceof Player && godMode))
		{
			if (!e.onGround(level))
			{
				e.vel[2] -= 9.8 * elapsed / 1000
			}
		}


		let speed = vec3.length(e.vel)
		vec3.scaleAndAdd(e.position, e.position, e.vel, elapsed / 1000)
		if (speed > 100)
		{
			speed = 100
			vec3.normalize(e.vel, e.vel)
			vec3.scale(e.vel, e.vel, speed)
		}
		if (speed > 0)
		{
			vec3.scaleAndAdd(e.position, e.position, e.vel, elapsed / 1000)
			e.dirty = true
		}

		if (e instanceof Player && !godMode)
		{
			for (const ee of Entity.all)
			{
				if (e == ee)
				{
					continue
				}
				if (ee instanceof Spawn)
				{
					continue
				}

				if (ee === e.head)
				{
					continue
				}
				const s = vec3.sub(vec3.create(), ee.position, e.position)
				const d = vec3.length(s)

				if (d < e.radius + ee.radius)
				{
					const pushback = e.radius + ee.radius - d
					const t = vec3.add(vec3.create(), s, e.vel)
					vec3.normalize(t, t)
					vec3.scaleAndAdd(e.position, e.position, t, -pushback)
					e.dirty = true
					if (e.radius >= ee.radius)
					{
						vec3.scaleAndAdd(ee.position, e.vel, t, pushback)
						ee.dirty = true
					}
				}
			}

			if (level.getVoxel(e.position[0] + e.radius, e.position[1], e.position[2] + e.height / 2))
			{
				e.position[0] = Math.floor(e.position[0] + e.radius) - e.radius
				e.dirty = true
			}
			if (level.getVoxel(e.position[0] - e.radius, e.position[1], e.position[2] + e.height / 2))
			{
				e.position[0] = Math.ceil(e.position[0] - e.radius) + e.radius
				e.dirty = true
			}
			if (level.getVoxel(e.position[0], e.position[1] + e.radius, e.position[2] + e.height / 2))
			{
				e.position[1] = Math.floor(e.position[1] + e.radius) - e.radius
				e.dirty = true
			}
			if (level.getVoxel(e.position[0], e.position[1] - e.radius, e.position[2] + e.height / 2))
			{
				e.position[1] = Math.ceil(e.position[1] - e.radius) + e.radius
				e.dirty = true
			}
			if (level.getVoxel(e.position[0], e.position[1], e.position[2] + e.height))
			{
				e.position[2] = Math.floor(e.position[2] + e.height) - e.height
				e.vel[2] = 0
				e.dirty = true
			}
			if (level.getVoxel(e.position[0], e.position[1], e.position[2]))
			{
				e.position[2] = Math.ceil(e.position[2])
				e.vel[2] = 0
				e.dirty = true
			}
		}
	}

	for (const e of Entity.all)
	{
		if (!e.parent) 
		{
			e.updateTransform(null)
		}
	}


	camera.update()
	for (let i = 0; i < 1; i++)
	{
		renderer.draw()
	}

	net.update()
	requestAnimationFrame(loop)
}

async function main()
{
	camera.parent = player.head
	player.head.children.push(camera)

	let savedState = localStorage.getItem('gameState')
	if (savedState)
	{
		const state = JSON.parse(savedState)
		player.position = vec3.fromValues(state.playerPos[0], state.playerPos[1], state.playerPos[2])
		player.rotation = quat.fromValues(state.playerOrientation[0], state.playerOrientation[1], state.playerOrientation[2], state.playerOrientation[3])
		player.head.rotation = state.playerHeadRotation
		godMode = state.godMode
		showingMenu = state.showingMenu
	}

	let savedSettings = localStorage.getItem('gameSettings')
	if (savedSettings)
	{
		let obj = JSON.parse(savedSettings)
		if (obj.version === settings.version)
		{
			settings = obj
		} else
		{
			localStorage.setItem('gameSettings', JSON.stringify(settings))
		}
	}

	setupUI()
	await renderer.init()

	await Promise.all([
		tileset.load(),
		level.load(),
		...Object.values(models).map((model) => model.load())
	])

	requestAnimationFrame(loop)
}

let lastTime = 0
let timeLabel

let settings = {
	version: 1,
	invertMouse: true,
	keybinds: {
		forward: 'KeyW',
		backward: 'KeyS',
		left: 'KeyA',
		right: 'KeyD',
		up: 'KeyE',
		down: 'KeyQ',
		jump: 'Space',
		respawn: 'KeyR',
		godMode: 'KeyG',
	}
}

const key_states = new Set()

let mouseMoveX = 0
let mouseMoveY = 0
let showingMenu = false
let godMode = true

const models = Object.fromEntries(
	[
		//'player',
		//'portal',
		'fatta',
		'fattb',
		'fattc',
		'fattd',
		//'maze',
		//'wall',
		'box_frame',
	].map((model) => [model, new Model(`/models/${model}.vox`)])
)

let tileset = new Tileset('/tilesets/dcss_tiles.tsj')
let level = new Level('/maps/test.tmj')
let player = new Player()

const renderer = new Renderer()
const camera = new Camera()
let net = new Net()

main()