/**
 * The logo of the panel as a relief (Three.js). The ink of the picture is
 * traced (`logo-trace.ts`) and every piece of it stands up out of the panel
 * as its own stroke: a bevelled extrusion in the ink of the vibe.
 *
 * The pointer is a torch: a spot light rides over the relief, so the bevels
 * catch it and the strokes cast their shadows into its pool of haze. The
 * relief turns a little towards it. Nothing is drawn while nothing moves.
 *
 * Every colour comes from the CSS tokens of the vibe (`--accent`, `--haze`)
 * and is read again when the vibe changes. With less motion (`data-calm`)
 * the relief keeps still and the torch lights the whole logo at once.
 *
 * This module imports `three`. Load it with a dynamic `import()` only.
 */

import {
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HalfFloatType,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  NoToneMapping,
  OneFactor,
  OrthographicCamera,
  PCFShadowMap,
  Path,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShaderMaterial,
  Shape,
  SpotLight,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  ZeroFactor,
} from "three";
import type { BufferGeometry, Texture } from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

import { CELL_ASPECT, fitColumns, glyphRamp } from "#/lib/ascii-art";
import { STORM_MS } from "#/lib/glyph-storm";
import type { StormKind } from "#/lib/glyph-storm";
import { maskFromRgba, traceShapes } from "#/lib/logo-trace";
import type { Point, TracedShape } from "#/lib/logo-trace";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { approach, rgbOf } from "#/lib/three-ink";
import type { Rgb } from "#/lib/three-ink";

/* ───────── Tuning ───────── */

/** Long side of the picture the ink is traced from, in pixels. */
const TRACE_SIZE = 640;
/** World units: the picture is 1 wide. A stroke of the logo is about 0.045. */
const DEPTH = 0.032;
const BEVEL_THICKNESS = 0.008;
const BEVEL_SIZE = 0.0065;
/** Normals are smoothed across folds flatter than this (bevel steps, curves). */
const CREASE = 0.62;

const FOV = 24;
/** The relief leans back a little at rest, so its walls show. */
const REST_PITCH = -0.16;
const REST_YAW = 0.07;
/** The most the pointer turns it, in radians. */
const TILT_YAW = 0.2;
const TILT_PITCH = 0.14;
/** The camera drifts against the turn, as a share of the picture. */
const DRIFT = 0.035;

/** The torch: height over the relief, cone, and power at that height. */
const TORCH_HEIGHT = 0.3;
const TORCH_ANGLE = 0.72;
const TORCH_POWER = 0.55;
/** Lighting the whole logo (keyboard focus, or a calm hover). */
const WHOLE_HEIGHT = 1.05;
/** Light on the whole logo, next to the torch's: softer, it is a wash. */
const WHOLE_POWER = 0.62;
/** How much haze the pool of the torch leaves on the panel; less for a wash. */
const POOL = 0.34;
const WHOLE_POOL = 0.03;
/** Ink that is there but not lit, and how dark its walls are next to its face. */
const REST_GLOW = 0.2;
const WALL_GLOW = 0.32;

/** The most the pool of light reaches past the bottom of the logo, in CSS px. */
const BLEED_MAX = 64;

/**
 * The glyph storm: how wide its band is (in logo heights), how long a stroke
 * takes to rise once the band reaches it (in band widths), and how high a
 * ripple lifts a stroke (world units).
 */
const BAND: Record<StormKind, number> = { reveal: 0.18, ripple: 0.11 };
const RISE = 1.7;
const LIFT = 0.035;
/** A pointer that comes back sooner than this after a ripple starts none. */
const STORM_REST_MS = 1400;
/** The scrambled glyphs change this often. */
const SCRAMBLE_MS = 50;
/** The glyphs of the storm are never smaller than this, in CSS pixels. */
const MIN_GLYPH = 4.4;

/** Damping per 60 Hz frame. */
const RATE_TORCH = 0.22;
const RATE_TILT = 0.06;
const RATE_LIGHT = 0.12;

/* ───────── Types ───────── */

