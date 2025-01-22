import { mat4, quat, vec3 } from 'gl-matrix'
import { Peer } from 'peerjs'


// @ts-ignore
import SHADER0 from './shaders/march.wgsl?raw'
// @ts-ignore
import SHADER1 from './shaders/raster.wgsl?raw'

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

		for (const child of this.children)
		{
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
	projectionMatrix = mat4.create()
	worldInverseMatrix = mat4.create()

	updateWorldMatrix()
	{
		mat4.fromRotationTranslation(this.worldTransform, this.rotation, this.position)
	}

	updateWorldInverseMatrix()
	{
		mat4.invert(this.worldInverseMatrix, this.worldTransform)
	}

	updateProjectionMatrix()
	{
		this.aspect = renderer.viewport[0] / renderer.viewport[1]
		mat4.perspective(this.projectionMatrix, Math.PI / 3, this.aspect, .1, 1000)
		mat4.rotateX(this.projectionMatrix, this.projectionMatrix, -Math.PI / 2)
	}

	update()
	{
		mat4.invert(this.worldInverseMatrix, this.worldTransform)
		this.updateProjectionMatrix()
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
	paletteBuffer = null
	texture = null
	/** @type {GPUBuffer} */ rasterBuffer = null

	constructor(url = '')
	{
		this.url = url
	}

	generateFaces()
	{
		const maxFaces = 4 * (
			this.sizeX * this.sizeY * this.sizeZ
		)

		const faces = new Uint8Array(maxFaces * 6)
		let faceCount = 0
		const sx = this.sizeX
		const sy = this.sizeY
		const sz = this.sizeZ

		for (let x = 0; x < sx; x++)
		{
			for (let y = 0; y < sy; y++)
			{
				for (let z = 0; z < sz; z++)
				{
					const idx = z * sy * sx + y * sx + x

					if (this.voxels[idx] === 255) continue

					// Check -X face
					if (x === 0 || this.voxels[z * sy * sx + y * sx + (x - 1)] === 255)
					{
						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 0
						faceCount++
					}
					// Check +X face
					if (x === sx - 1 || this.voxels[z * sy * sx + y * sx + (x + 1)] === 255)
					{
						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 1
						faceCount++
					}
					// Check -Y face
					if (y === 0 || this.voxels[z * sy * sx + (y - 1) * sx + x] === 255)
					{
						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 2
						faceCount++
					}
					// Check +Y face
					if (y === sy - 1 || this.voxels[z * sy * sx + (y + 1) * sx + x] === 255)
					{

						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 3
						faceCount++
					}
					// Check -Z face
					if (z === 0 || this.voxels[(z - 1) * sy * sx + y * sx + x] === 255)
					{

						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 4
						faceCount++
					}
					// Check +Z face
					if (z === sz - 1 || this.voxels[(z + 1) * sy * sx + y * sx + x] === 255)
					{

						faces[faceCount * 4 + 0] = x
						faces[faceCount * 4 + 1] = y
						faces[faceCount * 4 + 2] = z
						faces[faceCount * 4 + 3] = 5
						faceCount++
					}
				}
			}
		}

		this.faces = faces.subarray(0, faceCount * 4)
		this.faceCount = faceCount
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

		this.palette = new Uint8Array(dataView.buffer, 12 + numVoxels, 256 * 3).slice()
		for (let i = 0; i < this.palette.length; i++)
		{
			this.palette[i] = this.palette[i] << 2
		}

		this.generateFaces()
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

		data.layers.forEach((layer) =>
		{
			if (layer.type === 'tilelayer')
			{
				let layerIndex

				switch (layer.name)
				{
					case 'Floor':
						layerIndex = 0
						break
					case 'Walls':
						layerIndex = 1
						break
					case 'Ceiling':
						layerIndex = 2
						break
					default:
						console.log(`Unknown tilelayer name: ${layer.name}`)
						return
				}

				layer.data.forEach((value, index) =>
				{
					const x = index % this.sizeX
					const y = this.sizeY - Math.floor(index / this.sizeX) - 1
					const z = layerIndex
					const voxelIndex = z * this.sizeX * this.sizeY + y * this.sizeX + x
					this.voxels[voxelIndex] = value
				})

			} else if (layer.type === 'objectgroup')
			{
				for (const object of layer.objects)
				{
					const entity = Entity.deserialize(object)
					entity.position[1] = this.sizeY - entity.position[1]
					if (entity != null)
					{
						Entity.all.push(entity)
					}
				}
			}
		})

		renderer.registerLevel(this)
	}
}

class Renderer
{
    /** @type {GPUDevice} */ device = null;
    /** @type {GPUCanvasContext} */ context = null;
    /** @type {number[]} */ viewport = [0, 0];
    /** @type {GPUBindGroupLayout} */ bindGroupLayout = null;
    /** @type {GPUBindGroupLayout} */ modelBindGroupLayout = null;
    /** @type {GPUBindGroupLayout} */ rasterBindGroupLayout = null;
    /** @type {GPURenderPipeline} */ terrainPipeline = null;
    /** @type {GPURenderPipeline} */ modelPipeline = null;
    /** @type {GPURenderPipeline} */ rasterPipeline = null;
    /** @type {GPUBuffer} */ dummyPaletteBuffer = null;
    /** @type {number} */ uniformBufferOffset = 0;
    /** @type {GPUTexture} */ depthTexture = null;
    /** @type {GPUBuffer} */ uniformBuffer = null;
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
		info.messages.forEach((message) =>
		{
			console.log(message)
		})
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

		this.device = await adapter.requestDevice()

		const canvas = document.createElement('canvas')
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
		this.viewport = [canvas.width, canvas.height]
		document.body.appendChild(canvas)

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

		this.uniformBuffer = this.device.createBuffer({
			size: (256) * 100,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})
		this.uniformBufferOffset = 0

		this.dummyPaletteBuffer = this.device.createBuffer({
			size: 48 * 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		})
		const dummyPalette = new Uint8Array(this.dummyPaletteBuffer.getMappedRange())
		for (let i = 0; i < 48 * 16; i++)
		{
			dummyPalette[i] = 0
		}
		this.dummyPaletteBuffer.unmap()

		this.tileSampler = this.device.createSampler({
			magFilter: 'nearest',
			minFilter: 'nearest',
			addressModeU: 'repeat',
			addressModeV: 'repeat',
			addressModeW: 'repeat',
		})

		const raymarch = await this.compileShader(SHADER0)
		const rasterShaderModule = await this.compileShader(SHADER1)

		this.bindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
						minBindingSize: 256,
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'float',
						viewDimension: '2d-array',
					}
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: {
						type: 'non-filtering',
					}
				},
			]
		})

		this.terrainBindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'uint',
						viewDimension: '3d',
					}
				},
			]
		})

		this.terrainPipeline = this.device.createRenderPipeline({
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.bindGroupLayout, this.terrainBindGroupLayout]
			}),
			vertex: {
				module: raymarch,
				entryPoint: 'vs_main',
			},
			fragment: {
				module: raymarch,
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
		})

		this.modelBindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'uint',
						viewDimension: '3d',
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
					}
				},
			],
		})

		this.modelPipeline = await this.device.createRenderPipelineAsync({
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.bindGroupLayout, this.modelBindGroupLayout]
			}),
			vertex: {
				module: raymarch,
				entryPoint: 'vs_main',
			},
			fragment: {
				module: raymarch,
				entryPoint: 'fs_model',
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
		})


		this.rasterBindGroupLayout = this.device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: 'uint',
						viewDimension: '3d',
					}
				},
				{
					binding: 1,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: {
						type: 'uniform',
					}
				}
			]
		})

		this.rasterPipeline = await this.device.createRenderPipelineAsync({
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.bindGroupLayout, this.rasterBindGroupLayout]
			}),
			vertex: {
				module: raymarch,
				entryPoint: 'vs_raster',
				buffers: [
					{
						arrayStride: 4,
						stepMode: 'instance',
						attributes: [
							{
								shaderLocation: 0,
								offset: 0,
								format: 'uint8x4',
							},
						]
					}
				]
			},
			fragment: {
				module: raymarch,
				entryPoint: 'fs_raster',
				targets: [
					{
						format: navigator.gpu.getPreferredCanvasFormat(),
					}
				],
			},
			primitive: {
				topology: 'triangle-list',
				cullMode: 'back',
				frontFace: 'ccw',
			},
			depthStencil: {
				format: 'depth24plus',
				depthWriteEnabled: true,
				depthCompare: 'less',
			},
		})



		this.createDepthTexture()
	}
	/*
		createRasterModelPipeline()
		{
			const bindgroupLayout0 = this.device.createBindGroupLayout({
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						buffer: {
							type: 'uniform',
						}
					},
					{
						binding: 1,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						texture: {
							sampleType: 'float',
							viewDimension: '2d-array',
						}
					},
					{
						binding: 2,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						sampler: {
							type: 'non-filtering',
						}
					}
				]
			})
	
			const bindgroupLayout1 = this.device.createBindGroupLayout({
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						texture: {
							sampleType: 'uint',
							viewDimension: '3d',
						}
					},
					{
						binding: 1,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						buffer: {
							type: 'uniform',
						}
					}
				]
			})
	
			const pipeline = this.device.createRenderPipeline({
				layout: this.device.createPipelineLayout({
					bindGroupLayouts: [bindgroupLayout0, bindgroupLayout1]
				}),
				vertex: {
					module: raymarch,
					entryPoint: 'vs_raster',
					buffers: [
						{
							arrayStride: 4,
							stepMode: 'instance',
							attributes: [
								{
									shaderLocation: 0,
									offset: 0,
									format: 'uint8x4',
								},
							]
						}
					]
				},
				fragment: {
					module: raymarch,
					entryPoint: 'fs_raster',
					targets: [
						{
							format: navigator.gpu.getPreferredCanvasFormat(),
						}
					],
				},
				primitive: {
					topology: 'triangle-list',
					cullMode: 'back',
					frontFace: 'ccw',
				},
				depthStencil: {
					format: 'depth24plus',
					depthWriteEnabled: true,
					depthCompare: 'less',
				},
			})
		}
	*/
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
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		})
		this.device.queue.writeTexture(
			{ texture },
			model.voxels,
			{
				bytesPerRow: model.sizeX,
				rowsPerImage: model.sizeY
			},
			[model.sizeX, model.sizeY, model.sizeZ]
		)
		model.texture = texture

		const paletteBuffer = this.device.createBuffer({
			size: model.palette.length,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		})

		this.device.queue.writeBuffer(paletteBuffer, 0, model.palette.buffer)
		model.paletteBuffer = paletteBuffer


		if (model.faces)
		{
			const rasterBuffer = this.device.createBuffer({
				size: model.faceCount * 4,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			})

			this.device.queue.writeBuffer(rasterBuffer, 0, model.faces)
			model.rasterBuffer = rasterBuffer
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

	/**
	 * 
	 * @param {Model} model 
	 * @param {mat4} modelViewProjectionMatrix 
	 * @param {mat4} modelMatrix 
	 * @param {GPURenderPassEncoder} renderPass
	 */
	drawModel(model, modelViewProjectionMatrix, modelMatrix, renderPass)
	{
		let cameraObjectPosition = vec3.transformMat4(vec3.create(), camera.worldPosition, mat4.invert(mat4.create(), modelMatrix))

		this.device.queue.writeBuffer(
			this.uniformBuffer,
			this.uniformBufferOffset,
			new Float32Array([
				...modelViewProjectionMatrix,
				...modelMatrix,
				...camera.worldPosition, 0.0,
				...cameraObjectPosition,
			])
		)

		const bindGroup0 = this.device.createBindGroup({
			layout: this.bindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: {
						buffer: this.uniformBuffer,
						offset: this.uniformBufferOffset,
						size: 256,
					}
				},
				{
					binding: 1,
					resource: tileset.texture.createView()
				},
				{
					binding: 2,
					resource: this.tileSampler
				},
			]
		})

		const bindGroup1 = this.device.createBindGroup({
			layout: this.modelBindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: model.texture.createView()
				},
				{
					binding: 1,
					resource: {
						buffer: model.paletteBuffer,
					}
				},
			]
		})

		renderPass.setPipeline(this.modelPipeline)
		renderPass.setBindGroup(0, bindGroup0)
		renderPass.setBindGroup(1, bindGroup1)
		renderPass.draw(36, 1, 0, 0)
		this.uniformBufferOffset += 256
	}


	/**
	 * 
	 * @param {Model} model 
	 * @param {*} modelViewProjectionMatrix 
	 * @param {*} modelMatrix 
	 * @param {GPURenderPassEncoder} renderPass 
	 */
	drawModelRaster(model, modelViewProjectionMatrix, modelMatrix, renderPass)
	{
		this.device.queue.writeBuffer(
			this.uniformBuffer,
			this.uniformBufferOffset,
			new Float32Array([
				...modelViewProjectionMatrix,
				...modelMatrix,
				...camera.worldPosition, 0.0,
				...camera.worldPosition, 0.0,
			])
		)

		const bindGroup0 = this.device.createBindGroup({
			layout: this.bindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: {
						buffer: this.uniformBuffer,
						offset: this.uniformBufferOffset,
						size: 256,
					}
				},
				{
					binding: 1,
					resource: tileset.texture.createView()
				},
				{
					binding: 2,
					resource: this.tileSampler
				},
			]
		})

		const bindGroup1 = this.device.createBindGroup({
			layout: this.rasterBindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: model.texture.createView()
				},
				{
					binding: 1,
					resource: {
						buffer: model.paletteBuffer,
					}
				},
			]
		})


		renderPass.setPipeline(this.rasterPipeline)
		renderPass.setBindGroup(0, bindGroup0)
		renderPass.setBindGroup(1, bindGroup1)
		renderPass.setVertexBuffer(0, model.rasterBuffer)
		renderPass.draw(6, model.faceCount, 0, 0)
		this.uniformBufferOffset += 256
	}


	/**
	 * @param {Level} level
	 * @param {mat4} mvpMatrix
	 * @param {GPURenderPassEncoder} renderPass
	 * @returns {void}
	 */
	drawLevel(level, mvpMatrix, renderPass)
	{
		this.device.queue.writeBuffer(
			this.uniformBuffer,
			this.uniformBufferOffset,
			new Float32Array([
				...mvpMatrix,
				...mat4.create(),
				...camera.worldPosition, 0.0,
				...camera.worldPosition, 0.0,
			])
		)
		const bindGroup0 = this.device.createBindGroup({
			layout: this.bindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: {
						buffer: this.uniformBuffer,
						offset: this.uniformBufferOffset,
						size: 256,
					}
				},
				{
					binding: 1,
					resource: tileset.texture.createView()
				},
				{
					binding: 2,
					resource: this.tileSampler
				},
			]
		})

		const bindgroup1 = this.device.createBindGroup({
			layout: this.terrainBindGroupLayout,
			entries: [
				{
					binding: 0,
					resource: level.texture.createView()
				},
			]
		})

		renderPass.setPipeline(this.terrainPipeline)
		renderPass.setBindGroup(0, bindGroup0)
		renderPass.setBindGroup(1, bindgroup1)
		renderPass.draw(36, 1, 0, 0)
		this.uniformBufferOffset += 256
	}

	draw()
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
		})
		this.uniformBufferOffset = 0
		const viewProjectionMatrix = mat4.create()
		mat4.multiply(viewProjectionMatrix, camera.projectionMatrix, camera.worldInverseMatrix)
		this.drawLevel(level, viewProjectionMatrix, renderPass)

		for (const e of Entity.all)
		{
			if (e.model && e !== player)
			{
				const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.sizeX / 2, -e.model.sizeY / 2, 0])
				const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.rotation, e.position, vec3.scale(vec3.create(), e.scale, 1 / 32))
				mat4.multiply(modelMatrix, modelMatrix, offsetMatrix)
				const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix)
				this.drawModelRaster(e.model, modelViewProjectionMatrix, modelMatrix, renderPass)
			}
			e.animationFrame++
			if (e.animationFrame > 16)
			{
				if (e.model == models['fatta'])
				{
					e.model = models['fattb']
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

		renderPass.end()
		this.device.queue.submit([commandEncoder.finish()])
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


function respawn()
{
	vec3.zero(player.position)
	vec3.zero(player.vel)
	quat.identity(player.rotation)
	quat.identity(player.head.rotation)

	for (const e of Entity.all)
	{
		if (e instanceof Spawn)
		{
			vec3.copy(player.position, e.position)
			quat.copy(player.rotation, e.rotation)
			break
		}
	}
}

function setupUI()
{

	Array.from(document.getElementsByClassName('bind-button')).forEach((button) =>
	{
		button.textContent = settings.keybinds[button.id]
	});

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
			respawn()
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

		if (vec3.length(e.vel) > 100)
		{
			vec3.normalize(e.vel, e.vel)
			vec3.scale(e.vel, e.vel, Math.min(vec3.length(e.vel), 100))
		}
		vec3.scaleAndAdd(e.position, e.position, e.vel, elapsed / 1000)

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
					if (e.radius >= ee.radius)
					{
						vec3.scaleAndAdd(ee.position, e.vel, t, pushback)
					}
				}

			}

			if (level.getVoxel(e.position[0] + e.radius, e.position[1], e.position[2] + e.height / 2))
			{
				e.position[0] = Math.floor(e.position[0] + e.radius) - e.radius
			}
			if (level.getVoxel(e.position[0] - e.radius, e.position[1], e.position[2] + e.height / 2))
			{
				e.position[0] = Math.ceil(e.position[0] - e.radius) + e.radius
			}
			if (level.getVoxel(e.position[0], e.position[1] + e.radius, e.position[2] + e.height / 2))
			{
				e.position[1] = Math.floor(e.position[1] + e.radius) - e.radius
			}
			if (level.getVoxel(e.position[0], e.position[1] - e.radius, e.position[2] + e.height / 2))
			{
				e.position[1] = Math.ceil(e.position[1] - e.radius) + e.radius
			}
			if (level.getVoxel(e.position[0], e.position[1], e.position[2] + e.height))
			{
				e.position[2] = Math.floor(e.position[2] + e.height) - e.height
				e.vel[2] = 0
			}
			if (level.getVoxel(e.position[0], e.position[1], e.position[2]))
			{
				e.position[2] = Math.ceil(e.position[2])
				e.vel[2] = 0
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
	renderer.draw()
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
		'player',
		'portal',
		'fatta',
		'fattb',
		'fattc',
		'fattd',
		'maze',
		'wall',
	].map((model) => [model, new Model(`/models/${model}.vox`)])
)

let tileset = new Tileset('/tilesets/dcss_tiles.tsj')
let level = new Level('/maps/test.tmj')
let player = new Player()

const renderer = new Renderer()
const camera = new Camera()
let net = new Net()

main()