/**
 * Code tiles: seamless strips of falling glyphs, drawn once per ink, that the
 * letters of the Enter page show inside their outline (`background-clip:
 * text`). A tile repeats down: a stream that leaves the bottom comes back at
 * the top. The page slides the tiles down by `--fall-near` / `--fall-far`.
 */

import { FONT_STACK, GLYPHS, KANA } from "#/lib/matrix-flashlight";

/** Columns and rows of a tile, and its size in em of the wordmark. */
export const TILE_COLS = 16;
export const TILE_ROWS = 40;
export const NEAR_EM = { width: 1.36, height: 4 };
export const FAR_EM = { width: 0.82, height: 2.4 };

/** Device pixels of a cell when drawn. The tile is scaled by CSS, so this is its sharpness. */
const CELL_W = 48;
const CELL_H = 56;

interface TileInk {
  /** The trail. */
  fill: string;
  /** The head of a stream. */
  head: string;
}

function drawTile(ink: TileInk, gain: number, streamsPerColumn: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_COLS * CELL_W;
  canvas.height = TILE_ROWS * CELL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.font = `${Math.round(CELL_H * 0.72)}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const glyph = (col: number, row: number, colour: string, alpha: number, glow: number) => {
    const index = Math.floor(Math.random() * GLYPHS.length);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * gain);
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = glow;
    ctx.translate((col + 0.5) * CELL_W, (row + 0.5) * CELL_H);
    // The film shows its katakana mirrored.
    if (index < KANA.length) ctx.scale(-1, 1);
    ctx.fillText(GLYPHS[index] ?? "0", 0, 0);
    ctx.restore();
  };

  for (let col = 0; col < TILE_COLS; col++) {
    const lit = new Float32Array(TILE_ROWS);
    const heads: number[] = [];
    for (let stream = 0; stream < streamsPerColumn; stream++) {
      if (Math.random() < 0.25) continue;
      const head = Math.floor(Math.random() * TILE_ROWS);
      const length = 6 + Math.random() * 16;
      heads.push(head);
      // The trail is above the head (the tile slides down), wrapping round.
      for (let back = 1; back < length; back++) {
        const row = (head - back + TILE_ROWS) % TILE_ROWS;
        lit[row] = Math.max(lit[row] ?? 0, Math.exp((-back / length) * 2.4));
      }
    }
    for (let row = 0; row < TILE_ROWS; row++) {
      if (heads.includes(row)) glyph(col, row, ink.head, 1, CELL_H * 0.35);
      else glyph(col, row, ink.fill, 0.2 + 0.8 * (lit[row] ?? 0), CELL_H * 0.16);
    }
  }
  return canvas;
}

function urlOf(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) =>
      blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("tile")),
    );
  });
}

export interface CodeTiles {
  near: string;
  far: string;
}

/** Draw the near and the far tile for one ink. Revoke both URLs when done with them. */
export async function codeTiles(ink: TileInk): Promise<CodeTiles> {
  const [near, far] = await Promise.all([urlOf(drawTile(ink, 1, 3)), urlOf(drawTile(ink, 0.6, 2))]);
  return { near, far };
}

export function revokeTiles(tiles: CodeTiles | null | undefined): void {
  if (!tiles) return;
  URL.revokeObjectURL(tiles.near);
  URL.revokeObjectURL(tiles.far);
}
