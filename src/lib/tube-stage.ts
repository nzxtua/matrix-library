/**
 * The tube stage: the 3D room behind the library (Three.js, WebGL 2).
 *
 * One glass tube per document stands on a curved shelf to the right of the
 * wordmark, like the pods of the film: each holds ink up to the share the
 * reader has lit. The digital rain of the Enter page falls in depth around
 * them, brighter where the beam from above crosses it, and the floor is a
 * faint grid that the pods light. The pointer turns the room a little (a
 * damped orbit). A card under the pointer, or in focus, lifts its pod and
 * drops the room into bullet time: the rain all but stops.
 *
 * Every colour comes from the CSS tokens of the vibe (`--accent`, `--accent-2`,
 * `--haze`). The room reads them again when the vibe changes.
 *
 * With less motion (`html[data-calm]`) the room is a still: no entrance, no
 * drift, the orbit at a fixed three-quarter pose. It draws again only when
 * something it shows changes.
 *
 * This module imports `three`. Load it with a dynamic `import()` only, so that
 * the server and the other pages never pay for it.
 */

import {
  CatmullRomCurve3,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import type { Material, Object3D } from "three";

import { GLYPH_AT, GLYPH_COUNT, approach, glyphAtlas, lightMaterial, rgbOf } from "#/lib/three-ink";
import type { Rgb } from "#/lib/three-ink";

/* ─────────────────────────────── Geometry ─────────────────────────────── */

/** Field of view of the camera, degrees. Narrow: the room reads as a lens, not a fisheye. */
export const FOV = 30;
/** Distance of the camera from the plane the shelf is placed on. */
export const CAMERA_Z = 14;
/** Height of a tube, in room units. */
const TUBE_H = 1.7;
const TUBE_R = 0.2;
/** Radius of the arc the tubes stand on. */
const ARC_R = 3.2;
/** The floor, under the bases. */
const FLOOR_Y = -TUBE_H / 2 - 0.16;
/** The shader keeps this many lamps on the floor. More tubes still stand. */
const MAX_LAMPS = 16;

/** Spacing between tube centres: closer when the shelf is long. */
export function spacingFor(count: number): number {
  return count <= 7 ? 0.62 : Math.max(0.36, 4.3 / (count - 1));
}

/** Where tube `index` of `count` stands, in shelf units: on an arc that bows away from the reader. */
export function slotOf(index: number, count: number): { x: number; z: number } {
  const angle = ((index - (count - 1) / 2) * spacingFor(count)) / ARC_R;
  return { x: Math.sin(angle) * ARC_R, z: Math.cos(angle) * ARC_R - ARC_R };
}

/** Width of the shelf, tube edge to tube edge, in shelf units. */
export function shelfWidth(count: number): number {
  const first = slotOf(0, count);
  const last = slotOf(count - 1, count);
  return last.x - first.x + TUBE_R * 2.6;
}

/** World units per CSS pixel on the plane `z = 0`, for a viewport `height` px tall. */
export function unitsPerPixel(height: number): number {
  return (2 * CAMERA_Z * Math.tan(((FOV / 2) * Math.PI) / 180)) / Math.max(height, 1);
}

export interface Placement {
  /** Centre of the shelf in the room, on `z = 0`. */
  x: number;
  y: number;
  /** Scale of the shelf group. */
  scale: number;
  /** Overall light of the tubes: lower where text lies over them. */
  power: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** The header box in page coordinates (not viewport): it is read on resize only. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How much slower than the page the shelf scrolls: it reads as further away. */
export const PARALLAX = 0.85;

/**
 * Where the shelf stands for a header `box`, a viewport and a scroll position.
 * Wide: right of the wordmark, as tall as the poster allows. Narrow: smaller,
 * behind the end of the title, and dimmer, since the title is set over it.
 */
export function place(box: Box, view: Viewport, scrollY: number, count: number): Placement {
  const narrow = view.width < 640;
  const pxWide = narrow ? view.width * 0.42 : Math.min(Math.max(view.width * 0.3, 260), 520);
  const unit = unitsPerPixel(view.height);
  // The tallest the tubes may be: inside the header, with room to breathe.
  const pxTall = box.height * (narrow ? 0.7 : 0.82);
  const scale = Math.min((pxWide * unit) / shelfWidth(count), (pxTall * unit) / (TUBE_H + 0.5));

  const sx = narrow ? view.width * 0.8 : box.left + box.width - pxWide / 2;
  const sy = box.top + box.height * (narrow ? 0.26 : 0.56) - scrollY * PARALLAX;

  return {
    x: (sx - view.width / 2) * unit,
    y: -(sy - view.height / 2) * unit,
    scale,
    power: narrow ? 0.55 : 1,
  };
}

/* ───────────────────────────────── Ink ───────────────────────────────── */

interface Inks {
  accent: Rgb;
  accent2: Rgb;
  haze: Rgb;
}

function readInks(): Inks {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: rgbOf(style.getPropertyValue("--accent"), [0.8, 1, 0]),
    accent2: rgbOf(style.getPropertyValue("--accent-2"), [1, 0.24, 0.86]),
    haze: rgbOf(style.getPropertyValue("--haze"), [0.56, 0, 1]),
  };
}

/* ─────────────────────────────── Shaders ─────────────────────────────── */

/** World normal, view direction, local position, uv. */
const SURFACE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - world.xyz);
  vLocal = position;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** The glass: a rim where it turns away, one long highlight from the key light. */
