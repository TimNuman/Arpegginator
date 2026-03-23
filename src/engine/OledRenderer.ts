// OledRenderer.ts — Canvas-based OLED display renderer using WASM framebuffer

// Display dimensions (must match oled_gfx.rs)
export const OLED_WIDTH = 256;
export const OLED_HEIGHT = 128;

interface WasmModule {
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
  HEAPU8: Uint8Array;
}

export class OledRenderer {
  private module: WasmModule;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;

  // WASM function bindings
  private _render: (modifiers: number) => void;
  private _getFramebufferPtr: () => number;

  constructor(module: WasmModule) {
    this.module = module;

    const cw = (
      name: string,
      ret: string | null,
      args: string[],
    ): ((...a: unknown[]) => unknown) => module.cwrap(name, ret, args);

    (cw("oled_init", null, []) as () => void)();
    this._render = cw("oled_render", null, ["number"]) as (
      modifiers: number,
    ) => void;
    this._getFramebufferPtr = cw(
      "oled_get_framebuffer",
      "number",
      [],
    ) as () => number;
  }

  /** Attach a canvas element for rendering */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.canvas.width = OLED_WIDTH;
    this.canvas.height = OLED_HEIGHT;
    this.ctx = canvas.getContext("2d")!;
    this.imageData = this.ctx.createImageData(OLED_WIDTH, OLED_HEIGHT);
  }

  /** Render the full OLED screen (all logic in Rust). Modifier bitmask: shift=1, meta=2, alt=4, ctrl=8 */
  render(modifiers: number): void {
    this._render(modifiers);
  }

  /** Copy the RGB565 framebuffer from WASM to the canvas */
  blit(): void {
    if (!this.ctx || !this.imageData) return;

    const ptr = this._getFramebufferPtr();
    // RGB565 = 2 bytes per pixel, use HEAPU16 for direct 16-bit access
    const byteOffset = ptr;
    const fb = new Uint16Array(
      this.module.HEAPU8.buffer,
      byteOffset,
      OLED_WIDTH * OLED_HEIGHT,
    );
    const pixels = this.imageData.data;

    for (let i = 0; i < OLED_WIDTH * OLED_HEIGHT; i++) {
      const rgb565 = fb[i];
      const j = i * 4;
      // RGB565: RRRRR GGGGGG BBBBB
      pixels[j] = ((rgb565 >> 11) & 0x1f) << 3; // R: 5-bit → 8-bit
      pixels[j + 1] = ((rgb565 >> 5) & 0x3f) << 2; // G: 6-bit → 8-bit
      pixels[j + 2] = (rgb565 & 0x1f) << 3; // B: 5-bit → 8-bit
      pixels[j + 3] = 255; // A
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
