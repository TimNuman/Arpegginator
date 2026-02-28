// OledRenderer.ts — Canvas-based OLED display renderer using WASM framebuffer

// Color indices (must match oled_display.h)
export const OLED_CYAN = 0;
export const OLED_YELLOW = 1;
export const OLED_RED = 2;
export const OLED_WHITE = 3;
export const OLED_DIM = 4;

// Font indices (must match oled_display.h)
export const OLED_FONT_MAIN = 0;
export const OLED_FONT_SMALL = 1;

// Display dimensions (must match oled_gfx.h)
export const OLED_WIDTH = 160;
export const OLED_HEIGHT = 128;

interface EmscriptenModule {
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
}

export class OledRenderer {
  private module: EmscriptenModule;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;

  // WASM function bindings
  private _init: () => void;
  private _clear: () => void;
  private _drawText: (
    x: number,
    y: number,
    text: string,
    color: number,
    font: number,
  ) => void;
  private _drawHLine: (
    x: number,
    y: number,
    w: number,
    color: number,
  ) => void;
  private _drawVLine: (
    x: number,
    y: number,
    h: number,
    color: number,
  ) => void;
  private _drawLine: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
  ) => void;
  private _drawRect: (
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
  ) => void;
  private _fillRect: (
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
  ) => void;
  private _drawPixel: (x: number, y: number, color: number) => void;
  private _textWidth: (text: string, font: number) => number;
  private _fontHeight: (font: number) => number;
  private _render: (modifiers: number) => void;
  private _getFramebufferPtr: () => number;
  private _getFramebufferSize: () => number;

  constructor(module: EmscriptenModule) {
    this.module = module;

    const cw = (
      name: string,
      ret: string | null,
      args: string[],
    ): ((...a: unknown[]) => unknown) => module.cwrap(name, ret, args);

    this._init = cw("oled_init", null, []) as () => void;
    this._clear = cw("oled_clear", null, []) as () => void;
    this._drawText = cw("oled_draw_text", null, [
      "number",
      "number",
      "string",
      "number",
      "number",
    ]) as (x: number, y: number, text: string, color: number, font: number) => void;
    this._drawHLine = cw("oled_draw_hline", null, [
      "number",
      "number",
      "number",
      "number",
    ]) as (x: number, y: number, w: number, color: number) => void;
    this._drawVLine = cw("oled_draw_vline", null, [
      "number",
      "number",
      "number",
      "number",
    ]) as (x: number, y: number, h: number, color: number) => void;
    this._drawLine = cw("oled_draw_line", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
    ]) as (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      color: number,
    ) => void;
    this._drawRect = cw("oled_draw_rect", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
    ]) as (
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
    ) => void;
    this._fillRect = cw("oled_fill_rect", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
    ]) as (
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
    ) => void;
    this._drawPixel = cw("oled_draw_pixel", null, [
      "number",
      "number",
      "number",
    ]) as (x: number, y: number, color: number) => void;
    this._textWidth = cw("oled_text_width", "number", [
      "string",
      "number",
    ]) as (text: string, font: number) => number;
    this._fontHeight = cw("oled_font_height", "number", [
      "number",
    ]) as (font: number) => number;
    this._render = cw("oled_render", null, [
      "number",
    ]) as (modifiers: number) => void;
    this._getFramebufferPtr = cw(
      "oled_get_framebuffer",
      "number",
      [],
    ) as () => number;
    this._getFramebufferSize = cw(
      "oled_get_framebuffer_size",
      "number",
      [],
    ) as () => number;

    this._init();
  }

  /** Attach a canvas element for rendering */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.canvas.width = OLED_WIDTH;
    this.canvas.height = OLED_HEIGHT;
    this.ctx = canvas.getContext("2d")!;
    this.imageData = this.ctx.createImageData(OLED_WIDTH, OLED_HEIGHT);
  }

  // ============ High-level API ============

  /** Render the full OLED screen (all logic in C). Modifier bitmask: shift=1, meta=2, alt=4, ctrl=8 */
  render(modifiers: number): void {
    this._render(modifiers);
  }

  // ============ Drawing API (low-level, kept for compatibility) ============

  clear(): void {
    this._clear();
  }

  drawText(
    x: number,
    y: number,
    text: string,
    color = OLED_CYAN,
    font = OLED_FONT_MAIN,
  ): void {
    this._drawText(x, y, text, color, font);
  }

  drawHLine(x: number, y: number, w: number, color = OLED_CYAN): void {
    this._drawHLine(x, y, w, color);
  }

  drawVLine(x: number, y: number, h: number, color = OLED_CYAN): void {
    this._drawVLine(x, y, h, color);
  }

  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color = OLED_CYAN,
  ): void {
    this._drawLine(x0, y0, x1, y1, color);
  }

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color = OLED_CYAN,
  ): void {
    this._drawRect(x, y, w, h, color);
  }

  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color = OLED_CYAN,
  ): void {
    this._fillRect(x, y, w, h, color);
  }

  drawPixel(x: number, y: number, color = OLED_CYAN): void {
    this._drawPixel(x, y, color);
  }

  textWidth(text: string, font = OLED_FONT_MAIN): number {
    return this._textWidth(text, font);
  }

  fontHeight(font = OLED_FONT_MAIN): number {
    return this._fontHeight(font);
  }

  // ============ Canvas blit ============

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
