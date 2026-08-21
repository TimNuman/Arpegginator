// OledRenderer.ts — Canvas-based OLED display renderer using WASM framebuffer

import type { WasmModule } from "./WasmEngine";
import { chrome } from "../theme/chrome";

// Reflective memory-LCD simulation. The engine writes one of eight colors
// (1 bit per channel); a JDI LPM027M128C shows those as muted, paper-like
// reflections rather than pure RGB, so the sim maps them the same way. Keyed
// by RGB565 value; anything else falls through to a plain 565 expansion.
const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const PANEL_LUT = new Map<number, [number, number, number]>([
  [0x0000, rgb(chrome.panel.ink)],
  [0xffff, rgb(chrome.panel.paper)],
  [0xf800, rgb(chrome.panel.red)],
  [0x07e0, rgb(chrome.panel.green)],
  [0x001f, rgb(chrome.panel.blue)],
  [0xffe0, rgb(chrome.panel.yellow)],
  [0xf81f, rgb(chrome.panel.magenta)],
  [0x07ff, rgb(chrome.panel.cyan)],
]);

// Display dimensions (must match oled_gfx.rs)
export const OLED_WIDTH = 400;
export const OLED_HEIGHT = 240;

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
    const fb = new Uint16Array(this.module.buffer, ptr, OLED_WIDTH * OLED_HEIGHT);
    const pixels = this.imageData.data;

    for (let i = 0; i < OLED_WIDTH * OLED_HEIGHT; i++) {
      const rgb565 = fb[i];
      const j = i * 4;
      const panel = PANEL_LUT.get(rgb565);
      if (panel) {
        pixels[j] = panel[0];
        pixels[j + 1] = panel[1];
        pixels[j + 2] = panel[2];
      } else {
        // RGB565: RRRRR GGGGGG BBBBB
        pixels[j] = ((rgb565 >> 11) & 0x1f) << 3; // R: 5-bit → 8-bit
        pixels[j + 1] = ((rgb565 >> 5) & 0x3f) << 2; // G: 6-bit → 8-bit
        pixels[j + 2] = (rgb565 & 0x1f) << 3; // B: 5-bit → 8-bit
      }
      pixels[j + 3] = 255; // A
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