const GLASS_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uGlow;
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  float facing = abs(dot(n, normalize(vV)));
  float rim = pow(1.0 - facing, 3.0);
  vec3 key = normalize(vec3(-0.55, 0.25, 0.8));
  float streak = smoothstep(0.93, 0.99, dot(n, key)) * (gl_FrontFacing ? 1.0 : 0.0);
  float ends = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
  vec3 glass = mix(vec3(0.86, 0.88, 0.84), uInk, 0.25 + 0.35 * uGlow);
  vec3 c = glass * (rim * 0.75 + 0.035) + vec3(1.0) * streak * (0.22 + 0.2 * uGlow);
  c *= ends * uPower * (gl_FrontFacing ? 1.0 : 0.4);
  gl_FragColor = light(c);
}`;

/** The ink: darker at the bottom, a lit surface that sways a little. */
const INK_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uFill;
uniform float uHeight;
uniform float uTime;
uniform float uGlow;
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
void main() {
  if (uFill <= 0.002) discard;
  float y = vLocal.y / uHeight + 0.5;
  float swirl = atan(vLocal.z, vLocal.x);
  float level = uFill + sin(swirl * 2.0 + uTime * 1.7) * 0.005;
  if (y > level) discard;
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float depth = y / max(level, 0.001);
  vec3 c = uInk * (0.14 + 0.42 * depth * depth + 0.55 * rim);
  float surface = smoothstep(level - 0.04, level, y);
  c += mix(uInk, vec3(1.0), 0.35) * surface * 0.8;
  // Slow light rising through the ink.
  float bubbles = smoothstep(0.92, 1.0, sin(swirl * 5.0 + y * 40.0 - uTime * 2.4));
  c += uInk * bubbles * 0.12 * depth;
  gl_FragColor = light(c * uPower * (0.8 + 0.45 * uGlow));
}`;

/** The surface of the ink, seen from above: a lit ring at the glass. */
const MENISCUS_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uPower;
uniform float uGlow;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  vec3 c = uInk * (0.2 + 0.9 * smoothstep(0.55, 1.0, r) * smoothstep(1.02, 0.94, r));
  gl_FragColor = light(c * uPower * (0.8 + 0.5 * uGlow));
}`;

/** The filament: the tube warming up. */
const FILAMENT_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uPower;
uniform float uWarm;
void main() {
  gl_FragColor = light(mix(uInk, vec3(1.0), 0.35) * uWarm * uPower * 0.9);
}`;

