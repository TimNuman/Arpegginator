interface EmscriptenModule {
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: number[]) => number;
}

type WasmFactory = (config?: object) => Promise<EmscriptenModule>;

/** Load the Emscripten glue script and return the factory function. */
function loadGlueScript(url: string): Promise<WasmFactory> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      // Emscripten MODULARIZE puts the factory on window
      const factory = (window as unknown as Record<string, WasmFactory>).createWasmEngine;
      if (!factory) {
        reject(new Error('createWasmEngine not found on window'));
        return;
      }
      resolve(factory);
    };
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
}

export class WasmEngine {
  private module: EmscriptenModule | null = null;

  private _add!: (a: number, b: number) => number;
  private _tick!: (currentTick: number, bpm: number) => number;
  private _init!: (bpm: number) => number;
  private _getVersion!: () => number;

  async load(): Promise<void> {
    if (this.module) return;

    const factory = await loadGlueScript('/wasm/engine.js');
    this.module = await factory();

    this._add = this.module.cwrap('engine_add', 'number', ['number', 'number']);
    this._tick = this.module.cwrap('engine_tick', 'number', ['number', 'number']);
    this._init = this.module.cwrap('engine_init', null as unknown as string, ['number']);
    this._getVersion = this.module.cwrap('engine_get_version', 'number', []);

    console.log('WASM engine loaded, version:', this.getVersion());
  }

  isReady(): boolean {
    return this.module !== null;
  }

  add(a: number, b: number): number {
    return this._add(a, b);
  }

  tick(currentTick: number, bpm: number): number {
    return this._tick(currentTick, bpm);
  }

  init(bpm: number): void {
    this._init(bpm);
  }

  getVersion(): number {
    return this._getVersion();
  }
}
