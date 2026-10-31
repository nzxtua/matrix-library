/**
 * The deep: a Three.js layer under the Enter page (WebGL 2).
 *
 * Three things the flat beam cannot show:
 *
 * - **Deep rain.** Streams of the same glyphs stand far behind the wordmark,
 *   in depth. Like everything on the page they exist only in the light: each
 *   fragment is lit by the beam of the 2D engine, with the same falloff. The
 *   light is held by someone, so the room moves with it a little: near
 *   streams slide more than far ones (parallax).
 * - **The shaft.** The beam is a cone of haze from the reader's hand, below
 *   the screen, to the lit spot. Dust drifts in it and shows only inside it.
 * - **The dive.** On ENTER the reader falls into the code: the rain comes at
 *   the camera faster and faster, light streaks past, the room rolls a little.
 *
 * It draws once per frame of the 2D engine (`frame`, from its `onLight`), so
 * both layers always agree on where the light is. With less motion it is a
 * still: no time, no parallax, no dive.
 *
 * This module imports `three`. Load it with a dynamic `import()` only.
 */

import {
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  LineSegments,
  LinearSRGBColorSpace,
  Mesh,
  PerspectiveCamera,
  Points,
  Quaternion,
  Scene,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import type { Material } from "three";

import type { Light } from "#/lib/matrix-flashlight";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import {
  GLYPH_AT,
  GLYPH_COUNT,
  approach,
  glyphAtlas,
  lightMaterial,
  rgbOfHex,
} from "#/lib/three-ink";
import type { Rgb } from "#/lib/three-ink";
import type { RainPalette } from "#/lib/vibes";

/** Vertical field of view, degrees: wide enough for a fall to feel like one. */
const FOV = 52;
/** The deep spans these distances from the camera. */
const NEAR = 6;
const FAR = 60;
/** Rows of glyph cells per stream. */
const ROWS = 64;
/** On screen a glyph is about this many CSS pixels tall, at the depth it was set. */
const GLYPH_PX = 15;
/** Distance of the plane the lit spot is on, for the shaft. */
const SPOT_DEPTH = 18;
/** Share of the beam radius that is fully lit (`BEAM_CORE` of the 2D engine). */
const BEAM_CORE = 0.3;
/** Fastest fall, room units per second, and the seconds to reach it. */
const DIVE_SPEED = 46;
const DIVE_RAMP = 1.2;

/* ─────────────────────────────── Shaders ─────────────────────────────── */

/** Lit by the 2D beam, in device pixels: `uBeam` = x, y (from the bottom), radius, power. */
const BEAM_MASK = /* glsl */ `
uniform vec4 uBeam;
float beamAt(vec2 frag) {
  float r = max(uBeam.z, 1.0);
  float d = distance(frag, uBeam.xy);
  float t = clamp((d - r * ${BEAM_CORE}) / (r * ${1 - BEAM_CORE}), 0.0, 1.0);
  return (1.0 - t * t * (3.0 - 2.0 * t)) * uBeam.w;
}`;

/** Distance from the camera after the dive has carried the room `uTravel` units. */
const WRAP = /* glsl */ `
uniform float uTravel;
float wrapDepth(float d) {
  return ${NEAR.toFixed(1)} + mod(d - ${NEAR.toFixed(1)} - uTravel, ${(FAR - NEAR).toFixed(1)});
}
float depthFade(float d) {
  return smoothstep(${NEAR.toFixed(1)}, ${(NEAR + 4).toFixed(1)}, d) * smoothstep(${FAR.toFixed(1)}, ${(FAR - 16).toFixed(1)}, d);
}`;

const RAIN_VERT = /* glsl */ `
${WRAP}
attribute vec4 aCell;   // x, depth as set, row, seed
attribute vec3 aStream; // speed (rows per second), trail length (rows), cell height
uniform float uRain;
uniform float uFocal;
varying float vLevel;
varying float vHead;
varying float vGlyph;
varying float vAlt;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float row = aCell.z;
  float seed = aCell.w;
  float span = ${ROWS.toFixed(1)} + aStream.y * 1.5;
  float head = mod(seed * span * 7.0 + uRain * aStream.x, span);
  float behind = head - row;
  float trail = behind >= 0.0 ? exp(-behind / aStream.y * 2.6) : 0.0;
  vHead = behind >= 0.0 && behind < 1.0 ? 1.0 : 0.0;

  float tick = floor(uRain * (0.6 + seed * 1.8) + row * 0.37);
  vGlyph = floor(hash(row * 12.9898 + seed * 78.233 + tick) * ${GLYPH_COUNT.toFixed(1)});
  vAlt = step(0.8, hash(seed * 311.7));

  float d = wrapDepth(aCell.y);
  vec3 p = vec3(aCell.x, (${(ROWS / 2).toFixed(1)} - row) * aStream.z, -d);
  vec4 view = viewMatrix * modelMatrix * vec4(p, 1.0);
  vLevel = (0.06 + 0.94 * trail) * depthFade(d);
  gl_PointSize = aStream.z * 0.95 * uFocal / max(-view.z, 0.1);
  gl_Position = projectionMatrix * view;
}`;

const RAIN_FRAG = /* glsl */ `
${BEAM_MASK}
uniform sampler2D uAtlas;
${GLYPH_AT}
uniform vec3 uTrail;
uniform vec3 uHead;
uniform vec3 uAlt;
uniform float uGain;
varying float vLevel;
varying float vHead;
varying float vGlyph;
varying float vAlt;
void main() {
  float lit = beamAt(gl_FragCoord.xy);
  if (lit <= 0.002) discard;
  float ink = glyphAt(vGlyph, gl_PointCoord);
  vec3 tint = mix(mix(uTrail, uAlt, vAlt), uHead, vHead);
  gl_FragColor = light(tint * ink * vLevel * (1.0 + vHead * 0.6) * lit * uGain);
}`;

/** The shaft: a cone of haze, soft at its sides, with slow rays in it. */
const SHAFT_VERT = /* glsl */ `
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

const SHAFT_FRAG = /* glsl */ `
uniform vec3 uHaze;
uniform float uAmount;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
void main() {
  float soft = pow(abs(dot(normalize(vN), normalize(vV))), 2.4);
  float along = 1.0 - vUv.y; // 0 at the hand, 1 at the spot
  float swirl = atan(vLocal.z, vLocal.x);
  float rays = 0.62 + 0.38 * sin(swirl * 11.0 + uTime * 0.31) * sin(swirl * 5.0 - uTime * 0.19);
  // Soft at both ends: no rim where the cone meets the hand or the spot.
  float c = soft * mix(0.35, 1.0, along) * smoothstep(0.0, 0.08, along) * smoothstep(1.0, 0.72, along) * rays;
  gl_FragColor = light(uHaze * c * 0.085 * uAmount);
}`;

/** Dust: drifts, and shows only inside the shaft. */
const DUST_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPixel;
uniform vec3 uSource;
uniform vec3 uAxis;
uniform float uLength;
uniform float uRadius;
varying float vLit;
void main() {
  vec3 p = position;
  p.y = mod(p.y + uTime * aSeed.y + 5.0, 10.0) - 5.0;
  p.x += sin(uTime * 0.27 + aSeed.x * 6.283) * 0.22;
  p.z += cos(uTime * 0.21 + aSeed.x * 3.7) * 0.18;
  vec3 rel = p - uSource;
  float t = dot(rel, uAxis) / uLength;
  float off = length(rel - uAxis * t * uLength);
  float cone = uRadius * clamp(t, 0.0, 1.0);
  float inside = step(0.0, t) * step(t, 1.0) * smoothstep(cone, cone * 0.35, off);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.2 + aSeed.y * 5.0) + aSeed.x * 31.0);
  vLit = inside * twinkle * mix(0.4, 1.0, t);
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_PointSize = aSeed.z * uPixel * (6.0 / max(-view.z, 0.5));
  gl_Position = projectionMatrix * view;
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uHaze;
uniform float uAmount;
varying float vLit;
void main() {
  if (vLit <= 0.002) discard;
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = light(mix(uHaze, vec3(1.0), 0.55) * a * a * vLit * 0.7 * uAmount);
}`;

/** Light streaking past in the dive: each line is drawn out by the speed. */
const STREAK_VERT = /* glsl */ `
${WRAP}
attribute vec3 aLine; // depth as set, 0 = front end / 1 = back end, ink
uniform float uStretch;
varying float vFade;
varying float vInk;
void main() {
  float d = wrapDepth(aLine.x) + aLine.y * uStretch;
  vFade = depthFade(d) * (1.0 - aLine.y * 0.85);
  vInk = aLine.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(position.xy, -d, 1.0);
}`;

const STREAK_FRAG = /* glsl */ `
uniform vec3 uTrail;
uniform vec3 uHead;
uniform float uAmount;
varying float vFade;
varying float vInk;
void main() {
  gl_FragColor = light(mix(uTrail, uHead, step(0.75, vInk)) * vFade * 0.55 * uAmount);
}`;

/* ──────────────────────────────── Deep ──────────────────────────────── */

export interface Deep {
  /** Draw one frame, lit by `light`: call it from the 2D engine's `onLight`. */
  frame: (light: Light) => void;
  setPalette: (palette: RainPalette) => void;
  /** ENTER: fall into the code (`true`), or stand still (`false`). */
  dive: (on: boolean) => void;
  dispose: () => void;
}

export interface DeepOptions {
  canvas: HTMLCanvasElement;
  palette: RainPalette;
  /** Called after the first frame is drawn. */
  onReady?: () => void;
}

interface Inks {
  trail: Rgb;
  head: Rgb;
  alt: Rgb;
  haze: Rgb;
}

function inksOf(palette: RainPalette): Inks {
  return {
    trail: rgbOfHex(palette.trail.glow, [0.8, 1, 0]),
    head: rgbOfHex(palette.head.fill, [0.97, 1, 0.86]),
    alt: rgbOfHex(palette.alt.glow, [1, 0.24, 0.86]),
    haze: [palette.haze[0] / 255, palette.haze[1] / 255, palette.haze[2] / 255],
  };
}

const easeIn = (t: number) => t * t * t;

/** Mount the deep on `canvas`. Throws when WebGL is not there: the page is whole without it. */
export function mountDeep({ canvas, palette, onReady }: DeepOptions): Deep {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, FAR + 30);

  const inks = inksOf(palette);
  const colour = {
    uTrail: { value: new Vector3(...inks.trail) },
    uHead: { value: new Vector3(...inks.head) },
    uAlt: { value: new Vector3(...inks.alt) },
    uHaze: { value: new Vector3(...inks.haze) },
  };
  const time = { value: 0 };
  const travel = { value: 0 };
  const beam = { value: new Vector4(0, 0, 1, 0) };

  /* Deep rain. */
  const atlas = glyphAtlas();
  const rainGeometry = new BufferGeometry();
  const rainMaterial = lightMaterial(RAIN_VERT, RAIN_FRAG, {
    ...colour,
    uAtlas: { value: atlas },
    uRain: { value: 0 },
    uTravel: travel,
    uFocal: { value: 1 },
    uBeam: beam,
    uGain: { value: 0.42 },
  });
  const rain = new Points(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  scene.add(rain);

  /* The shaft and its dust. */
  const shaftGeometry = new ConeGeometry(1, 1, 72, 1, true);
  // Apex at the origin, the open end one unit down -y: the hand is the origin.
  shaftGeometry.translate(0, -0.5, 0);
  const shaftMaterial = lightMaterial(SHAFT_VERT, SHAFT_FRAG, {
    uHaze: colour.uHaze,
    uTime: time,
    uAmount: { value: 0 },
  });
  const shaft = new Mesh(shaftGeometry, shaftMaterial);
  shaft.frustumCulled = false;
  scene.add(shaft);

  const dustGeometry = new BufferGeometry();
  const dustMaterial = lightMaterial(DUST_VERT, DUST_FRAG, {
    uHaze: colour.uHaze,
    uTime: time,
    uPixel: { value: 1 },
    uSource: { value: new Vector3() },
    uAxis: { value: new Vector3(0, 0, -1) },
    uLength: { value: 1 },
    uRadius: { value: 1 },
    uAmount: { value: 0 },
  });
  const dust = new Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  scene.add(dust);
  {
    const count = 520;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions.set(
        [(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, -2 - Math.random() * 16],
        i * 3,
      );
      seeds.set([Math.random(), 0.03 + Math.random() * 0.1, 1 + Math.random() ** 3 * 4, 0], i * 4);
    }
    dustGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    dustGeometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 4));
  }

  /* Streaks, for the dive. */
  const streakGeometry = new BufferGeometry();
  const streakMaterial = lightMaterial(STREAK_VERT, STREAK_FRAG, {
    uTrail: colour.uTrail,
    uHead: colour.uHead,
    uTravel: travel,
    uStretch: { value: 0 },
    uAmount: { value: 0 },
  });
  const streaks = new LineSegments(streakGeometry, streakMaterial);
  streaks.frustumCulled = false;
  scene.add(streaks);
  {
    const count = 420;
    const positions = new Float32Array(count * 6);
    const lines = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      // Around the axis of the fall, never on it: the centre stays open.
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.4 + Math.random() ** 0.6 * 11;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const depth = NEAR + Math.random() * (FAR - NEAR);
      const ink = Math.random();
      positions.set([x, y, 0, x, y, 0], i * 6);
      lines.set([depth, 0, ink, depth, 1, ink], i * 6);
    }
    streakGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    streakGeometry.setAttribute("aLine", new Float32BufferAttribute(lines, 3));
  }

  /* ───────── Size ───────── */

  let width = 1;
  let height = 1;
  let ratio = 1;
  let seededFor = "";

  /** Streams across the view at every depth: as many far as near, on screen. */
  function seedRain() {
    const aspect = width / height;
    const streams = Math.round(Math.min(Math.max(width / 9, 70), 200));
    const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    const count = streams * ROWS;
    const cells = new Float32Array(count * 4);
    const kinds = new Float32Array(count * 3);
    for (let stream = 0; stream < streams; stream++) {
      const depth = NEAR + 3 + Math.random() ** 0.75 * (FAR - NEAR - 3);
      // Half-width of the view at that depth, and a little more for parallax.
      const reach = depth * tan * aspect * 1.15;
      const x = (Math.random() * 2 - 1) * reach;
      // A glyph of about GLYPH_PX on screen, but never a stream too short to
      // reach from the top of the view to the bottom.
      const cell = Math.max((GLYPH_PX * 2 * depth * tan) / height, (2.3 * depth * tan) / ROWS);
      const seed = Math.random();
      const speed = 5 + Math.random() * 12;
      const length = 8 + Math.random() * 22;
      for (let row = 0; row < ROWS; row++) {
        const i = stream * ROWS + row;
        cells.set([x, depth, row, seed], i * 4);
        kinds.set([speed, length, cell], i * 3);
      }
    }
    rainGeometry.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(count * 3), 3),
    );
    rainGeometry.setAttribute("aCell", new Float32BufferAttribute(cells, 4));
    rainGeometry.setAttribute("aStream", new Float32BufferAttribute(kinds, 3));
  }

  function measure() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    width = w;
    height = h;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const focal = (h * ratio) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    rainMaterial.uniforms.uFocal!.value = focal;
    dustMaterial.uniforms.uPixel!.value = ratio * (h / 900);
    // A new shape of screen needs streams that cover it; a small change does not.
    const shape = `${Math.round(w / 120)}x${Math.round(h / 120)}`;
    if (shape !== seededFor) {
      seededFor = shape;
      seedRain();
    }
  }
  const resizes = new ResizeObserver(measure);
  resizes.observe(canvas);
  measure();

  /* ───────── Frame ───────── */

  let last = 0;
  let clock = 0;
  let rainClock = 0;
  let diving = false;
  let diveSince = 0;
  let dive = 0;
  let speed = 0;
  let roll = 0;
  const held = { x: 0.5, y: 0.5 };
  let ready = false;
  let disposed = false;

  const source = new Vector3();
  const spot = new Vector3();
  const axis = new Vector3();
  const down = new Vector3(0, -1, 0);
  const turn = new Quaternion();

  /** A point on screen (CSS px) at `depth` in front of the camera, in camera space. */
  function unproject(x: number, y: number, depth: number, out: Vector3): Vector3 {
    const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    const ndcX = (x / width) * 2 - 1;
    const ndcY = 1 - (y / height) * 2;
    return out.set(ndcX * depth * tan * camera.aspect, ndcY * depth * tan, -depth);
  }

  function frame(light: Light) {
    if (disposed) return;
    const now = performance.now();
    const still = prefersReducedMotion();
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    if (!still) clock += dt;
    time.value = clock;

    // The dive: the fall speeds up, and the rain's own time with it.
    const goal = diving && !still ? 1 : 0;
    dive = still ? goal : approach(dive, goal, 0.05, dt);
    const ramp = diving ? easeIn(Math.min((now - diveSince) / 1000 / DIVE_RAMP, 1)) : 0;
    speed = still ? 0 : approach(speed, DIVE_SPEED * ramp, 0.08, dt);
    travel.value += speed * dt;
    // ENTER under the pointer slows the rain (`light.pace`); the dive speeds it up.
    rainClock += still ? 0 : dt * (light.pace + dive * 2.5);
    rainMaterial.uniforms.uRain!.value = still ? 11.7 : rainClock;
    roll += dt * dive * 0.22;

    // The light is in someone's hand: the room moves with it, a little.
    const aimX = light.x / width;
    const aimY = light.y / height;
    held.x = still ? 0.5 : approach(held.x, aimX, 0.045, dt);
    held.y = still ? 0.5 : approach(held.y, aimY, 0.045, dt);
    camera.position.set((held.x - 0.5) * 1.6, -(held.y - 0.5) * 1.0, 0);
    camera.rotation.set(0, 0, Math.sin(roll) * 0.16 * dive);
    camera.updateMatrixWorld();

    // Under the flood the beam covers the screen: the whole deep is lit.
    beam.value.set(light.x * ratio, (height - light.y) * ratio, light.radius * ratio, light.power);
    rainMaterial.uniforms.uGain!.value = 0.42 + dive * 0.45;

    // The shaft runs from the hand, below the screen, to the lit spot.
    // In camera space, then into the room.
    unproject(width * 0.58, height * 1.22, 2.4, source).applyMatrix4(camera.matrixWorld);
    unproject(light.x, light.y, SPOT_DEPTH, spot).applyMatrix4(camera.matrixWorld);
    axis.subVectors(spot, source);
    const length = axis.length();
    axis.normalize();
    const spotRadius =
      (light.radius * 2 * SPOT_DEPTH * Math.tan(((FOV / 2) * Math.PI) / 180)) / height;
    shaft.position.copy(source);
    shaft.quaternion.copy(turn.setFromUnitVectors(down, axis));
    shaft.scale.set(spotRadius, length, spotRadius);

    // A beam as wide as the screen is no shaft any more: it is the room.
    const diagonal = Math.hypot(width, height);
    const wide = Math.min(Math.max((light.radius / diagonal - 0.4) / 0.4, 0), 1);
    const amount = light.power * (1 - wide) * (1 - dive);
    shaftMaterial.uniforms.uAmount!.value = amount;
    dustMaterial.uniforms.uAmount!.value = amount;
    dustMaterial.uniforms.uSource!.value.copy(source);
    dustMaterial.uniforms.uAxis!.value.copy(axis);
    dustMaterial.uniforms.uLength!.value = length;
    dustMaterial.uniforms.uRadius!.value = spotRadius * (length / SPOT_DEPTH);

    streakMaterial.uniforms.uAmount!.value = dive;
    streakMaterial.uniforms.uStretch!.value = speed * 0.2;
    streaks.visible = dive > 0.01;

    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      onReady?.();
    }
  }

  return {
    frame,
    setPalette(next) {
      const inks = inksOf(next);
      colour.uTrail.value.set(...inks.trail);
      colour.uHead.value.set(...inks.head);
      colour.uAlt.value.set(...inks.alt);
      colour.uHaze.value.set(...inks.haze);
    },
    dive(on) {
      if (on === diving) return;
      diving = on;
      diveSince = performance.now();
    },
    dispose() {
      disposed = true;
      resizes.disconnect();
      for (const geometry of [rainGeometry, shaftGeometry, dustGeometry, streakGeometry])
        geometry.dispose();
      for (const material of [
        rainMaterial,
        shaftMaterial,
        dustMaterial,
        streakMaterial,
      ] as Material[])
        material.dispose();
      atlas.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