/** A glow behind a tube, always facing the camera. */
const HALO_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uAmp;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(2.4, 1.0);
  float d = dot(p, p);
  gl_FragColor = light(uInk * exp(-d * 7.0) * uAmp);
}`;

/** Base and cap of a tube: dark metal with a hairline of light on its rim. */
const METAL_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uHere;
uniform float uPower;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN);
  float rim = pow(1.0 - abs(dot(n, normalize(vV))), 2.5);
  float top = smoothstep(0.75, 1.0, n.y);
  vec3 c = vec3(0.063, 0.067, 0.086) + vec3(0.9) * rim * 0.22 + vec3(1.0) * top * 0.05;
  c += uInk * uHere * (rim * 0.7 + top * 0.25);
  gl_FragColor = vec4(c * mix(0.35, 1.0, uPower), 1.0);
}`;

/** The floor: a grid that fades into the dark, pools of light under the tubes. */
const FLOOR_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = vec2(position.x, -position.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLOOR_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uHaze;
uniform vec4 uLamps[${MAX_LAMPS}];
uniform int uCount;
uniform vec3 uRing;
uniform float uPower;
uniform float uTime;
varying vec2 vP;
void main() {
  vec2 p = vP;
  float fade = exp(-dot(p, p) * 0.18) * smoothstep(5.5, 3.0, length(p));
  vec2 cell = p * 2.5;
  vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
  float grid = 1.0 - min(min(g.x, g.y), 1.0);
  vec3 c = uInk * grid * 0.09 * fade + uHaze * fade * 0.05;
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uCount) break;
    vec4 lamp = uLamps[i];
    vec2 d = p - lamp.xy;
    c += uInk * lamp.z * exp(-dot(d, d) * 9.0) * 0.3;
    // Its reflection, drawn out toward the reader.
    float toward = max(d.y, 0.0);
    c += uInk * lamp.z * exp(-d.x * d.x * 90.0) * exp(-toward * 1.6) * step(0.0, d.y) * 0.1;
  }
  // "you were here": a ring on the floor that breathes.
  float ring = abs(length(p - uRing.xy) - 0.34);
  c += uInk * smoothstep(0.022, 0.0, ring) * uRing.z * (0.55 + 0.25 * sin(uTime * 2.0));
  gl_FragColor = light(c * uPower);
}`;

/** The beam from above: a cone of haze with slow rays in it. */
const BEAM_FRAG = /* glsl */ `
uniform vec3 uHaze;
uniform float uPower;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
void main() {
  float soft = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float along = smoothstep(0.0, 0.3, vUv.y) * (0.35 + 0.65 * vUv.y);
  float swirl = atan(vLocal.z, vLocal.x);
  float rays = 0.7 + 0.3 * sin(swirl * 9.0 + uTime * 0.25) * sin(swirl * 4.0 - uTime * 0.17);
  gl_FragColor = light(uHaze * soft * along * rays * 0.075 * uPower);
}`;

/* The digital rain, in depth. A stream is a column of glyph cells that stand
   still; its head walks down them and leaves a fading trail, as on the Enter
   page. Every cell is one point; the GPU walks the heads. */

/** Rows of cells in a stream, and the height of a cell in room units. */
const RAIN_ROWS = 30;
const RAIN_STEP = 0.42;
const RAIN_VERT = /* glsl */ `
attribute vec4 aCell;   // stream x, stream z, row, seed
attribute vec2 aStream; // speed (rows per second), trail length (rows)
uniform float uRain;    // the rain's own clock: bullet time slows it
uniform float uFocal;   // device pixels per room unit at depth 1
uniform vec3 uBeamTop;
uniform vec3 uBeamAxis;
varying float vLevel;
varying float vHead;
varying float vGlyph;
varying float vAlt;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float row = aCell.z;
  float seed = aCell.w;
  float span = ${RAIN_ROWS.toFixed(1)} + aStream.y * 1.6;
  float head = mod(seed * span * 7.0 + uRain * aStream.x, span);
  float behind = head - row;
  float trail = behind >= 0.0 ? exp(-behind / aStream.y * 2.4) : 0.0;
  vHead = behind >= 0.0 && behind < 1.0 ? 1.0 : 0.0;

  // A head writes a fresh glyph; fallen glyphs keep mutating, slowly.
  float tick = floor(uRain * (0.6 + seed * 1.8) + row * 0.37);
  vGlyph = floor(hash(row * 12.9898 + seed * 78.233 + tick) * ${GLYPH_COUNT.toFixed(1)});
  vAlt = step(0.86, hash(seed * 311.7));

  vec3 p = vec3(aCell.x, ${((RAIN_ROWS * RAIN_STEP) / 2).toFixed(3)} - row * ${RAIN_STEP.toFixed(3)}, aCell.y);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec3 rel = world.xyz - uBeamTop;
  float t = max(dot(rel, uBeamAxis), 0.0);
  float off = length(rel - uBeamAxis * t);
  float inBeam = smoothstep(0.42 * t + 0.4, 0.1 * t, off);

  vec4 view = viewMatrix * world;
  float fog = smoothstep(-30.0, -9.0, view.z);
  vLevel = (0.05 + 0.95 * trail) * (0.4 + 0.9 * inBeam) * fog;
  gl_PointSize = ${(RAIN_STEP * 0.92).toFixed(3)} * uFocal / -view.z;
  gl_Position = projectionMatrix * view;
}`;

const RAIN_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
${GLYPH_AT}
uniform vec3 uInk;
uniform vec3 uInk2;
uniform float uPower;
varying float vLevel;
varying float vHead;
varying float vGlyph;
varying float vAlt;
void main() {
  float ink = glyphAt(vGlyph, gl_PointCoord);
  vec3 tint = mix(uInk, uInk2, vAlt);
  tint = mix(tint, mix(tint, vec3(1.0), 0.8), vHead);
  gl_FragColor = light(tint * ink * vLevel * (1.0 + vHead) * 0.5 * uPower);
}`;

