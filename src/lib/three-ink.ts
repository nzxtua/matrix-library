/**
 * What the Three.js rooms share: light that adds to the page, the glyph atlas
 * of the rain, colours read from the vibe, and frame-rate independent easing.
 *
 * This module imports `three`. Load it, and the rooms, with a dynamic
 * `import()` only.
 */

import {
  CanvasTexture,
  CustomBlending,
  DoubleSide,
  LinearMipmapLinearFilter,
  OneFactor,
  ShaderMaterial,
} from "three";
import type { IUniform, Material } from "three";

import { FONT_STACK, GLYPHS, KANA } from "#/lib/matrix-flashlight";

export type Rgb = [number, number, number];

/** `"204 255 0"` (a CSS token) → `[0.8, 1, 0]`. */
export function rgbOf(token: string, fallback: Rgb): Rgb {
  const parts = token
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255];
}

/** `"#ccff00"` → `[0.8, 1, 0]`. */
export function rgbOfHex(hex: string, fallback: Rgb): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return fallback;
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** The damping of the source orbit, `rate` per 60 Hz frame, at any refresh rate. */
export function approach(from: number, to: number, rate: number, dt: number): number {
  return from + (to - from) * (1 - (1 - rate) ** (dt * 60));
}

export const LIGHT_OUT = /* glsl */ `
vec4 light(vec3 c) {
  c = max(c, 0.0);
  return vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

/**
 * Light adds to what is behind it, page included: colour and alpha both add,
 * so the canvas stays premultiplied and the dark of the page shows through.
 * The fragment shader writes `gl_FragColor = light(colour)`.
 */
export function lightMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, IUniform>,
  side: Material["side"] = DoubleSide,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader: `${LIGHT_OUT}\n${fragmentShader}`,
    uniforms,
    transparent: true,
    depthWrite: false,
    side,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  });
}

/** Glyph tiles per row of the atlas. */
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(GLYPHS.length / ATLAS_COLS);
export const GLYPH_COUNT = GLYPHS.length;

/**
 * GLSL: the alpha of glyph `g` at point-sprite coordinate `pc`. Declare
 * `uniform sampler2D uAtlas` before it.
 */
export const GLYPH_AT = /* glsl */ `
float glyphAt(float g, vec2 pc) {
  vec2 tile = vec2(mod(g, ${ATLAS_COLS}.0), floor(g / ${ATLAS_COLS}.0));
  return texture2D(uAtlas, (tile + pc) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0)).a;
}`;

/** The glyphs of the Enter page, white on clear: the shaders tint them. */
export function glyphAtlas(): CanvasTexture {
  const tile = 64;
  const canvas = document.createElement("canvas");
  canvas.width = tile * ATLAS_COLS;
  canvas.height = tile * ATLAS_ROWS;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = `${tile * 0.72}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = tile * 0.08;
    GLYPHS.forEach((glyph, index) => {
      ctx.save();
      ctx.translate(
        ((index % ATLAS_COLS) + 0.5) * tile,
        (Math.floor(index / ATLAS_COLS) + 0.5) * tile,
      );
      // The film shows its katakana mirrored.
      if (index < KANA.length) ctx.scale(-1, 1);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    });
  }
  const texture = new CanvasTexture(canvas);
  // Rows from the top, as `gl_PointCoord` reads them.
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}
