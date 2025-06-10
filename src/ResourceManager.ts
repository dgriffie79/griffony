/**
 * Resource management framework for Griffony
 * Provides RAII-style resource management for GPU resources and other cleanup
 */

import { GPUError, errorHandler } from './ErrorHandler.js';

// Interface for resources that need cleanup
export interface IDisposable {
  dispose(): void;
}

// Resource types
export enum ResourceType {
  Buffer = 'buffer',
  Texture = 'texture',
  BindGroup = 'bindGroup',
  BindGroupLayout = 'bindGroupLayout',
  RenderPipeline = 'renderPipeline',
  ShaderModule = 'shaderModule',
  QuerySet = 'querySet',
  Sampler = 'sampler',
  Canvas = 'canvas',
  Other = 'other'
}

// Resource metadata
export interface ResourceMetadata {
  id: string;
  type: ResourceType;
  label?: string;
  size?: number;
  createdAt: number;
  lastUsed: number;
  permanent?: boolean; // If true, resource will not be automatically cleaned up
}

// Managed resource wrapper
export class ManagedResource<T> implements IDisposable {
  public readonly resource: T;
  public readonly metadata: ResourceMetadata;
  private _disposed: boolean = false;
  private readonly _disposeCallback?: () => void;

  constructor(
    resource: T,
    metadata: Omit<ResourceMetadata, 'createdAt' | 'lastUsed'>,
    disposeCallback?: () => void
  ) {
    this.resource = resource;
    this.metadata = {
      ...metadata,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };
    this._disposeCallback = disposeCallback;
  }

  public markUsed(): void {
    this.metadata.lastUsed = Date.now();
  }

  public markPermanent(): void {
    this.metadata.permanent = true;
  }

  public get disposed(): boolean {
    return this._disposed;
  }

  public dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;
    
    try {
      if (this._disposeCallback) {
        this._disposeCallback();
      } else {
        // Try to call destroy method if it exists
        const resourceWithDestroy = this.resource as any;
        if (typeof resourceWithDestroy.destroy === 'function') {
          resourceWithDestroy.destroy();
        }      }
      
      console.log(`Disposed ${this.metadata.type}: ${this.metadata.label || this.metadata.id}`);
    } catch (error) {
      console.error(`Failed to dispose ${this.metadata.type}: ${this.metadata.label || this.metadata.id}`, error);
    }
  }
}

// Resource manager for tracking and cleaning up resources
export class ResourceManager {
  private static instance: ResourceManager;
  private readonly resources = new Map<string, ManagedResource<any>>();
  private readonly resourcesByType = new Map<ResourceType, Set<string>>();

  public static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * Register a resource for management
   */
  public register<T>(
    resource: T,
    type: ResourceType,
    label?: string,
    size?: number,
    disposeCallback?: () => void
  ): ManagedResource<T> {
    const id = this.generateId();
    const metadata = {
      id,
      type,
      label,
      size
    };

    const managedResource = new ManagedResource(resource, metadata, disposeCallback);
    
    this.resources.set(id, managedResource);
    
    if (!this.resourcesByType.has(type)) {
      this.resourcesByType.set(type, new Set());
    }    this.resourcesByType.get(type)!.add(id);

    console.log(`Registered ${type}: ${label || id}${size ? ` (${size} bytes)` : ''}`);
    
    return managedResource;
  }

  /**
   * Unregister and dispose a resource
   */
  public dispose(resourceId: string): void {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return;
    }

    resource.dispose();
    this.resources.delete(resourceId);
    
