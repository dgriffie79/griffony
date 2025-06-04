// Vite-specific type declarations

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  // Add more env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob(pattern: string, options?: { as?: 'raw' | 'url' }): Record<string, () => Promise<any>>;
}
