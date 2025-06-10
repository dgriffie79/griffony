/**
 * Error handling framework for Griffony
 * Provides standardized error types and handling patterns
 */

// Base error class for all Griffony errors
export class GriffonyError extends Error {
  public readonly timestamp: number;
  public readonly code: string;
  public readonly category: string;

  constructor(message: string, code: string, category: string) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = Date.now();
    this.code = code;
    this.category = category;
      // Maintain proper stack trace for where our error was thrown (only available on V8)
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

// Network-related errors
export class NetworkError extends GriffonyError {
  public readonly url: string;
  public readonly status?: number;

  constructor(message: string, url: string, status?: number) {
    super(message, 'NETWORK_ERROR', 'NETWORK');
    this.url = url;
    this.status = status;
  }
}

// Resource loading errors
export class ResourceLoadError extends GriffonyError {
  public readonly resourceType: string;
  public readonly resourceUrl: string;

  constructor(message: string, resourceType: string, resourceUrl: string) {
    super(message, 'RESOURCE_LOAD_ERROR', 'RESOURCE');
    this.resourceType = resourceType;
    this.resourceUrl = resourceUrl;
  }
}

// GPU/WebGPU errors
export class GPUError extends GriffonyError {
  public readonly gpuOperation: string;

  constructor(message: string, gpuOperation: string) {
    super(message, 'GPU_ERROR', 'GPU');
    this.gpuOperation = gpuOperation;
  }
}

// Validation errors
export class ValidationError extends GriffonyError {
  public readonly validationTarget: string;
  public readonly expectedType?: string;

  constructor(message: string, validationTarget: string, expectedType?: string) {
    super(message, 'VALIDATION_ERROR', 'VALIDATION');
    this.validationTarget = validationTarget;
    this.expectedType = expectedType;
  }
}

// Game state errors
export class GameStateError extends GriffonyError {
  public readonly stateOperation: string;

  constructor(message: string, stateOperation: string) {
    super(message, 'GAME_STATE_ERROR', 'GAME_STATE');
    this.stateOperation = stateOperation;
  }
}

// Configuration errors
export class ConfigurationError extends GriffonyError {
  public readonly configKey: string;

  constructor(message: string, configKey: string) {
    super(message, 'CONFIGURATION_ERROR', 'CONFIGURATION');
    this.configKey = configKey;
  }
}

// Result type for operations that can fail
export type Result<T, E = GriffonyError> = {
  success: true;
  data: T;
} | {
  success: false;
  error: E;
};

/**
 * Error handler utility class
 */
export class ErrorHandler {
  private static instance: ErrorHandler;

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle and log an error appropriately
   */  public handle(error: Error, context?: string): void {
    if (error instanceof GriffonyError) {
      console.error(`${context ? `[${context}] ` : ''}${error.message}`, {
        code: error.code,
        timestamp: error.timestamp,
        stack: error.stack
      });
    } else {
      console.error(`${context ? `[${context}] ` : ''}${error.message}`, {
        stack: error.stack
      });
    }
  }

  /**
   * Create a Result wrapper for safe operations
   */
  public async safeAsync<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<Result<T>> {
    try {
      const data = await operation();
      return { success: true, data };
    } catch (error) {
      if (context) {
        this.handle(error as Error, context);
      }
      return { 
        success: false, 
        error: error instanceof GriffonyError ? error : new GriffonyError(
          (error as Error).message, 
          'UNKNOWN_ERROR',
          'UNKNOWN'
        )
      };
    }
  }

  /**
   * Create a Result wrapper for synchronous operations
   */
  public safe<T>(
    operation: () => T,
    context?: string
  ): Result<T> {
    try {
      const data = operation();
      return { success: true, data };
    } catch (error) {
      if (context) {
        this.handle(error as Error, context);
      }
      return { 
        success: false, 
        error: error instanceof GriffonyError ? error : new GriffonyError(
          (error as Error).message, 
          'UNKNOWN_ERROR',
          'UNKNOWN'
        )
      };
    }
  }

  /**
   * Standardized fetch wrapper with proper error handling
   */
  public async fetchResource(
    url: string, 
    resourceType: string,
    options?: RequestInit
  ): Promise<Result<Response>> {
    return this.safeAsync(async () => {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new NetworkError(
          `Failed to fetch ${resourceType}: HTTP ${response.status} ${response.statusText}`,
          url,
          response.status
        );
      }
      return response;
    }, `Fetch ${resourceType}`);
  }

  /**
   * Standardized JSON parsing with error handling
   */
  public async parseJSON<T>(
    response: Response,
    resourceType: string,
    url: string
  ): Promise<Result<T>> {
    return this.safeAsync(async () => {
      try {
        return await response.json() as T;
      } catch (error) {
        throw new ResourceLoadError(
          `Invalid JSON in ${resourceType}: ${(error as Error).message}`,
          resourceType,
          url
        );
      }
    }, `Parse ${resourceType} JSON`);
  }
}

// Export singleton instance for convenience
export const errorHandler = ErrorHandler.getInstance();
