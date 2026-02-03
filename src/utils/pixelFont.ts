// Variable-width pixel font (height 7) for scrolling text display
// Each character is represented as an array of 7 rows, each row is a number where bits represent pixels
// Bit order: leftmost pixel is highest bit
// Width is stored separately for each character

type FontChar = {
  width: number;
  rows: [number, number, number, number, number, number, number];
};

const FONT: Record<string, FontChar> = {
  // Uppercase letters
  A: {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10001,
      0b11111,
      0b10001,
      0b10001,
      0b10001,
    ],
  },
  B: {
    width: 5,
    rows: [
      0b11110,
      0b10001,
      0b10001,
      0b11110,
      0b10001,
      0b10001,
      0b11110,
    ],
  },
  C: {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10000,
      0b10000,
      0b10000,
      0b10001,
      0b01110,
    ],
  },
  D: {
    width: 5,
    rows: [
      0b11110,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b11110,
    ],
  },
  E: {
    width: 4,
    rows: [
      0b1111,
      0b1000,
      0b1000,
      0b1110,
      0b1000,
      0b1000,
      0b1111,
    ],
  },
  F: {
    width: 4,
    rows: [
      0b1111,
      0b1000,
      0b1000,
      0b1110,
      0b1000,
      0b1000,
      0b1000,
    ],
  },
  G: {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10000,
      0b10111,
      0b10001,
      0b10001,
      0b01110,
    ],
  },
  H: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b10001,
      0b11111,
      0b10001,
      0b10001,
      0b10001,
    ],
  },
  I: {
    width: 3,
    rows: [
      0b111,
      0b010,
      0b010,
      0b010,
      0b010,
      0b010,
      0b111,
    ],
  },
  J: {
    width: 4,
    rows: [
      0b0111,
      0b0010,
      0b0010,
      0b0010,
      0b0010,
      0b1010,
      0b0100,
    ],
  },
  K: {
    width: 5,
    rows: [
      0b10001,
      0b10010,
      0b10100,
      0b11000,
      0b10100,
      0b10010,
      0b10001,
    ],
  },
  L: {
    width: 4,
    rows: [
      0b1000,
      0b1000,
      0b1000,
      0b1000,
      0b1000,
      0b1000,
      0b1111,
    ],
  },
  M: {
    width: 5,
    rows: [
      0b10001,
      0b11011,
      0b10101,
      0b10101,
      0b10001,
      0b10001,
      0b10001,
    ],
  },
  N: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b11001,
      0b10101,
      0b10011,
      0b10001,
      0b10001,
    ],
  },
  O: {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b01110,
    ],
  },
  P: {
    width: 5,
    rows: [
      0b11110,
      0b10001,
      0b10001,
      0b11110,
      0b10000,
      0b10000,
      0b10000,
    ],
  },
  Q: {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10001,
      0b10001,
      0b10101,
      0b10010,
      0b01101,
    ],
  },
  R: {
    width: 5,
    rows: [
      0b11110,
      0b10001,
      0b10001,
      0b11110,
      0b10100,
      0b10010,
      0b10001,
    ],
  },
  S: {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10000,
      0b01110,
      0b00001,
      0b10001,
      0b01110,
    ],
  },
  T: {
    width: 5,
    rows: [
      0b11111,
      0b00100,
      0b00100,
      0b00100,
      0b00100,
      0b00100,
      0b00100,
    ],
  },
  U: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b01110,
    ],
  },
  V: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b10001,
      0b01010,
      0b00100,
    ],
  },
  W: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b10001,
      0b10101,
      0b10101,
      0b10101,
      0b01010,
    ],
  },
  X: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b01010,
      0b00100,
      0b01010,
      0b10001,
      0b10001,
    ],
  },
  Y: {
    width: 5,
    rows: [
      0b10001,
      0b10001,
      0b01010,
      0b00100,
      0b00100,
      0b00100,
      0b00100,
    ],
  },
  Z: {
    width: 5,
    rows: [
      0b11111,
      0b00001,
      0b00010,
      0b00100,
      0b01000,
      0b10000,
      0b11111,
    ],
  },
  // Lowercase letters
  a: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b01110,
      0b00001,
      0b01111,
      0b10001,
      0b01111,
    ],
  },
  b: {
    width: 5,
    rows: [
      0b10000,
      0b10000,
      0b10110,
      0b11001,
      0b10001,
      0b10001,
      0b11110,
    ],
  },
  c: {
    width: 4,
    rows: [
      0b0000,
      0b0000,
      0b0110,
      0b1001,
      0b1000,
      0b1001,
      0b0110,
    ],
  },
  d: {
    width: 5,
    rows: [
      0b00001,
      0b00001,
      0b01101,
      0b10011,
      0b10001,
      0b10001,
      0b01111,
    ],
  },
  e: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b01110,
      0b10001,
      0b11111,
      0b10000,
      0b01110,
    ],
  },
  f: {
    width: 4,
    rows: [
      0b0011,
      0b0100,
      0b0100,
      0b1110,
      0b0100,
      0b0100,
      0b0100,
    ],
  },
  g: {
    width: 5,
    rows: [
      0b00000,
      0b01111,
      0b10001,
      0b10001,
      0b01111,
      0b00001,
      0b01110,
    ],
  },
  h: {
    width: 5,
    rows: [
      0b10000,
      0b10000,
      0b10110,
      0b11001,
      0b10001,
      0b10001,
      0b10001,
    ],
  },
  i: {
    width: 1,
    rows: [
      0b1,
      0b0,
      0b1,
      0b1,
      0b1,
      0b1,
      0b1,
    ],
  },
  j: {
    width: 3,
    rows: [
      0b001,
      0b000,
      0b011,
      0b001,
      0b001,
      0b101,
      0b010,
    ],
  },
  k: {
    width: 4,
    rows: [
      0b1000,
      0b1000,
      0b1001,
      0b1010,
      0b1100,
      0b1010,
      0b1001,
    ],
  },
  l: {
    width: 2,
    rows: [
      0b11,
      0b01,
      0b01,
      0b01,
      0b01,
      0b01,
      0b11,
    ],
  },
  m: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b11010,
      0b10101,
      0b10101,
      0b10001,
      0b10001,
    ],
  },
  n: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b10110,
      0b11001,
      0b10001,
      0b10001,
      0b10001,
    ],
  },
  o: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b01110,
      0b10001,
      0b10001,
      0b10001,
      0b01110,
    ],
  },
  p: {
    width: 5,
    rows: [
      0b00000,
      0b11110,
      0b10001,
      0b11110,
      0b10000,
      0b10000,
      0b10000,
    ],
  },
  q: {
    width: 5,
    rows: [
      0b00000,
      0b01111,
      0b10001,
      0b01111,
      0b00001,
      0b00001,
      0b00001,
    ],
  },
  r: {
    width: 4,
    rows: [
      0b0000,
      0b0000,
      0b1011,
      0b1100,
      0b1000,
      0b1000,
      0b1000,
    ],
  },
  s: {
    width: 4,
    rows: [
      0b0000,
      0b0000,
      0b0111,
      0b1000,
      0b0110,
      0b0001,
      0b1110,
    ],
  },
  t: {
    width: 4,
    rows: [
      0b0100,
      0b0100,
      0b1110,
      0b0100,
      0b0100,
      0b0100,
      0b0011,
    ],
  },
  u: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b10001,
      0b10001,
      0b10001,
      0b10011,
      0b01101,
    ],
  },
  v: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b10001,
      0b10001,
      0b10001,
      0b01010,
      0b00100,
    ],
  },
  w: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b10001,
      0b10001,
      0b10101,
      0b10101,
      0b01010,
    ],
  },
  x: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b10001,
      0b01010,
      0b00100,
      0b01010,
      0b10001,
    ],
  },
  y: {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b10001,
      0b10001,
      0b01111,
      0b00001,
      0b01110,
    ],
  },
  z: {
    width: 4,
    rows: [
      0b0000,
      0b0000,
      0b1111,
      0b0010,
      0b0100,
      0b1000,
      0b1111,
    ],
  },
  // Numbers
  "0": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10011,
      0b10101,
      0b11001,
      0b10001,
      0b01110,
    ],
  },
  "1": {
    width: 3,
    rows: [
      0b010,
      0b110,
      0b010,
      0b010,
      0b010,
      0b010,
      0b111,
    ],
  },
  "2": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b00001,
      0b00110,
      0b01000,
      0b10000,
      0b11111,
    ],
  },
  "3": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b00001,
      0b00110,
      0b00001,
      0b10001,
      0b01110,
    ],
  },
  "4": {
    width: 5,
    rows: [
      0b00010,
      0b00110,
      0b01010,
      0b10010,
      0b11111,
      0b00010,
      0b00010,
    ],
  },
  "5": {
    width: 5,
    rows: [
      0b11111,
      0b10000,
      0b11110,
      0b00001,
      0b00001,
      0b10001,
      0b01110,
    ],
  },
  "6": {
    width: 5,
    rows: [
      0b00110,
      0b01000,
      0b10000,
      0b11110,
      0b10001,
      0b10001,
      0b01110,
    ],
  },
  "7": {
    width: 5,
    rows: [
      0b11111,
      0b00001,
      0b00010,
      0b00100,
      0b01000,
      0b01000,
      0b01000,
    ],
  },
  "8": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10001,
      0b01110,
      0b10001,
      0b10001,
      0b01110,
    ],
  },
  "9": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10001,
      0b01111,
      0b00001,
      0b00010,
      0b01100,
    ],
  },
  // Punctuation and symbols
  " ": {
    width: 3,
    rows: [
      0b000,
      0b000,
      0b000,
      0b000,
      0b000,
      0b000,
      0b000,
    ],
  },
  ".": {
    width: 2,
    rows: [
      0b00,
      0b00,
      0b00,
      0b00,
      0b00,
      0b11,
      0b11,
    ],
  },
  ",": {
    width: 2,
    rows: [
      0b00,
      0b00,
      0b00,
      0b00,
      0b01,
      0b01,
      0b10,
    ],
  },
  "!": {
    width: 1,
    rows: [
      0b1,
      0b1,
      0b1,
      0b1,
      0b1,
      0b0,
      0b1,
    ],
  },
  "?": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b00001,
      0b00110,
      0b00100,
      0b00000,
      0b00100,
    ],
  },
  "-": {
    width: 4,
    rows: [
      0b0000,
      0b0000,
      0b0000,
      0b1111,
      0b0000,
      0b0000,
      0b0000,
    ],
  },
  "+": {
    width: 5,
    rows: [
      0b00000,
      0b00100,
      0b00100,
      0b11111,
      0b00100,
      0b00100,
      0b00000,
    ],
  },
  "'": {
    width: 1,
    rows: [
      0b1,
      0b1,
      0b0,
      0b0,
      0b0,
      0b0,
      0b0,
    ],
  },
  '"': {
    width: 3,
    rows: [
      0b101,
      0b101,
      0b000,
      0b000,
      0b000,
      0b000,
      0b000,
    ],
  },
  ":": {
    width: 1,
    rows: [
      0b0,
      0b1,
      0b1,
      0b0,
      0b1,
      0b1,
      0b0,
    ],
  },
  ";": {
    width: 2,
    rows: [
      0b00,
      0b01,
      0b01,
      0b00,
      0b01,
      0b01,
      0b10,
    ],
  },
  "/": {
    width: 5,
    rows: [
      0b00001,
      0b00010,
      0b00010,
      0b00100,
      0b01000,
      0b01000,
      0b10000,
    ],
  },
  "\\": {
    width: 5,
    rows: [
      0b10000,
      0b01000,
      0b01000,
      0b00100,
      0b00010,
      0b00010,
      0b00001,
    ],
  },
  "(": {
    width: 3,
    rows: [
      0b001,
      0b010,
      0b100,
      0b100,
      0b100,
      0b010,
      0b001,
    ],
  },
  ")": {
    width: 3,
    rows: [
      0b100,
      0b010,
      0b001,
      0b001,
      0b001,
      0b010,
      0b100,
    ],
  },
  "[": {
    width: 2,
    rows: [
      0b11,
      0b10,
      0b10,
      0b10,
      0b10,
      0b10,
      0b11,
    ],
  },
  "]": {
    width: 2,
    rows: [
      0b11,
      0b01,
      0b01,
      0b01,
      0b01,
      0b01,
      0b11,
    ],
  },
  "{": {
    width: 3,
    rows: [
      0b001,
      0b010,
      0b010,
      0b100,
      0b010,
      0b010,
      0b001,
    ],
  },
  "}": {
    width: 3,
    rows: [
      0b100,
      0b010,
      0b010,
      0b001,
      0b010,
      0b010,
      0b100,
    ],
  },
  "#": {
    width: 5,
    rows: [
      0b01010,
      0b01010,
      0b11111,
      0b01010,
      0b11111,
      0b01010,
      0b01010,
    ],
  },
  "@": {
    width: 5,
    rows: [
      0b01110,
      0b10001,
      0b10111,
      0b10101,
      0b10110,
      0b10000,
      0b01110,
    ],
  },
  "&": {
    width: 5,
    rows: [
      0b01100,
      0b10010,
      0b10100,
      0b01000,
      0b10101,
      0b10010,
      0b01101,
    ],
  },
  "*": {
    width: 5,
    rows: [
      0b00000,
      0b10101,
      0b01110,
      0b11111,
      0b01110,
      0b10101,
      0b00000,
    ],
  },
  "=": {
    width: 4,
    rows: [
      0b0000,
      0b0000,
      0b1111,
      0b0000,
      0b1111,
      0b0000,
      0b0000,
    ],
  },
  "%": {
    width: 5,
    rows: [
      0b11001,
      0b11010,
      0b00010,
      0b00100,
      0b01000,
      0b01011,
      0b10011,
    ],
  },
  "<": {
    width: 4,
    rows: [
      0b0001,
      0b0010,
      0b0100,
      0b1000,
      0b0100,
      0b0010,
      0b0001,
    ],
  },
  ">": {
    width: 4,
    rows: [
      0b1000,
      0b0100,
      0b0010,
      0b0001,
      0b0010,
      0b0100,
      0b1000,
    ],
  },
  "_": {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b00000,
      0b00000,
      0b00000,
      0b00000,
      0b11111,
    ],
  },
  "^": {
    width: 3,
    rows: [
      0b010,
      0b101,
      0b000,
      0b000,
      0b000,
      0b000,
      0b000,
    ],
  },
  "`": {
    width: 2,
    rows: [
      0b10,
      0b01,
      0b00,
      0b00,
      0b00,
      0b00,
      0b00,
    ],
  },
  "~": {
    width: 5,
    rows: [
      0b00000,
      0b00000,
      0b01000,
      0b10101,
      0b00010,
      0b00000,
      0b00000,
    ],
  },
  $: {
    width: 5,
    rows: [
      0b00100,
      0b01111,
      0b10100,
      0b01110,
      0b00101,
      0b11110,
      0b00100,
    ],
  },
};

