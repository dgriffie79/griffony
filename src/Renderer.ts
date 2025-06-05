import { mat4 } from 'gl-matrix';
import type { Model } from './Model';
import type { Tileset } from './Tileset';
import type { Level } from './Level';
import { greedyMesh } from './utils';

export class Renderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  viewport: [number, number] = [0, 0];
  
  shaders: Record<string, GPUShaderModule> = {};
  terrainPipeline!: GPURenderPipeline;
  modelPipeline!: GPURenderPipeline;
  bindGroupLayout!: GPUBindGroupLayout;
  depthTexture!: GPUTexture;
  
  frameTimes: number[] = [];
  lastTimePrint: number = 0;  querySet!: GPUQuerySet;
  queryResolve!: GPUBuffer;
  queryResult!: GPUBuffer;
  
  frameUniforms!: GPUBuffer;
  objectUniforms!: GPUBuffer;
  objectUniformsOffset: number = 0;
  paletteTexture!: GPUTexture;
  transferBuffer!: ArrayBuffer;
  floatView!: Float32Array;  uintView!: Uint32Array;
  nextPaletteIndex: number = 0;
  tileSampler!: GPUSampler;

  resourceMap = new Map<Model | Level, any>();

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No GPU adapter found');
    }
      this.device = await adapter.requestDevice({
      requiredFeatures: ['timestamp-query']
    });

    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    this.viewport = [canvas.width, canvas.height];
    
    this.context = canvas.getContext('webgpu')!;
    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });

    // Handle window resizing
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.viewport = [canvas.width, canvas.height];
      this.createDepthTexture();
      this.context.configure({
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'opaque',
      });
      
      // Update camera aspect ratio
      if (globalThis.camera) {
        globalThis.camera.aspect = this.viewport[0] / this.viewport[1];
        mat4.perspective(globalThis.camera.projection, globalThis.camera.fov, globalThis.camera.aspect, globalThis.camera.near, globalThis.camera.far);
      }
    });

    this.createDepthTexture();
    
    // Create buffers
    this.frameUniforms = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.objectUniforms = this.device.createBuffer({
      size: 256 * 100000,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.transferBuffer = new ArrayBuffer(256 * 100000);
    
    this.paletteTexture = this.device.createTexture({
      format: 'rgba8unorm',
      size: [256, 256, 1],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
      this.tileSampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    });

    this.frameTimes = [];
    this.lastTimePrint = performance.now();
    
    this.querySet = this.device.createQuerySet({
      type: "timestamp",
      count: 2,
    });
    
    this.queryResolve = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    
    this.queryResult = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    await this.compileShaders();
    const shader = this.shaders['quads']; // Always use quads shader
    this.createBindGroupLayout();
    this.createPipelines(shader);
  }

  async compileShaders(): Promise<void> {
    const sources = await this.loadShaderSources();
    const modules: Record<string, GPUShaderModule> = {};
    const results: Promise<void>[] = [];

    for (const name in sources) {
      const module = this.device.createShaderModule({
        label: name,
        code: sources[name],
      });
      results.push(module.getCompilationInfo().then(info => {
        for (const message of info.messages) {
          console.log(message);
        }
      }));
      modules[name] = module;
    }
    
    await Promise.all(results);
    console.log('All shader modules compiled');
    this.shaders = modules;
  }  async loadShaderSources(): Promise<Record<string, string>> {
    const shaders: Record<string, string> = {};
    const shaderModules = (import.meta as any).glob('./shaders/*.wgsl', { query: '?raw', import: 'default' });

    for (const path in shaderModules) {
      const name = path.split('/').pop()!.replace('.wgsl', '');
      shaders[name] = await shaderModules[path]() as string;
    }

    return shaders;
  }

  createBindGroupLayout(): void {
    const bindGroupDescriptor: GPUBindGroupLayoutDescriptor = {
      label: 'common',
      entries: [
        // frame uniforms
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        // object uniforms
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true }
        },
        // voxels
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'uint', viewDimension: '3d' }
        },
        // palette
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' }
        },
        // tiles
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' }
        },
        // tile sampler
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' }
        },      ]
    };

    this.bindGroupLayout = this.device.createBindGroupLayout(bindGroupDescriptor);
  }
  createPipelines(shader: GPUShaderModule): void {
    const terrainPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: 'terrain-cubes',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 4,
          stepMode: 'instance',
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: 'uint8x4'
          }]
        }]
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_textured',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: this.depthTexture.format,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    };
    
    const modelPipelineDescriptor: GPURenderPipelineDescriptor = {
      label: 'model-cubes',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      }),
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 4,
          stepMode: 'instance',
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: 'uint8x4'
          }]
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_model',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: this.depthTexture.format,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    };

    this.terrainPipeline = this.device.createRenderPipeline(terrainPipelineDescriptor!);
    this.modelPipeline = this.device.createRenderPipeline(modelPipelineDescriptor!);
  }

  registerModel(model: Model): void {
    const volume = model.volume;
    const resources = this.resourceMap.get(model) || {};

    resources.texture = this.device.createTexture({
      size: [volume.sizeX, volume.sizeY, volume.sizeZ],
      dimension: '3d',
      format: 'r8uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      mipLevelCount: 1,
    });
    
    this.device.queue.writeTexture(
      { texture: resources.texture, mipLevel: 0 },
      volume.voxels,
      {
        bytesPerRow: volume.sizeX,
        rowsPerImage: volume.sizeY
      },
      [volume.sizeX, volume.sizeY, volume.sizeZ]
    );    this.device.queue.writeTexture(
      {
        texture: this.paletteTexture,
        aspect: 'all',
        origin: [0, this.nextPaletteIndex, 0],
        mipLevel: 0,
      },
      model.palette!,
      { bytesPerRow: 256 * 4 },
      [255, 1, 1]
    );
    resources.paletteIndex = this.nextPaletteIndex++;

    if (model.url.includes('box_frame')) {
      greedyMesh(volume.voxels, volume.sizeX, volume.sizeY, volume.sizeZ, volume.emptyValue);
    }    // Generate faces for quad rendering
      const faces = model.volume.generateFaces();
      resources.rasterBuffer = this.device.createBuffer({
        size: faces.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(resources.rasterBuffer, 0, faces);

    this.resourceMap.set(model, resources);
  }

    // Removed generateAccelerationData method as it's no longer needed

  registerTileset(tileset: Tileset): void {
    const width = tileset.tileWidth;
    const height = tileset.tileHeight;
    const count = tileset.numTiles;

    const texture = this.device.createTexture({
      size: [width, height, count],
      format: 'rgba8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    this.device.queue.writeTexture(
      { texture },
      tileset.imageData!.data,
      {
        bytesPerRow: width * 4,
        rowsPerImage: height
      },
      [width, height, count]
    );
    tileset.texture = texture;
  }

  registerLevel(level: Level): void {
    const volume = level.volume;
    const resources = this.resourceMap.get(level) || {};
    
    resources.texture = this.device.createTexture({
      size: [volume.sizeX, volume.sizeY, volume.sizeZ],
      dimension: '3d',
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
      this.device.queue.writeTexture(
      { texture: resources.texture },
      volume.voxels,
      {
        bytesPerRow: volume.sizeX * 2,
        rowsPerImage: volume.sizeY
      },
      [volume.sizeX, volume.sizeY, volume.sizeZ]
    );    // Generate faces for quad rendering
      const faces = volume.generateFaces();
      resources.rasterBuffer = this.device.createBuffer({
        size: faces.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(resources.rasterBuffer, 0, faces);

    this.resourceMap.set(level, resources);
  }

  createDepthTexture(): void {
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      size: [this.viewport[0], this.viewport[1], 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  async draw(): Promise<void> {
    const commandEncoder = this.device.createCommandEncoder();
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
    });    const camera = globalThis.camera;
    this.device.queue.writeBuffer(this.frameUniforms, 0, camera.projection as Float32Array);
    this.device.queue.writeBuffer(this.frameUniforms, 64, camera.view as Float32Array);
    if (camera.entity) {
      this.device.queue.writeBuffer(this.frameUniforms, 128, camera.entity.worldPosition as Float32Array);
    }
    this.device.queue.writeBuffer(this.frameUniforms, 144, new Float32Array(this.viewport));

    this.objectUniformsOffset = 0;

    const viewProjectionMatrix = mat4.create();
    mat4.multiply(viewProjectionMatrix, camera.projection, camera.view);
    this.drawLevel(globalThis.level, viewProjectionMatrix, renderPass);

    renderPass.setPipeline(this.modelPipeline);
    const player = globalThis.player;
    for (const e of globalThis.Entity.all) {
      if (e.model && e !== player) {
        const offsetMatrix = mat4.fromTranslation(mat4.create(), [-e.model.volume.sizeX / 2, -e.model.volume.sizeY / 2, 0]);
        const modelMatrix = mat4.fromRotationTranslationScale(mat4.create(), e.localRotation, e.localPosition, [1/32, 1/32, 1/32]);
        mat4.multiply(modelMatrix, modelMatrix, offsetMatrix);
        const modelViewProjectionMatrix = mat4.multiply(mat4.create(), viewProjectionMatrix, modelMatrix);
        this.drawModel(e.model, modelViewProjectionMatrix, modelMatrix, renderPass);
      }
        e.animationFrame++;
      if (e.animationFrame > 16) {
        const models = globalThis.models;
        if (e.model === models['fatta']) {
          e.model = models['fattb'];
        } else if (e.model === models['fattb']) {
          e.model = models['fattc'];
        } else if (e.model === models['fattc']) {
          e.model = models['fattd'];
        } else if (e.model === models['fattd']) {
          e.model = models['fatta'];
        }
        e.animationFrame = 0;
      }
    }

    this.device.queue.writeBuffer(this.objectUniforms, 0, this.transferBuffer, 0, this.objectUniformsOffset);

    renderPass.end();
    commandEncoder.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0);
    if (this.queryResult.mapState === 'unmapped') {
      commandEncoder.copyBufferToBuffer(this.queryResolve, 0, this.queryResult, 0, this.queryResult.size);
    }

    this.device.queue.submit([commandEncoder.finish()]);

    if (this.queryResult.mapState === 'unmapped') {
      await this.queryResult.mapAsync(GPUMapMode.READ);
      const queryData = new BigUint64Array(this.queryResult.getMappedRange());
      const delta = queryData[1] - queryData[0];
      this.queryResult.unmap();
      const frameTimeMs = Number(delta) / 1e6;
      this.frameTimes.push(frameTimeMs);
      const now = performance.now();
      if (now - this.lastTimePrint >= 1000) {
        const sum = this.frameTimes.reduce((a, b) => a + b, 0);
        const avgFrameTime = sum / this.frameTimes.length;
        console.log(`Average frame time over last ${this.frameTimes.length} frames: ${avgFrameTime.toFixed(7)} ms`);
        this.frameTimes.length = 0;
        this.lastTimePrint = now;
      }
    }
  }

  drawLevel(level: Level, modelViewProjectionMatrix: mat4, renderPass: GPURenderPassEncoder): void {
    const resources = this.resourceMap.get(level);
    const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset);
    floatView.set(modelViewProjectionMatrix, 0);
    floatView.set(modelViewProjectionMatrix, 16);    if (!resources.bindGroup) {
      resources.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.frameUniforms, size: 256 }
          },
          {
            binding: 1,
            resource: { buffer: this.objectUniforms, size: 256 }
          },
          {
            binding: 2,
            resource: resources.texture.createView()
          },
          {
            binding: 3,
            resource: this.paletteTexture.createView()
          },
          {
            binding: 4,
            resource: globalThis.tileset.texture!.createView()
          },
          {
            binding: 5,
            resource: this.tileSampler
          }
        ],
      });
    }

    renderPass.setPipeline(this.terrainPipeline);
    renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset]);
    
    renderPass.setVertexBuffer(0, resources.rasterBuffer);
    renderPass.draw(6, resources.rasterBuffer.size / 4, 0, 0);
    this.objectUniformsOffset += 256;
  }

  drawModel(model: Model, modelViewProjectionMatrix: mat4, modelMatrix: mat4, renderPass: GPURenderPassEncoder): void {
    const resources = this.resourceMap.get(model);
    const floatView = new Float32Array(this.transferBuffer, this.objectUniformsOffset);
    const uintView = new Uint32Array(this.transferBuffer, this.objectUniformsOffset);

    floatView.set(modelMatrix, 0);
    floatView.set(modelViewProjectionMatrix, 16);
    uintView[35] = resources.paletteIndex;    if (!resources.bindGroup) {
      const descriptor: GPUBindGroupDescriptor = {
        label: 'model',
        layout: this.bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.frameUniforms, size: 256 }
          },
          {
            binding: 1,
            resource: { buffer: this.objectUniforms, size: 256 }
          },
          {
            binding: 2,
            resource: resources.texture.createView()
          },
          {
            binding: 3,
            resource: this.paletteTexture.createView()
          },
          {
            binding: 4,
            resource: globalThis.tileset.texture!.createView()
          },
          {
            binding: 5,
            resource: this.tileSampler
          }
        ],
      };

      resources.bindGroup = this.device.createBindGroup(descriptor);
    }

    renderPass.setBindGroup(0, resources.bindGroup, [this.objectUniformsOffset]);
    
    renderPass.setVertexBuffer(0, resources.rasterBuffer);
    renderPass.draw(6, resources.rasterBuffer.size / 4, 0, 0);

    this.objectUniformsOffset += 256;
  }
}
