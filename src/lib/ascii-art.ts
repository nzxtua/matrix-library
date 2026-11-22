/**
 * Image to ASCII art, made of solid characters only.
 *
 * Every cell of the image becomes one character, chosen by tone: a light area
 * gets a dense character, a dark area a sparse one. There are no line-like
 * characters (`/`, `_`, `|`, quotes), so no strokes run along the edges or
 * hatch the fills. An edge is a clean cut: a cell is either drawn or empty.
 */

/**
 * The characters the art is made of: round or dense letters, digits and a few
 * symbols. Thin and angular ones (`i`, `l`, `1`, `J`, `L`, `7`...) are left
 * out, because a row of them reads as lines. Their order does not matter: they
 * are sorted by the ink the font gives them.
 */
export const SOLID_GLYPHS = "coeasxznu0235689SCOGQDBRHNKWM#@%&".split("");

/** Font size, in pixels, at which the ink of a glyph is measured. */
const GLYPH_SIZE = 40;

/** A cell that the image covers less than this stays empty. */
const MIN_COVERAGE = 0.5;

/** On an image without transparency, a tone darker than this stays empty. */
const BLACK_TONE = 0.08;

/**
 * Width of a monospace cell divided by the font size. `.ascii` in
 * `styles/panel.css` sizes its characters with the same number.
 */
export const CELL_ASPECT = 0.6;

/** Art with fewer columns than this does not read as a picture. */
const MIN_COLUMNS = 24;

/** The font the art is shown in. Line height must be 1. */
export interface AsciiFont {
  family: string;
  weight: string;
}

/**
 * How many columns of art fill a box `width` pixels wide: as many as `most`,
 * but fewer when the characters would get smaller than `minGlyph` pixels. A
 * small box gets coarser art, never unreadable characters.
 *
 * Returns 0 for a box without a width (not laid out, or hidden): nothing to draw.
 */
export function fitColumns(width: number, most: number, minGlyph: number): number {
  if (!(width > 0) || !(most > 0)) return 0;
  const legible = Math.floor(width / (minGlyph * CELL_ASPECT));
  return Math.round(Math.min(most, Math.max(legible, MIN_COLUMNS)));
}

export interface GlyphRamp {
  /** Glyphs from the sparsest to the densest. */
  glyphs: string[];
  /** Ink of each glyph, 0..1 across the ramp. */
  ink: number[];
  /** Width of a character cell divided by its height. */
  cellAspect: number;
}

/** The ramp of every font measured so far. The art is drawn again when its box changes. */
const ramps = new Map<string, GlyphRamp>();

/**
 * Measures how much ink the font gives every glyph and sorts them by it.
 * The 3D logo draws its glyph storm with the same ramp (`logo-stage.ts`).
 */
export function glyphRamp(font: AsciiFont): GlyphRamp | null {
  const key = `${font.weight} ${font.family}`;
  const known = ramps.get(key);
  if (known) return known;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const fontSpec = `${font.weight} ${GLYPH_SIZE}px ${font.family}`;
  ctx.font = fontSpec;
  const advance = ctx.measureText("M").width;
  const width = Math.ceil(advance);
  // Taller than the line, so no ascender or descender is cut off.
  const height = GLYPH_SIZE * 2;

  // Resizing a canvas resets its state, so the font is set again.
  canvas.width = width;
  canvas.height = height;
  ctx.font = fontSpec;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";

  const measured = SOLID_GLYPHS.map((glyph) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillText(glyph, 0, height / 2);
    const { data } = ctx.getImageData(0, 0, width, height);
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) ink += data[i];
    return { glyph, ink };
  }).sort((a, b) => a.ink - b.ink);

  const sparsest = measured[0].ink;
  const range = Math.max(measured[measured.length - 1].ink - sparsest, 1);

  const ramp: GlyphRamp = {
    glyphs: measured.map((entry) => entry.glyph),
    ink: measured.map((entry) => (entry.ink - sparsest) / range),
    cellAspect: advance / GLYPH_SIZE,
  };
  ramps.set(key, ramp);
  return ramp;
}

/** The values at the low and high `fraction` of a list: its range without outliers. */
function percentiles(values: number[], fraction: number): [number, number] {
  if (values.length === 0) return [0, 1];
  const sorted = Float32Array.from(values).sort();
  const at = (share: number) => sorted[Math.round(share * (sorted.length - 1))];
  return [at(fraction), at(1 - fraction)];
}

/** Converts an image to `columns` characters per line of ASCII art. */
export function imageToAscii(image: HTMLImageElement, columns: number, font: AsciiFont): string {
  const ramp = glyphRamp(font);
  if (!ramp) return "";

  const rows = Math.max(
    1,
    Math.round(columns * (image.naturalHeight / image.naturalWidth) * ramp.cellAspect),
  );

  // One pixel of this canvas is one cell. While it scales the image down, the
  // browser averages the pixels of a cell: alpha becomes the share of the cell
  // the image covers, and the colour is the mean colour of that share.
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, columns, rows);
  const { data } = ctx.getImageData(0, 0, columns, rows);

  const luminanceAt = (i: number) =>
    (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;

  let isCutout = false;
  const tones: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const coverage = data[i + 3] / 255;
    if (coverage < 0.98) isCutout = true;
    if (coverage >= MIN_COVERAGE) tones.push(luminanceAt(i));
  }

  // Auto-levels: the image's own darkest and lightest tones span the whole
  // ramp, so close tones still get different characters.
  const [darkest, lightest] = percentiles(tones, 0.02);
  const toneRange = Math.max(lightest - darkest, 1e-3);

  /** The glyph whose ink is closest to `tone` (0..1). */
  const glyphFor = (tone: number): string => {
    let best = 0;
    for (let i = 1; i < ramp.ink.length; i++) {
      if (Math.abs(ramp.ink[i] - tone) < Math.abs(ramp.ink[best] - tone)) best = i;
    }
    return ramp.glyphs[best];
  };

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < columns; col++) {
      const i = (row * columns + col) * 4;
      const tone = Math.min(1, Math.max(0, (luminanceAt(i) - darkest) / toneRange));
      // A cut-out image shows its whole shape, even where it is black. An
      // image without transparency has no shape: there, black stays empty.
      const empty = data[i + 3] / 255 < MIN_COVERAGE || (!isCutout && tone < BLACK_TONE);
      line += empty ? " " : glyphFor(tone);
    }
    lines.push(line.trimEnd());
  }

  return lines.join("\n");
}