export interface LogoStageOptions {
  canvas: HTMLCanvasElement;
  /** The box of the logo: the picture fills it exactly. */
  frame: HTMLElement;
  /** Where the light may fall: the canvas spans its width, from its top to below the logo. */
  room: HTMLElement;
  /** Takes the pointer and the focus: the link around the logo. */
  host: HTMLElement;
  /** The logo, decoded. */
  image: HTMLImageElement;
  /** The most glyphs across the logo in a glyph storm, as in the ASCII logo. */
  columns: number;
  /** Called once the first frame is on screen. */
  onReady: () => void;
}

export interface LogoStage {
  /**
   * The page is in view: the relief may build itself (the reveal). Until
   * then nothing is drawn, unless motion is reduced.
   */
  start(): void;
  dispose(): void;
}

interface Inks {
  accent: Rgb;
  haze: Rgb;
}

function readInks(): Inks {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: rgbOf(style.getPropertyValue("--accent"), [0.8, 1, 0]),
    haze: rgbOf(style.getPropertyValue("--haze"), [0.56, 0, 1]),
  };
}

/** A token colour (sRGB, 0..1) as linear light, scaled. */
const linear = ([r, g, b]: Rgb, scale = 1) => new Color().setRGB(r, g, b).multiplyScalar(scale);

/* ───────── Ink ───────── */

/** The traced shapes of a picture, and its size in pixels of the trace. */
interface Traced {
  shapes: TracedShape[];
  width: number;
  height: number;
}

/**
 * Traces, by picture. Every document opens a new page and a new relief, but
 * the logo is the same picture: it is traced once.
 */
const traces = new Map<string, Traced>();

function traceImage(image: HTMLImageElement): Traced {
  const key = image.currentSrc || image.src;
  const known = traces.get(key);
  if (known) return known;
  const scale = TRACE_SIZE / Math.max(image.naturalWidth, image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D canvas to trace the logo with.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const traced = { shapes: traceShapes(maskFromRgba(data, width, height)), width, height };
  traces.set(key, traced);
  return traced;
}

/** One stroke of the relief, and where its middle is on the picture. */
interface Stroke {
  mesh: Mesh;
  centre: Vector2;
}

/**
 * The strokes, in world units: the picture is 1 wide, centred, y up. The
 * walls stand on the outline; the bevel eats into the face, never out of the
 * outline, so the silhouette stays the picture's own.
 */
function buildStrokes(traced: Traced, material: MeshPhysicalMaterial): Stroke[] {
  const unit = 1 / traced.width;
  const toWorld = ([x, y]: Point) =>
    new Vector2((x - traced.width / 2) * unit, (traced.height / 2 - y) * unit);

  return traced.shapes.map((traced) => {
    const shape = new Shape(traced.outer.map(toWorld));
    shape.holes = traced.holes.map((hole) => new Path(hole.map(toWorld)));

    const extruded = new ExtrudeGeometry(shape, {
      depth: DEPTH,
      steps: 1,
      curveSegments: 1,
      bevelEnabled: true,
      bevelThickness: BEVEL_THICKNESS,
      bevelSize: BEVEL_SIZE,
      bevelOffset: -BEVEL_SIZE,
      bevelSegments: 3,
    });
    // Its back on the panel (z = 0), its face towards the viewer.
    extruded.translate(0, 0, BEVEL_THICKNESS);
    const geometry: BufferGeometry = toCreasedNormals(extruded, CREASE);
    extruded.dispose();

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const centre = new Vector2(
      box ? (box.min.x + box.max.x) / 2 : 0,
      box ? (box.min.y + box.max.y) / 2 : 0,
    );

    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { mesh, centre };
  });
}

/**
 * A dark studio with a few bright cards (the Meng To metal recipe): the
 * bevels and the clear coat reflect hard-edged light, so the relief reads as
 * a solid at rest, with no light on the panel itself.
 */
function studio(renderer: WebGLRenderer): Texture {
  const room = new Scene();
  room.background = new Color(0.012, 0.012, 0.016);
  const card = (width: number, height: number, at: [number, number, number], glow: Rgb) => {
    const mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ color: new Color(...glow), side: DoubleSide, toneMapped: false }),
    );
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  card(3.2, 2.2, [-2.6, 3.2, 3.4], [3.2, 3.1, 2.9]);
  card(0.7, 4.4, [4.2, 0.2, 2.4], [1.3, 1.45, 1.7]);
  card(4.6, 0.7, [0.4, -3.6, 2.2], [0.5, 0.42, 0.34]);
  card(2.4, 1.2, [1.5, 2.6, -3.8], [0.9, 0.9, 1.0]);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.02);
  pmrem.dispose();
  room.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      (object.material as MeshBasicMaterial).dispose();
    }
  });
  return target.texture;
}