const CHAR_HEIGHT = 7;
const CHAR_SPACING = 1; // 1 column gap between characters

// Default character for unknown chars
const DEFAULT_CHAR: FontChar = {
  width: 3,
  rows: [0b111, 0b101, 0b101, 0b101, 0b101, 0b101, 0b111],
};

/**
 * Get the character data for a given character
 */
function getCharData(char: string): FontChar {
  return FONT[char] || DEFAULT_CHAR;
}

/**
 * Calculate the total width of a message in pixels
 */
export function getMessageWidth(message: string): number {
  if (message.length === 0) return 0;

  let totalWidth = 0;
  for (let i = 0; i < message.length; i++) {
    const charData = getCharData(message[i]);
    totalWidth += charData.width;
    if (i < message.length - 1) {
      totalWidth += CHAR_SPACING;
    }
  }
  return totalWidth;
}

/**
 * Renders a message as a 2D boolean array for the grid
 * @param message - The text to render
 * @param scrollOffset - Horizontal scroll position (in pixels/columns)
 * @param gridWidth - Width of the visible grid
 * @param gridHeight - Height of the visible grid (should be >= 7 for full font height)
 * @returns 2D array [row][col] where true = pixel on
 */
export function renderScrollingText(
  message: string,
  scrollOffset: number,
  gridWidth: number,
  gridHeight: number
): boolean[][] {
  // Create output grid (centered vertically if grid is taller than font)
  const result: boolean[][] = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(false)
  );

  // Vertical offset to center the text (font is 7 pixels tall)
  const verticalOffset = Math.floor((gridHeight - CHAR_HEIGHT) / 2);

  // Build a map of messageCol -> { char, colInChar }
  // This lets us know which character and which column within it for any message column
  let currentX = 0;
  const charPositions: { startX: number; charData: FontChar }[] = [];

  for (let i = 0; i < message.length; i++) {
    const charData = getCharData(message[i]);
    charPositions.push({ startX: currentX, charData });
    currentX += charData.width + CHAR_SPACING;
  }

  // Render each visible column
  for (let col = 0; col < gridWidth; col++) {
    // Calculate which column in the message this corresponds to
    const messageCol = col + scrollOffset;

    // Skip if this column is before the start of the message
    if (messageCol < 0) continue;

    // Find which character this column falls into
    let foundChar: FontChar | null = null;
    let colInChar = 0;

    for (const pos of charPositions) {
      if (messageCol >= pos.startX && messageCol < pos.startX + pos.charData.width) {
        foundChar = pos.charData;
        colInChar = messageCol - pos.startX;
        break;
      }
    }

    // Skip if not in a character (in spacing or past end)
    if (!foundChar) continue;

    // Render this column of the character
    for (let row = 0; row < CHAR_HEIGHT; row++) {
      const gridRow = row + verticalOffset;
      if (gridRow < 0 || gridRow >= gridHeight) continue;

      // Check if this pixel is on (bit is set)
      // Bits are stored with leftmost pixel as highest bit
      const bitMask = 1 << (foundChar.width - 1 - colInChar);
      if (foundChar.rows[row] & bitMask) {
        result[gridRow][col] = true;
      }
    }
  }

  return result;
}

export { CHAR_HEIGHT, CHAR_SPACING };
