// OledRenderer.ts — Canvas-based OLED display renderer using WASM framebuffer

import type { WasmModule } from "./WasmEngine";

// Display dimensions (must match oled_gfx.rs)
export const OLED_WIDTH = 256;
export const OLED_HEIGHT = 128;

export class OledRenderer {
  private module: WasmModule;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;

  constructor(module: WasmModule) {
    this.module = module;
    module.exports.oled_init();
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
    this.module.exports.oled_render(modifiers);
  }

  /** Copy the RGB565 framebuffer from WASM to the canvas */
  blit(): void {
    if (!this.ctx || !this.imageData) return;

    const ptr = this.module.exports.oled_get_framebuffer();
    // RGB565 = 2 bytes per pixel; read a fresh view onto the live heap.
    const fb = new Uint16Array(
      this.module.buffer,
      ptr,
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