/** The glyphs of the ASCII logo, sparsest first, in one row, white on clear. */
interface Atlas {
  texture: CanvasTexture;
  glyphs: number;
  /** Width of a glyph cell over its height. */
  cellAspect: number;
}

function glyphAtlas(): Atlas | null {
  const family =
    getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace";
  const ramp = glyphRamp({ family, weight: "700" });
  if (!ramp) return null;
  const tall = 64;
  const wide = Math.max(1, Math.round(tall * ramp.cellAspect));
  const canvas = document.createElement("canvas");
  canvas.width = wide * ramp.glyphs.length;
  canvas.height = tall;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // The size and baseline `ascii-art.ts` measures with: one line, one glyph.
  ctx.font = `700 ${tall}px ${family}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ramp.glyphs.forEach((glyph, index) => ctx.fillText(glyph, index * wide, tall / 2));
  const texture = new CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  return { texture, glyphs: ramp.glyphs.length, cellAspect: ramp.cellAspect };
}

/** Rises past 1 a little, then settles: a stroke that springs up. */
function springUp(x: number): number {
  const k = x - 1;
  return 1 + 2.5 * k ** 3 + 1.5 * k ** 2;
}

/* ───────── Final pass ───────── */

const FINAL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The relief is rendered in linear light: ink with its coverage in alpha,
 * the pool of the torch added on the panel with no alpha of its own. Here
 * the pool keeps its full light over the logo and fades out on the way to
 * the edge of the canvas, along an ellipse, so it never shows a corner.
 * Light brighter than 1 turns white, and the light becomes premultiplied
 * alpha, so the panel shows through wherever there is no ink and no light.
 *
 * In a glyph storm, a ragged band of cells runs out from `uOrigin`. Inside
 * it the relief turns into the glyphs of the ASCII logo: denser where the
 * relief is brighter, scrambled, hot, with a halo of haze. Ahead of a reveal
 * there is nothing yet.
 */
const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
/** The logo on the canvas, in uv: min xy, max xy. */
uniform vec4 uFrame;
/** The room past each side of the logo, in uv: left, bottom, right, top. */
uniform vec4 uBleed;
uniform sampler2D uAtlas;
/** Cells of the storm across and down the logo. */
uniform vec2 uCells;
uniform float uGlyphs;
/** Width of the logo over its height. */
uniform float uAspect;
/** 0: no storm, 1: reveal, 2: ripple. */
uniform float uStorm;
/** Where the storm runs out from, and how far it is, on the logo (uv; logo heights). */
uniform vec2 uOrigin;
uniform float uRadius;
uniform float uBand;
uniform float uTick;
uniform vec3 uSpark;
uniform vec3 uHaze;
varying vec2 vUv;

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 relief(vec2 uv) {
  vec4 scene = texture2D(uScene, uv);
  vec3 colour = scene.rgb;

  vec2 past = max(max(uFrame.xy - uv, 0.0) / uBleed.xy, max(uv - uFrame.zw, 0.0) / uBleed.zw);
  float edge = 1.0 - smoothstep(0.0, 1.0, length(past));
  colour *= mix(edge * edge, 1.0, scene.a);

  float peak = max(colour.r, max(colour.g, colour.b));
  colour = min(colour + max(peak - 1.0, 0.0) * 0.7, vec3(1.0));
  colour = toSrgb(max(colour, 0.0));

  float alpha = max(scene.a, max(colour.r, max(colour.g, colour.b)));
  return vec4(colour, clamp(alpha, 0.0, 1.0));
}

/*
 * One cell of the storm: the glyph whose ink matches the light there,
 * scrambled. The atlas is read with the gradient of the unbroken cell grid,
 * taken before any branch: fract() breaks at every cell edge, and its own
 * gradient would pick the smallest mip there and draw a box around each glyph.
 */
vec4 glyph(vec2 cell, vec2 grid, vec2 gridX, vec2 gridY) {
  vec2 at = uFrame.xy + (cell + 0.5) / uCells * (uFrame.zw - uFrame.xy);
  vec4 scene = texture2D(uScene, at);
  if (scene.a < 0.3 || uGlyphs < 1.0) return relief(vUv);

  vec3 lit = scene.rgb / scene.a;
  float tone = pow(clamp(max(lit.r, max(lit.g, lit.b)), 0.0, 1.0), 0.45);
  float index = floor(tone * (uGlyphs - 1.0) + 0.5) + floor((hash(cell + uTick) - 0.5) * 7.0);
  index = clamp(index, 0.0, uGlyphs - 1.0);

  vec2 inCell = fract(grid);
  vec2 tile = vec2((index + inCell.x) / uGlyphs, inCell.y);
  vec2 scale = vec2(1.0 / uGlyphs, 1.0);
  float ink = textureGrad(uAtlas, tile, gridX * scale, gridY * scale).a;

  vec3 colour = toSrgb(min(uSpark * ink * (0.6 + 0.6 * tone), vec3(1.0)));
  return vec4(colour, clamp(max(ink, max(colour.r, max(colour.g, colour.b))), 0.0, 1.0));
}

void main() {
  if (uStorm < 0.5) {
    gl_FragColor = relief(vUv);
    return;
  }
  vec2 onLogo = (vUv - uFrame.xy) / (uFrame.zw - uFrame.xy);
  vec2 grid = onLogo * uCells;
  vec2 gridX = dFdx(grid);
  vec2 gridY = dFdy(grid);
  vec2 cell = floor(grid);
  vec2 centre = (cell + 0.5) / uCells;
  float ahead = length((centre - uOrigin) * vec2(uAspect, 1.0)) - uRadius;
  // A ragged band, a cell at a time.
  ahead += (hash(cell * 1.7) - 0.5) * uBand * 0.6;

  vec4 colour;
  if (abs(ahead) < uBand * 0.5) colour = glyph(cell, grid, gridX, gridY);
  else if (uStorm < 1.5 && ahead > 0.0) colour = vec4(0.0);
  else colour = relief(vUv);

  // The haze of the storm: a soft ring over the ink it passes, never boxed in cells.
  float ring = length((onLogo - uOrigin) * vec2(uAspect, 1.0)) - uRadius;
  // Squared by hand: pow() of a negative number is undefined in GLSL.
  float spread = ring / (uBand * 0.55);
  float haze = exp(-spread * spread) * texture2D(uScene, vUv).a;
  vec3 glow = uHaze * haze * 0.2;
  gl_FragColor = vec4(colour.rgb + glow, max(colour.a, max(glow.r, max(glow.g, glow.b))));
}`;

/* ───────── Stage ───────── */

export function mountLogo({
  canvas,
  frame: logo,
  room,
  host,
  image,
  columns,
  onReady,
}: LogoStageOptions): LogoStage {
  const traced = traceImage(image);
  if (traced.shapes.length === 0) throw new Error("The logo has no ink to trace.");

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  let inks = readInks();
  const environment = studio(renderer);

  /* ───────── Scene ───────── */

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 20);
  const relief = new Group();
  relief.rotation.set(REST_PITCH, REST_YAW, 0);
  scene.add(relief);

  const ink = new MeshPhysicalMaterial({
    color: linear(inks.accent, 0.55),
    emissive: linear(inks.accent),
    emissiveIntensity: REST_GLOW,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMap: environment,
    envMapIntensity: 1,
  });
  const wallGlow = { value: WALL_GLOW };
  // Faces glow in full, walls darker: the relief reads as a solid with no
  // light at all.
  ink.onBeforeCompile = (shader) => {
    shader.uniforms.uWallGlow = wallGlow;
    shader.fragmentShader = `uniform float uWallGlow;\n${shader.fragmentShader}`.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      totalEmissiveRadiance *= mix(uWallGlow, 1.0, smoothstep(0.3, 0.95, normal.z));`,
    );
  };
  ink.customProgramCacheKey = () => "logo-ink";

  const strokes = buildStrokes(traced, ink);
  for (const stroke of strokes) relief.add(stroke.mesh);

  // The panel under the relief: it shows only the light of the torch, added
  // to the page, with the shadows of the strokes cut out of it.
  const pool = new MeshLambertMaterial({
    color: linear(inks.haze, POOL),
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  const ground = new Mesh(new PlaneGeometry(3, 3), pool);
  ground.receiveShadow = true;
  ground.renderOrder = 1;
  relief.add(ground);

  const torch = new SpotLight(0xffffff, 0, 0, TORCH_ANGLE, 1, 2);
  torch.castShadow = true;
  torch.shadow.mapSize.set(1024, 1024);
  torch.shadow.radius = 5;
  torch.shadow.bias = -0.0004;
  torch.shadow.normalBias = 0.003;
  torch.shadow.camera.near = 0.05;
  torch.shadow.camera.far = 3;
  relief.add(torch, torch.target);

  const paintInks = () => {
    ink.color.copy(linear(inks.accent, 0.55));
    ink.emissive.copy(linear(inks.accent));
    // White, tinted with the ink of the vibe.
    torch.color.copy(linear(inks.accent).lerp(new Color(1, 1, 1), 0.62));
    // The storm burns hot: the ink of the vibe gone part white.
    uniforms.uSpark.value.copy(linear(inks.accent).lerp(new Color(1, 1, 1), 0.25));
    uniforms.uHaze.value.copy(linear(inks.haze));
  };

  /* ───────── Final pass ───────── */

  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  const atlas = glyphAtlas();
  const uniforms = {
    uScene: { value: target.texture },
    uFrame: { value: new Vector4(0, 0, 1, 1) },
    uBleed: { value: new Vector4(1, 1, 1, 1) },
    uAtlas: { value: atlas?.texture ?? null },
    uCells: { value: new Vector2(columns, columns) },
    uGlyphs: { value: atlas?.glyphs ?? 0 },
    uAspect: { value: 1 },
    uStorm: { value: 0 },
    uOrigin: { value: new Vector2(0.5, 0.5) },
    uRadius: { value: 0 },
    uBand: { value: BAND.reveal },
    uTick: { value: 0 },
    uSpark: { value: new Color() },
    uHaze: { value: new Color() },
  };
  paintInks();
  const finalMaterial = new ShaderMaterial({
    vertexShader: FINAL_VERTEX,
    fragmentShader: FINAL_FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const finalScene = new Scene();
  const finalQuad = new Mesh(new PlaneGeometry(2, 2), finalMaterial);
  finalQuad.frustumCulled = false;
  finalScene.add(finalQuad);
  const finalCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /* ───────── Size ───────── */

  const picture = { width: 1, height: traced.height / traced.width };
  let rect = canvas.getBoundingClientRect();
  let frameRect = logo.getBoundingClientRect();
  let distance = 3;
  /** The logo has had a size: the reveal can be seen. */
  let sized = false;

  /**
   * The canvas is larger than the logo, so the pool of the torch has room to
   * stay round: the width of the room, from its top to a little below the
   * logo. The camera frames the logo's box and looks through the larger
   * canvas around it (`setViewOffset`), so the relief stands where the
   * picture would.
   */
  function measure() {
    frameRect = logo.getBoundingClientRect();
    const box = room.getBoundingClientRect();
    const frameWidth = frameRect.width;
    const frameHeight = frameRect.height;
    if (frameWidth <= 0 || frameHeight <= 0) return;

    const left = box.left + room.clientLeft;
    const top = box.top + room.clientTop;
    const width = Math.max(room.clientWidth, frameWidth);
    const side = Math.max(0, Math.min(frameRect.left - left, left + width - frameRect.right));
    const above = Math.max(0, frameRect.top - top);
    const below = Math.min(Math.max(side, above), BLEED_MAX);
    const height = above + frameHeight + below;
    const x = left - frameRect.left;
    const y = top - frameRect.top;

    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    const buffer = renderer.getDrawingBufferSize(new Vector2());
    target.setSize(buffer.x, buffer.y);

    // The whole picture fills the logo's box, as the picture itself would.
    camera.aspect = frameWidth / frameHeight;
    const tall = Math.max(picture.height, picture.width / camera.aspect);
    distance = tall / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
    camera.setViewOffset(frameWidth, frameHeight, x, y, width, height);

    // The logo on the canvas, in uv (y up), and the room past each side.
    const minX = -x / width;
    const maxX = (frameWidth - x) / width;
    const maxY = 1 - -y / height;
    const minY = 1 - (frameHeight - y) / height;
    const least = 1 / Math.max(width, height);
    finalMaterial.uniforms.uFrame.value.set(minX, minY, maxX, maxY);
    finalMaterial.uniforms.uBleed.value.set(
      Math.max(minX, least),
      Math.max(minY, least),
      Math.max(1 - maxX, least),
      Math.max(1 - maxY, least),
    );

    // The cells of the storm: as many and as big as the ASCII logo's.
    const across = fitColumns(frameWidth, columns, MIN_GLYPH);
    const cellAspect = atlas?.cellAspect ?? CELL_ASPECT;
    uniforms.uCells.value.set(
      across,
      Math.max(1, Math.round((across * cellAspect) / camera.aspect)),
    );
    uniforms.uAspect.value = camera.aspect;
    sized = true;

    rect = canvas.getBoundingClientRect();
    wake();
  }

  /* ───────── Pointer and focus ───────── */

  /**
   * Where the pointer is, -1..1, y up: on the canvas (to aim the torch) and
   * on the logo (to turn it); and whether it is on.
   */
  const pointer = { x: 0, y: 0, tiltX: 0, tiltY: 0, on: false };
  let focused = false;

  /** Eased state: tilt, light, and the torch's place on the relief. */
  const tilt = { x: 0, y: 0 };
  const light = { lit: 0, whole: 0 };
  const spot = new Vector2(0, 0);
  let spotPlaced = false;

  const raycaster = new Raycaster();
  const panel = new Plane();
  const hit = new Vector3();

  /** The point of the relief under the pointer, in its own coordinates. */
  function aimed(): Vector2 | null {
    relief.updateMatrixWorld();
    const normal = new Vector3(0, 0, 1).transformDirection(relief.matrixWorld);
    panel.setFromNormalAndCoplanarPoint(
      normal,
      new Vector3().setFromMatrixPosition(relief.matrixWorld),
    );
    raycaster.setFromCamera(new Vector2(pointer.x, pointer.y), camera);
    if (!raycaster.ray.intersectPlane(panel, hit)) return null;
    relief.worldToLocal(hit);
    return new Vector2(hit.x, hit.y);
  }

  const listeners = new AbortController();
  const { signal } = listeners;

  const onPointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (event.type === "pointerenter") {
      rect = canvas.getBoundingClientRect();
      frameRect = logo.getBoundingClientRect();
    }
    pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    pointer.y = 1 - ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2;
    pointer.tiltX = ((event.clientX - frameRect.left) / Math.max(frameRect.width, 1)) * 2 - 1;
    pointer.tiltY = 1 - ((event.clientY - frameRect.top) / Math.max(frameRect.height, 1)) * 2;
    pointer.on = true;
    wake();
  };
  host.addEventListener("pointerenter", onPointer, { signal });
  host.addEventListener("pointermove", onPointer, { signal, passive: true });
  const onLeave = () => {
    pointer.on = false;
    wake();
  };
  host.addEventListener("pointerleave", onLeave, { signal });
  host.addEventListener("pointercancel", onLeave, { signal });
  // The keyboard has no torch to aim: focus lights the whole logo.
  host.addEventListener(
    "focus",
    () => {
      focused = host.matches(":focus-visible");
      wake();
    },
    { signal },
  );
  host.addEventListener(
    "blur",
    () => {
      focused = false;
      wake();
    },
    { signal },
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) sleep();
      else wake();
    },
    { signal },
  );
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      sleep();
    },
    { signal },
  );
  canvas.addEventListener("webglcontextrestored", () => wake(), { signal });

  // The logo and the room, never the canvas: `measure` sizes the canvas.
  const resizes = new ResizeObserver(() => measure());
  resizes.observe(logo);
  resizes.observe(room);

  // A new vibe brings new ink; `data-calm` stills the relief.
  const attributes = new MutationObserver(() => {
    inks = readInks();
    paintInks();
    wake();
  });
  attributes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-vibe", "data-calm"],
  });

  /* ───────── Glyph storm ───────── */

  const storm = {
    kind: null as StormKind | null,
    start: 0,
    /** Where it runs out from, 0..1 across the logo, y up. */
    origin: new Vector2(0.5, 0.5),
    /** Its last radius, past the farthest corner of the logo. */
    reach: 1,
    /** Width of its band: wide for the reveal, thinner for a ripple. */
    band: BAND.reveal,
    restUntil: 0,
  };
  /** With less motion the relief is simply there: no reveal. */
  let revealed = prefersReducedMotion();
  /** The page lets the reveal run (`start`). */
  let started = false;
  const onScreen = new Vector3();

  function startStorm(kind: StormKind, origin: Vector2, now: number) {
    storm.kind = kind;
    storm.start = now;
    storm.origin.copy(origin);
    storm.restUntil = now + STORM_REST_MS;
    let reach = 0;
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      reach = Math.max(reach, Math.hypot((x - origin.x) * camera.aspect, y - origin.y));
    }
    storm.band = BAND[kind];
    storm.reach = reach + storm.band;
    uniforms.uBand.value = storm.band;
    wake();
  }

  function endStorm() {
    storm.kind = null;
    uniforms.uStorm.value = 0;
    for (const stroke of strokes) {
      stroke.mesh.scale.z = 1;
      stroke.mesh.position.z = 0;
    }
  }

  // A ripple runs from where the pointer comes on the logo.
  host.addEventListener(
    "pointerenter",
    (event) => {
      const now = performance.now();
      if (event.pointerType === "touch" || prefersReducedMotion() || !revealed) return;
      if (storm.kind || now < storm.restUntil) return;
      startStorm("ripple", new Vector2((pointer.tiltX + 1) / 2, (pointer.tiltY + 1) / 2), now);
    },
    { signal },
  );

  /** Moves the storm on to `now`. `true` while it still runs. */
  function stepStorm(now: number, calm: boolean): boolean {
    // The reveal waits for a logo that can be seen, on a page in view. Until
    // then the logo is all ahead of it: nothing is drawn.
    if (!revealed && sized && started) {
      revealed = true;
      startStorm("reveal", new Vector2(0.5, 0.5), now);
    }
    if (!revealed) {
      uniforms.uStorm.value = 1;
      uniforms.uRadius.value = -1;
      return false;
    }
    if (!storm.kind) return false;

    const t = Math.max(0, (now - storm.start) / STORM_MS[storm.kind]);
    if (t >= 1 || calm) {
      endStorm();
      return false;
    }

    const radius = (1 - (1 - t) ** 2) * storm.reach;
    uniforms.uStorm.value = storm.kind === "reveal" ? 1 : 2;
    uniforms.uOrigin.value.copy(storm.origin);
    uniforms.uRadius.value = radius;
    uniforms.uTick.value = Math.floor(now / SCRAMBLE_MS) % 997;

    // Each stroke rises (reveal) or lifts (ripple) as the band passes its middle.
    const logoBox = uniforms.uFrame.value;
    relief.updateMatrixWorld();
    for (const stroke of strokes) {
      onScreen
        .set(stroke.centre.x, stroke.centre.y, DEPTH / 2)
        .applyMatrix4(relief.matrixWorld)
        .project(camera);
      const u = ((onScreen.x + 1) / 2 - logoBox.x) / (logoBox.z - logoBox.x);
      const v = ((onScreen.y + 1) / 2 - logoBox.y) / (logoBox.w - logoBox.y);
      const away = Math.hypot((u - storm.origin.x) * camera.aspect, v - storm.origin.y);
      if (storm.kind === "reveal") {
        const rise = Math.min(Math.max((radius - away) / (storm.band * RISE), 0), 1);
        stroke.mesh.scale.z = Math.max(springUp(rise), 1e-3);
      } else {
        stroke.mesh.position.z = LIFT * Math.exp(-(((away - radius) / (storm.band * 0.6)) ** 2));
      }
    }
    return true;
  }

  /* ───────── Frame ───────── */

  let frame = 0;
  let last = 0;
  let ready = false;

  function sleep() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function wake() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function draw(now: number) {
    frame = 0;
    // A long gap (a hidden tab, a first frame) counts as one frame.
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    const calm = prefersReducedMotion();
    let busy = false;

    const ease = (from: number, to: number, rate: number) => {
      const next = approach(from, to, rate, dt);
      if (Math.abs(next - to) < 1e-4) return to;
      busy = true;
      return next;
    };

    // Tilt: towards the pointer, never with less motion.
    const turn = pointer.on && !calm;
    tilt.x = ease(tilt.x, turn ? pointer.tiltX : 0, RATE_TILT);
    tilt.y = ease(tilt.y, turn ? pointer.tiltY : 0, RATE_TILT);
    relief.rotation.set(REST_PITCH - tilt.y * TILT_PITCH, REST_YAW + tilt.x * TILT_YAW, 0);
    camera.position.set(-tilt.x * DRIFT, -tilt.y * DRIFT * 0.6, distance);
    camera.lookAt(camera.position.x * 0.42, camera.position.y * 0.42, 0);
    camera.updateMatrixWorld();

    // The torch: aimed at the pointer, or over the whole logo.
    const whole = focused || (calm && pointer.on);
    light.lit = ease(light.lit, pointer.on || focused ? 1 : 0, RATE_LIGHT);
    light.whole = ease(light.whole, whole ? 1 : 0, RATE_LIGHT);
    if (pointer.on && !whole) {
      const point = aimed();
      if (point) {
        if (!spotPlaced) spot.copy(point);
        spotPlaced = true;
        spot.x = ease(spot.x, point.x, RATE_TORCH);
        spot.y = ease(spot.y, point.y, RATE_TORCH);
      }
    } else if (whole) {
      spot.x = ease(spot.x, 0, RATE_LIGHT);
      spot.y = ease(spot.y, 0, RATE_LIGHT);
    }
    if (light.lit === 0) spotPlaced = false;

    const height = TORCH_HEIGHT + (WHOLE_HEIGHT - TORCH_HEIGHT) * light.whole;
    torch.position.set(spot.x, spot.y - height * 0.18, height);
    torch.target.position.set(spot.x, spot.y, 0);
    // The same light on the relief, however high the torch is held.
    // Never hidden: a light that comes and goes would compile the shaders again.
    const power = TORCH_POWER * (1 + (WHOLE_POWER - 1) * light.whole);
    torch.intensity = power * light.lit * (height / TORCH_HEIGHT) ** 2;
    // A wash over the whole logo would flood the panel: its pool stays faint.
    pool.color.setRGB(...inks.haze).multiplyScalar(POOL + (WHOLE_POOL - POOL) * light.whole);

    if (stepStorm(now, calm)) busy = true;

    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(finalScene, finalCamera);

    if (!ready) {
      ready = true;
      onReady();
    }
    if (busy) frame = requestAnimationFrame(draw);
    else last = 0;
  }

  measure();
  wake();

  return {
    start() {
      started = true;
      wake();
    },
    dispose() {
      sleep();
      listeners.abort();
      resizes.disconnect();
      attributes.disconnect();
      for (const stroke of strokes) stroke.mesh.geometry.dispose();
      ground.geometry.dispose();
      finalQuad.geometry.dispose();
      ink.dispose();
      pool.dispose();
      finalMaterial.dispose();
      atlas?.texture.dispose();
      environment.dispose();
      target.dispose();
      torch.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
