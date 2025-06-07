/**
 * Centralized logging system for Griffony
 * Provides configurable log levels and specialized logging methods
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  VERBOSE = 4
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enablePerformanceLogs: boolean;
  enableMeshStats: boolean;
  enableShaderLogs: boolean;
  enablePhysicsLogs: boolean;
}

export class Logger {
  private static instance: Logger | null = null;
  private config: LoggerConfig;

  private constructor() {
    // Default configuration - can be overridden
    this.config = {
      level: LogLevel.INFO, // Default to INFO level (ERROR, WARN, INFO)
      enableConsole: true,
      enablePerformanceLogs: false,
      enableMeshStats: false,
      enableShaderLogs: false,
      enablePhysicsLogs: false
    };
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    return this.config.enableConsole && level <= this.config.level;
  }

  private formatMessage(level: string, category: string, message: string): string {
    const timestamp = new Date().toISOString().substr(11, 12);
    return `[${timestamp}] ${level.padEnd(5)} [${category.padEnd(8)}] ${message}`;
  }

  // Core logging methods
  public error(category: string, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('ERROR', category, message), ...args);
    }
  }

  public warn(category: string, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('WARN', category, message), ...args);
    }
  }

  public info(category: string, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage('INFO', category, message), ...args);
    }
  }

  public debug(category: string, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage('DEBUG', category, message), ...args);
    }
  }

  public verbose(category: string, message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.VERBOSE)) {
      console.log(this.formatMessage('VERBOSE', category, message), ...args);
    }
  }

  // Specialized logging methods
  public performance(operation: string, duration: number, details?: string): void {
    if (this.config.enablePerformanceLogs && this.shouldLog(LogLevel.DEBUG)) {
      const message = `${operation} took ${duration.toFixed(2)}ms${details ? ` - ${details}` : ''}`;
      console.log(this.formatMessage('PERF', 'RENDERER', message));
    }
  }

  public meshStats(modelName: string, originalFaces: number, greedyFaces: number, details?: any): void {
    if (this.config.enableMeshStats && this.shouldLog(LogLevel.DEBUG)) {
      const message = `${modelName} - Original: ${originalFaces}, Greedy: ${greedyFaces}`;
      console.log(this.formatMessage('MESH', 'RENDERER', message));
      
      if (details && this.shouldLog(LogLevel.VERBOSE)) {
        console.log(this.formatMessage('MESH', 'RENDERER', 'Details:'), details);
      }
    }
  }

  public shaderCompilation(shaderName: string, success: boolean, messages?: any[]): void {
    if (this.config.enableShaderLogs) {
      const status = success ? 'compiled successfully' : 'compilation failed';
      const level = success ? LogLevel.INFO : LogLevel.ERROR;
      
      if (this.shouldLog(level)) {
        console.log(this.formatMessage(success ? 'INFO' : 'ERROR', 'SHADER', `${shaderName} ${status}`));
        
        if (messages && messages.length > 0) {
          messages.forEach(message => {
            console.log(this.formatMessage('SHADER', 'DETAIL', message.message || message));
          });
        }
      }
    }
  }

  public physics(message: string, ...args: any[]): void {
    if (this.config.enablePhysicsLogs && this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage('DEBUG', 'PHYSICS', message), ...args);
    }
  }

  // Quick access methods for common categories
  public renderer = {
    error: (msg: string, ...args: any[]) => this.error('RENDERER', msg, ...args),
    warn: (msg: string, ...args: any[]) => this.warn('RENDERER', msg, ...args),
    info: (msg: string, ...args: any[]) => this.info('RENDERER', msg, ...args),
    debug: (msg: string, ...args: any[]) => this.debug('RENDERER', msg, ...args),
  };

  public model = {
    error: (msg: string, ...args: any[]) => this.error('MODEL', msg, ...args),
    warn: (msg: string, ...args: any[]) => this.warn('MODEL', msg, ...args),
    info: (msg: string, ...args: any[]) => this.info('MODEL', msg, ...args),
    debug: (msg: string, ...args: any[]) => this.debug('MODEL', msg, ...args),
  };

  public level = {
    error: (msg: string, ...args: any[]) => this.error('LEVEL', msg, ...args),
    warn: (msg: string, ...args: any[]) => this.warn('LEVEL', msg, ...args),
    info: (msg: string, ...args: any[]) => this.info('LEVEL', msg, ...args),
    debug: (msg: string, ...args: any[]) => this.debug('LEVEL', msg, ...args),
  };
}

// Export singleton instance
export const logger = Logger.getInstance();

// Helper function to configure logging based on environment
export function configureLogging(isDevelopment: boolean = false): void {
  if (isDevelopment) {
    logger.configure({
      level: LogLevel.VERBOSE,
      enablePerformanceLogs: true,
      enableMeshStats: true,
      enableShaderLogs: true,
      enablePhysicsLogs: false // Keep physics logs disabled by default as they can be very noisy
    });
  } else {
    logger.configure({
      level: LogLevel.WARN, // Production: only warnings and errors
      enablePerformanceLogs: false,
      enableMeshStats: false,
      enableShaderLogs: false,
      enablePhysicsLogs: false
    });
  }
}