    for (const [type, ids] of this.resourcesByType.entries()) {
      if (ids.has(resourceId)) {
        ids.delete(resourceId);
        break;
      }
    }
  }

  /**
   * Dispose all resources of a specific type
   */
  public disposeType(type: ResourceType): void {
    const ids = this.resourcesByType.get(type);
    if (!ids) {
      return;
    }

    for (const id of Array.from(ids)) {
      this.dispose(id);
    }
  }

  /**
   * Dispose all resources
   */
  public disposeAll(): void {
    const allIds = Array.from(this.resources.keys());
    for (const id of allIds) {
      this.dispose(id);
    }
  }

  /**
   * Get resource statistics
   */
  public getStats(): {
    totalResources: number;
    resourcesByType: Record<string, number>;
    totalMemoryUsage: number;
  } {
    const resourcesByType: Record<string, number> = {};
    let totalMemoryUsage = 0;

    for (const [type, ids] of this.resourcesByType.entries()) {
      resourcesByType[type] = ids.size;
    }

    for (const resource of this.resources.values()) {
      if (resource.metadata.size) {
        totalMemoryUsage += resource.metadata.size;
      }
    }

    return {
      totalResources: this.resources.size,
      resourcesByType,
      totalMemoryUsage
    };
  }
  /**
   * Cleanup unused resources (older than threshold)
   */
  public cleanupUnused(maxAgeMs: number = 300000): void { // 5 minutes default
    const now = Date.now();
    const toDispose: string[] = [];

    for (const [id, resource] of this.resources.entries()) {
      // Skip permanent resources and recently used resources
      if (!resource.metadata.permanent && now - resource.metadata.lastUsed > maxAgeMs) {
        toDispose.push(id);
      }    }

    console.log(`Cleaning up ${toDispose.length} unused resources`);
    
    for (const id of toDispose) {
      this.dispose(id);
    }
  }

  private generateId(): string {
    return `resource_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// GPU Resource Manager - specialized for WebGPU resources
export class GPUResourceManager {
  private static instance: GPUResourceManager;
  private readonly resourceManager = ResourceManager.getInstance();
  private device?: GPUDevice;
  private deviceLost: boolean = false;

  public static getInstance(): GPUResourceManager {
    if (!GPUResourceManager.instance) {
      GPUResourceManager.instance = new GPUResourceManager();
    }
    return GPUResourceManager.instance;
  }

  public setDevice(device: GPUDevice): void {
    this.device = device;
    this.deviceLost = false;
    
    // Track device loss state
    device.lost.then((info) => {
      this.deviceLost = true;
    });
  }

  /**
   * Get the current GPU device
   */
  public getDevice(): GPUDevice | undefined {
    return this.device;
  }

  /**
   * Check if the GPU device is available and valid
   */
  public isDeviceValid(): boolean {
    return this.device !== undefined && !this.deviceLost;
  }

  /**
   * Clear device reference (for device loss recovery)
   */
  public clearDevice(): void {
    this.device = undefined;
    this.deviceLost = false;
  }

  /**
   * Create and manage a GPU buffer
   */
  public createBuffer(descriptor: GPUBufferDescriptor & { label?: string }): ManagedResource<GPUBuffer> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createBuffer');
    }

    const buffer = this.device.createBuffer(descriptor);
    const size = descriptor.size;
    
    return this.resourceManager.register(
      buffer,
      ResourceType.Buffer,
      descriptor.label,
      size,
      () => buffer.destroy()
    );
  }

  /**
   * Create and manage a GPU texture
   */
  public createTexture(descriptor: GPUTextureDescriptor & { label?: string }): ManagedResource<GPUTexture> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createTexture');
    }

    const texture = this.device.createTexture(descriptor);
      // Calculate approximate texture size
    let width: number, height: number, depth: number;
    
    if (Array.isArray(descriptor.size)) {
      width = descriptor.size[0];
      height = descriptor.size[1] || 1;
      depth = descriptor.size[2] || 1;
    } else if (typeof descriptor.size === 'object' && descriptor.size !== null) {
      const size = descriptor.size as GPUExtent3DDict;
      width = size.width;
      height = size.height || 1;
      depth = size.depthOrArrayLayers || 1;
    } else {
      // Handle number case (width only)
      width = descriptor.size as number;
      height = 1;
      depth = 1;
    }
    const bytesPerPixel = this.getBytesPerPixel(descriptor.format);
    const estimatedSize = width * height * depth * bytesPerPixel * (descriptor.mipLevelCount || 1);
    
    return this.resourceManager.register(
      texture,
      ResourceType.Texture,
      descriptor.label,
      estimatedSize,
      () => texture.destroy()
    );
  }

  /**
   * Create and manage a bind group
   */
  public createBindGroup(descriptor: GPUBindGroupDescriptor & { label?: string }): ManagedResource<GPUBindGroup> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createBindGroup');
    }

    const bindGroup = this.device.createBindGroup(descriptor);
    
    return this.resourceManager.register(
      bindGroup,
      ResourceType.BindGroup,
      descriptor.label
    );
  }

  /**
   * Create and manage a bind group layout
   */
  public createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor & { label?: string }): ManagedResource<GPUBindGroupLayout> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createBindGroupLayout');
    }

    const layout = this.device.createBindGroupLayout(descriptor);
    
    return this.resourceManager.register(
      layout,
      ResourceType.BindGroupLayout,
      descriptor.label
    );
  }

  /**
   * Create and manage a render pipeline
   */
  public createRenderPipeline(descriptor: GPURenderPipelineDescriptor & { label?: string }): ManagedResource<GPURenderPipeline> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createRenderPipeline');
    }

    const pipeline = this.device.createRenderPipeline(descriptor);
    
    return this.resourceManager.register(
      pipeline,
      ResourceType.RenderPipeline,
      descriptor.label
    );
  }

  /**
   * Create and manage a shader module
   */
  public createShaderModule(descriptor: GPUShaderModuleDescriptor & { label?: string }): ManagedResource<GPUShaderModule> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createShaderModule');
    }

    const module = this.device.createShaderModule(descriptor);
    
    return this.resourceManager.register(
      module,
      ResourceType.ShaderModule,
      descriptor.label
    );
  }
  /**
   * Create and manage a query set
   */
  public createQuerySet(descriptor: GPUQuerySetDescriptor & { label?: string }): ManagedResource<GPUQuerySet> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createQuerySet');
    }

    const querySet = this.device.createQuerySet(descriptor);
    
    return this.resourceManager.register(
      querySet,
      ResourceType.QuerySet,
      descriptor.label,
      undefined,
      () => querySet.destroy()
    );
  }
  /**
   * Create and manage a GPU sampler
   */
  public createSampler(descriptor: GPUSamplerDescriptor & { label?: string }): ManagedResource<GPUSampler> {
    if (!this.device) {
      throw new GPUError('GPU device not initialized', 'createSampler');
    }

    const sampler = this.device.createSampler(descriptor);
    
    return this.resourceManager.register(
      sampler,
      ResourceType.Sampler,
      descriptor.label
    );
  }

  /**
   * Get approximate bytes per pixel for a texture format
   */
  private getBytesPerPixel(format: GPUTextureFormat): number {
    switch (format) {
      case 'r8unorm':
      case 'r8snorm':
      case 'r8uint':
      case 'r8sint':
        return 1;
      case 'r16uint':
      case 'r16sint':
      case 'r16float':
      case 'rg8unorm':
      case 'rg8snorm':
      case 'rg8uint':
      case 'rg8sint':
        return 2;
      case 'r32float':
      case 'r32uint':
      case 'r32sint':
      case 'rg16uint':
      case 'rg16sint':
      case 'rg16float':
      case 'rgba8unorm':
      case 'rgba8unorm-srgb':
      case 'rgba8snorm':
      case 'rgba8uint':
      case 'rgba8sint':
      case 'bgra8unorm':
      case 'bgra8unorm-srgb':
        return 4;
      case 'rg32float':
      case 'rg32uint':
      case 'rg32sint':
      case 'rgba16uint':
      case 'rgba16sint':
      case 'rgba16float':
        return 8;
      case 'rgba32float':
      case 'rgba32uint':
      case 'rgba32sint':
        return 16;
      default:
        return 4; // Default assumption
    }
  }
  /**
   * Cleanup all GPU resources
   */
  public cleanup(): void {
    this.resourceManager.disposeType(ResourceType.Buffer);
    this.resourceManager.disposeType(ResourceType.Texture);
    this.resourceManager.disposeType(ResourceType.BindGroup);
    this.resourceManager.disposeType(ResourceType.BindGroupLayout);
    this.resourceManager.disposeType(ResourceType.RenderPipeline);
    this.resourceManager.disposeType(ResourceType.ShaderModule);
    this.resourceManager.disposeType(ResourceType.QuerySet);
  }

  /**
   * Dispose a specific managed resource
   */
  public disposeResource<T>(managedResource: ManagedResource<T>): void {
    this.resourceManager.dispose(managedResource.metadata.id);
  }
}

// Automatic cleanup utility
export class AutoCleanup {
  private static readonly cleanupCallbacks: (() => void)[] = [];
  private static initialized = false;

  /**
   * Register a cleanup callback
   */
  public static register(callback: () => void): void {
    AutoCleanup.cleanupCallbacks.push(callback);
    
    if (!AutoCleanup.initialized) {
      AutoCleanup.initialize();
    }
  }

  /**
   * Initialize automatic cleanup on page unload
   */
  private static initialize(): void {
    if (AutoCleanup.initialized) {
      return;
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      AutoCleanup.cleanup();
    });

    // Cleanup on page visibility change (when user switches tabs)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // Cleanup unused resources when page becomes hidden
        ResourceManager.getInstance().cleanupUnused();
      }
    });

    // Periodic cleanup every 5 minutes
    setInterval(() => {
      ResourceManager.getInstance().cleanupUnused();
    }, 300000);

    AutoCleanup.initialized = true;
  }

  /**
   * Execute all cleanup callbacks
   */
  private static cleanup(): void {
    for (const callback of AutoCleanup.cleanupCallbacks) {
      try {      callback();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }
  }
}

// Export singleton instances for convenience
export const resourceManager = ResourceManager.getInstance();
export const gpuResourceManager = GPUResourceManager.getInstance();