/* ──────────────────────────────── Motion ──────────────────────────────── */

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** The still pose under less motion: a designed three-quarter view. */
const CALM_POSE = { x: 0.28, y: -0.12 };

/* ──────────────────────────────── Stage ──────────────────────────────── */

export interface TubeState {
  /** Lit share, 0–100. */
  percent: number;
  /** `continue` opens this one. */
  here: boolean;
}

export interface Stage {
  setTubes(tubes: TubeState[]): void;
  /** Lift tube `index`; `null` lets it down. */
  focus(index: number | null): void;
  dispose(): void;
}

interface Tube {
  root: Group;
  body: Group;
  glass: ShaderMaterial;
  ink: ShaderMaterial;
  meniscus: Mesh;
  meniscusMaterial: ShaderMaterial;
  filament: ShaderMaterial;
  halo: Mesh;
  haloMaterial: ShaderMaterial;
  metal: ShaderMaterial;
  /** Shown fill, 0–1: it eases toward `target`. */
  fill: number;
  target: number;
  lift: number;
  here: number;
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** The library header: the shelf stands beside its wordmark. */
  anchor: HTMLElement;
  tubes: TubeState[];
  /** Called after the first frame is drawn. */
  onReady?: () => void;
}

/** Mount the room on `canvas`. Throws when WebGL is not there: the page is whole without it. */
export function mountStage({ canvas, anchor, tubes: initial, onReady }: StageOptions): Stage {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  // The shaders write display colours as they are: no conversion on the way out.
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, 0, CAMERA_Z);

  let inks = readInks();
  const shared = {
    uInk: { value: new Vector3(...inks.accent) },
    uInk2: { value: new Vector3(...inks.accent2) },
    uHaze: { value: new Vector3(...inks.haze) },
    uTime: { value: 0 },
  };

  /* The shelf: tubes, floor, beam. */
  const shelf = new Group();
  scene.add(shelf);
  const tilt = new Group();
  shelf.add(tilt);

  const floorMaterial = lightMaterial(FLOOR_VERT, FLOOR_FRAG, {
    uInk: shared.uInk,
    uHaze: shared.uHaze,
    uTime: shared.uTime,
    uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new Vector4()) },
    uCount: { value: 0 },
    uRing: { value: new Vector3(0, 0, 0) },
    uPower: { value: 1 },
  });
  const floor = new Mesh(new PlaneGeometry(12, 12), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.renderOrder = -2;
  tilt.add(floor);

  const BEAM_H = 7.5;
  const beamPivot = new Group();
  beamPivot.position.set(0, FLOOR_Y + BEAM_H, -0.6);
  const beamMaterial = lightMaterial(SURFACE_VERT, BEAM_FRAG, {
    uHaze: shared.uHaze,
    uTime: shared.uTime,
    uPower: { value: 1 },
  });
  const beam = new Mesh(new ConeGeometry(2.7, BEAM_H, 72, 1, true), beamMaterial);
  // The apex is the source: the cone hangs from the pivot.
  beam.rotation.x = Math.PI;
  beam.position.y = -BEAM_H / 2;
  beam.renderOrder = -1;
  beamPivot.add(beam);
  tilt.add(beamPivot);

  const glassGeometry = new CylinderGeometry(TUBE_R, TUBE_R, TUBE_H, 56, 1, true);
  const inkGeometry = new CylinderGeometry(TUBE_R * 0.8, TUBE_R * 0.8, TUBE_H * 0.86, 48, 1, false);
  const meniscusGeometry = new CircleGeometry(TUBE_R * 0.8, 48);
  const baseGeometry = new CylinderGeometry(TUBE_R * 1.22, TUBE_R * 1.34, 0.16, 56);
  const capGeometry = new CylinderGeometry(TUBE_R * 0.9, TUBE_R * 1.06, 0.07, 56);
  const haloGeometry = new PlaneGeometry(TUBE_R * 9, TUBE_H * 1.9);
  const filamentGeometry = (() => {
    const points: Vector3[] = [];
    const turns = 7;
    for (let step = 0; step <= turns * 2; step++) {
      const y = -TUBE_H * 0.4 + (step / (turns * 2)) * TUBE_H * 0.5;
      points.push(new Vector3(step % 2 ? TUBE_R * 0.22 : -TUBE_R * 0.22, y, 0));
    }
    return new TubeGeometry(new CatmullRomCurve3(points), 80, 0.008, 6, false);
  })();

  const inkHeight = TUBE_H * 0.86;

  function makeTube(): Tube {
    const root = new Group();
    const body = new Group();
    root.add(body);

    const metal = new ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: METAL_FRAG,
      uniforms: { uInk: shared.uInk, uHere: { value: 0 }, uPower: { value: 1 } },
    });
    const base = new Mesh(baseGeometry, metal);
    base.position.y = -TUBE_H / 2 - 0.08;
    const cap = new Mesh(capGeometry, metal);
    cap.position.y = TUBE_H / 2 + 0.035;

    const halo = new Mesh(
      haloGeometry,
      lightMaterial(SURFACE_VERT, HALO_FRAG, { uInk: shared.uInk, uAmp: { value: 0 } }),
    );
    halo.renderOrder = 0;

    const ink = lightMaterial(
      SURFACE_VERT,
      INK_FRAG,
      {
        uInk: shared.uInk,
        uTime: shared.uTime,
        uFill: { value: 0 },
        uHeight: { value: inkHeight },
        uGlow: { value: 0 },
        uPower: { value: 1 },
      },
      0, // FrontSide
    );
    const inkMesh = new Mesh(inkGeometry, ink);
    inkMesh.position.y = -(TUBE_H - inkHeight) / 2 + 0.02;
    inkMesh.renderOrder = 1;

    const meniscusMaterial = lightMaterial(SURFACE_VERT, MENISCUS_FRAG, {
      uInk: shared.uInk,
      uGlow: ink.uniforms.uGlow!,
      uPower: ink.uniforms.uPower!,
    });
    const meniscus = new Mesh(meniscusGeometry, meniscusMaterial);
    meniscus.rotation.x = -Math.PI / 2;
    meniscus.renderOrder = 2;

    const filament = lightMaterial(SURFACE_VERT, FILAMENT_FRAG, {
      uInk: shared.uInk2,
      uWarm: { value: 0 },
      uPower: { value: 1 },
    });
    const filamentMesh = new Mesh(filamentGeometry, filament);
    filamentMesh.renderOrder = 1;

    const glass = lightMaterial(SURFACE_VERT, GLASS_FRAG, {
      uInk: shared.uInk,
      uGlow: { value: 0 },
      uPower: { value: 1 },
    });
    const glassMesh = new Mesh(glassGeometry, glass);
    glassMesh.renderOrder = 3;

    body.add(halo, base, cap, inkMesh, meniscus, filamentMesh, glassMesh);
    tilt.add(root);

    return {
      root,
      body,
      glass,
      ink,
      meniscus,
      meniscusMaterial,
      filament,
      halo,
      haloMaterial: halo.material as ShaderMaterial,
      metal,
      fill: 0,
      target: 0,
      lift: 0,
      here: 0,
    };
  }

  let tubes: Tube[] = [];
  let states: TubeState[] = [];

  function setTubes(next: TubeState[]) {
    states = next;
    while (tubes.length < next.length) tubes.push(makeTube());
    while (tubes.length > next.length) {
      const gone = tubes.pop();
      if (gone) tilt.remove(gone.root);
    }
    tubes.forEach((tube, index) => {
      const slot = slotOf(index, next.length);
      tube.root.position.set(slot.x, 0, slot.z);
      tube.target = clamp01((next[index]?.percent ?? 0) / 100);
    });
    floorMaterial.uniforms.uCount!.value = Math.min(next.length, MAX_LAMPS);
    layout();
    wake();
  }

  /* The rain: one field of streams for the whole room, mostly behind the shelf. */
  const atlas = glyphAtlas();
  const rainGeometry = new BufferGeometry();
  const rainMaterial = lightMaterial(
    RAIN_VERT,
    RAIN_FRAG,
    {
      uAtlas: { value: atlas },
      uRain: { value: 0 },
      uInk: shared.uInk,
      uInk2: shared.uInk2,
      uFocal: { value: 1 },
      uBeamTop: { value: new Vector3() },
      uBeamAxis: { value: new Vector3(0, -1, 0) },
      uPower: { value: 1 },
    },
    DoubleSide,
  );
  const rain = new Points(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  const rainRoom = new Group();
  rainRoom.add(rain);
  scene.add(rainRoom);

  function seedRain(streams: number) {
    const count = streams * RAIN_ROWS;
    const positions = new Float32Array(count * 3);
    const cells = new Float32Array(count * 4);
    const kinds = new Float32Array(count * 2);
    for (let stream = 0; stream < streams; stream++) {
      // Streams stand in depth; few in front of the shelf, so the pods stay clear.
      const z = -16 + Math.random() ** 0.8 * 13;
      const x = (Math.random() - 0.5) * (24 + -z * 1.6);
      const seed = Math.random();
      const speed = 5 + Math.random() * 9;
      const length = 6 + Math.random() * 14;
      for (let row = 0; row < RAIN_ROWS; row++) {
        const i = stream * RAIN_ROWS + row;
        cells.set([x, z, row, seed], i * 4);
        kinds.set([speed, length], i * 2);
      }
    }
    // `position` is unused by the shader (the cell is), but three counts points by it.
    rainGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    rainGeometry.setAttribute("aCell", new Float32BufferAttribute(cells, 4));
    rainGeometry.setAttribute("aStream", new Float32BufferAttribute(kinds, 2));
  }

  /* ───────── Size and place ───────── */

  let view: Viewport = { width: 1, height: 1 };
  let box: Box = { left: 0, top: 0, width: 1, height: 1 };
  let placement: Placement = { x: 0, y: 0, scale: 1, power: 1 };
  let streamCount = 0;

  function measure() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    view = { width, height };
    rainMaterial.uniforms.uFocal!.value =
      (height * ratio) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));

    const rect = anchor.getBoundingClientRect();
    box = {
      left: rect.left,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };

    // Streams by width, held between a phone and a wide screen.
    const streams = Math.round(Math.min(Math.max(width / 14, 36), 120));
    if (streams !== streamCount) {
      streamCount = streams;
      seedRain(streams);
    }
    layout();
    wake();
  }

  function layout() {
    placement = place(box, view, window.scrollY, Math.max(states.length, 1));
    shelf.position.set(placement.x, placement.y, 0);
    shelf.scale.setScalar(placement.scale);
  }

  /* ───────── Pointer and focus ───────── */

  const target = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  let focused: number | null = null;

  const listeners = new AbortController();
  const { signal } = listeners;

  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      target.x = (event.clientX / view.width) * 2 - 1;
      target.y = (event.clientY / view.height) * 2 - 1;
      wake();
    },
    { signal, passive: true },
  );
  document.documentElement.addEventListener(
    "pointerleave",
    () => {
      target.x = 0;
      target.y = 0;
      wake();
    },
    { signal },
  );
  window.addEventListener(
    "scroll",
    () => {
      layout();
      wake();
    },
    { signal, passive: true },
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

  const resizes = new ResizeObserver(() => measure());
  resizes.observe(canvas);
  resizes.observe(anchor);

  // A new vibe brings new ink; `data-calm` stills the room or wakes it.
  const attributes = new MutationObserver(() => {
    inks = readInks();
    shared.uInk.value.set(...inks.accent);
    shared.uInk2.value.set(...inks.accent2);
    shared.uHaze.value.set(...inks.haze);
    wake();
  });
  attributes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-vibe", "data-calm"],
  });

  /* ───────── Frame ───────── */

  const calm = () => document.documentElement.hasAttribute("data-calm");
  let frame = 0;
  let last = 0;
  let clock = 0;
  /** Wall time of the first frame: the entrance keeps real time, however slow the frames. */
  let born = 0;
  let rainClock = 0;
  let bullet = 0;
  let ready = false;
  const lamps = floorMaterial.uniforms.uLamps!.value as Vector4[];
  const ring = floorMaterial.uniforms.uRing!.value as Vector3;
  const beamTop = new Vector3();
  const beamFoot = new Vector3();

  function draw(now: number) {
    frame = 0;
    const still = calm();
    born ||= now;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    clock += still ? 0 : dt;
    shared.uTime.value = clock;

    // Bullet time: while a pod is lifted, the rain all but stops and the
    // room swings toward the reader. It eases back when the pointer lets go.
    const slow = focused === null ? 0 : 1;
    bullet = still ? slow : approach(bullet, slow, 0.06, dt);
    rainClock += still ? 0 : dt * (1 - 0.9 * bullet);
    rainMaterial.uniforms.uRain!.value = still ? 7.3 : rainClock;

    // The orbit: one damped target, split into a shallow camera arc and smaller turns.
    const aim = still ? CALM_POSE : target;
    smooth.x = still ? aim.x : approach(smooth.x, aim.x, 0.055, dt);
    smooth.y = still ? aim.y : approach(smooth.y, aim.y, 0.055, dt);

    camera.position.x = -smooth.x * 0.62;
    camera.position.y = 0.55 + smooth.y * 0.38;
    camera.lookAt(camera.position.x * 0.42, camera.position.y * 0.42 - 0.23, 0);

    tilt.rotation.y = -0.16 + smooth.x * 0.2 + bullet * 0.2;
    // Leaned back a little: the floor reads from above.
    tilt.rotation.x = 0.2 + smooth.y * 0.05;
    rainRoom.rotation.y = smooth.x * 0.06;
    rainRoom.position.y = window.scrollY * unitsPerPixel(view.height) * 0.3;
    // The beam leans toward the pointer: the light is in the reader's hand.
    beamPivot.rotation.z = -smooth.x * 0.14;
    beamPivot.rotation.x = smooth.y * 0.08;

    const power = placement.power;
    floorMaterial.uniforms.uPower!.value = power;
    beamMaterial.uniforms.uPower!.value = power;
    rainMaterial.uniforms.uPower!.value = 1;

    let settling =
      !still && (Math.abs(smooth.x - target.x) > 0.001 || Math.abs(smooth.y - target.y) > 0.001);
    if (Math.abs(bullet - slow) > 0.001) settling = true;
    let ringX = 0;
    let ringZ = 0;
    let ringOn = 0;

    tubes.forEach((tube, index) => {
      const state = states[index];
      // Tubes warm up one after another, with the cards: 120 ms, then 70 ms apart.
      const delay = 0.12 + index * 0.07;
      const age = (now - born) / 1000 - delay;
      const rise = still ? 1 : easeOut(clamp01(age / 0.9));
      const pour = still ? 1 : easeInOut(clamp01((age - 0.35) / 1.4));

      const goal = tube.target * pour;
      tube.fill = still ? goal : approach(tube.fill, goal, 0.08, dt);
      const lifted = focused === index ? 1 : 0;
      tube.lift = still ? lifted : approach(tube.lift, lifted, 0.12, dt);
      const here = state?.here ? 1 : 0;
      tube.here = still ? here : approach(tube.here, here, 0.08, dt);

      if (
        Math.abs(tube.fill - goal) > 0.0005 ||
        Math.abs(tube.lift - lifted) > 0.001 ||
        rise < 1 ||
        pour < 1
      )
        settling = true;

      const dim = focused !== null && focused !== index ? 0.72 : 1;
      const done = tube.target >= 1 ? 1 : 0;
      const glow = Math.max(tube.lift, done * 0.55);
      const p = power * dim * rise;

      tube.body.position.y = (1 - rise) * -0.7 + tube.lift * 0.16;
      tube.body.rotation.y = clock * 0.15 + index;
      tube.glass.uniforms.uGlow!.value = glow;
      tube.glass.uniforms.uPower!.value = p;
      tube.ink.uniforms.uFill!.value = tube.fill;
      tube.ink.uniforms.uGlow!.value = glow;
      tube.ink.uniforms.uPower!.value = p;
      tube.meniscus.visible = tube.fill > 0.004;
      tube.meniscus.position.y =
        -TUBE_H / 2 + (TUBE_H - inkHeight) / 2 + 0.02 + tube.fill * inkHeight - 0.002;
      tube.metal.uniforms.uHere!.value = tube.here;
      tube.metal.uniforms.uPower!.value = p;

      // The filament flickers before it holds: a tube warming up.
      const flicker = age < 0 ? 0 : age > 0.55 ? 1 : Math.sin(age * 90) > 0.1 ? 0.8 : 0.15;
      tube.filament.uniforms.uWarm!.value = (still ? 1 : flicker) * (0.35 + 0.65 * tube.lift);
      tube.filament.uniforms.uPower!.value = p;

      tube.haloMaterial.uniforms.uAmp!.value = (0.04 + 0.2 * tube.fill + 0.28 * tube.lift) * p;
      tube.halo.quaternion.copy(camera.quaternion);
      tube.halo.position.y = 0;

      if (index < MAX_LAMPS) {
        lamps[index]!.set(
          tube.root.position.x,
          tube.root.position.z,
          (0.25 + 0.75 * tube.fill + tube.lift * 0.5) * rise * dim,
          0,
        );
      }
      if (here) {
        ringX = tube.root.position.x;
        ringZ = tube.root.position.z;
        ringOn = tube.here * rise;
      }
    });
    ring.set(ringX, ringZ, ringOn);
    if (ringOn > 0) settling = true;

    // The rain knows where the beam is, in the room.
    scene.updateMatrixWorld();
    beamPivot.getWorldPosition(beamTop);
    beamFoot.set(0, -BEAM_H, 0);
    beamPivot.localToWorld(beamFoot);
    rainMaterial.uniforms.uBeamTop!.value.copy(beamTop);
    rainMaterial.uniforms.uBeamAxis!.value.copy(beamFoot.sub(beamTop).normalize());

    renderer.render(scene, camera);

    if (!ready) {
      ready = true;
      onReady?.();
    }
    // Under less motion the room draws once per change. Otherwise the rain
    // never settles, so the loop runs while the page is visible.
    if (!still || settling) wake();
  }

  function wake() {
    if (frame || document.hidden || disposed) return;
    frame = requestAnimationFrame(draw);
  }

  function sleep() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0; // Resume with a fresh time base: no jump after a hidden tab.
  }

  let disposed = false;

  setTubes(initial);
  measure();

  return {
    setTubes,
    focus(index) {
      focused = index;
      wake();
    },
    dispose() {
      disposed = true;
      sleep();
      listeners.abort();
      resizes.disconnect();
      attributes.disconnect();
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      scene.traverse((object: Object3D) => {
        if (object instanceof Mesh || object instanceof Points) {
          geometries.add(object.geometry);
          materials.add(object.material as Material);
        }
      });
      for (const tube of tubes) {
        for (const material of [
          tube.glass,
          tube.ink,
          tube.meniscusMaterial,
          tube.filament,
          tube.haloMaterial,
          tube.metal,
        ])
          materials.add(material);
      }
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      atlas.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
