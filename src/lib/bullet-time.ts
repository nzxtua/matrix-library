/**
 * Bullet time: a frozen moment in 3D round the poster title of a content
 * page (Three.js, WebGL). No React.
 *
 * Code rain hangs in depth behind the title, stopped in mid-fall: heads,
 * trails and all. Bullets cross it from the back left toward the reader,
 * frozen in flight: metal, round-nosed, rifled, each with a tracer from its
 * base and a wake of air rings that widen behind it. Seen in perspective, a ring is an ellipse.
 *
 * The camera of the film moves while time stands still: the pointer swings
 * the scene round the title, slowly. A click in the title block lets time run
 * for a moment: the rain falls, the bullets fly on, then all of it slows back
 * into bullet time. The scene comes once the rain of the page has fallen
 * away, with time still running, and freezes. Scrolling lets a little time
 * through.
 *
 * Every colour comes from the vibe tokens (`--accent`, `--accent-2`). The
 * scene fades out just under the title block: it never lies behind the text
 * of the document. `data-calm` makes it a still, drawn once per change.
 *
 * Load this module with a dynamic `import()` only: it imports `three`.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearSRGBColorSpace,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  CustomBlending,
  ShaderMaterial,
  Quaternion,
  PerspectiveCamera,
  Points,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

import { GLYPH_AT, GLYPH_COUNT, approach, glyphAtlas, lightMaterial, rgbOf } from "#/lib/three-ink";

/* ──────────────────────────────── Layout ──────────────────────────────── */

export const FOV = 30;
export const CAMERA_Z = 14;

/** Room units per CSS pixel on the plane `z = 0`. */
export function unitsPerPixel(height: number): number {
  return (2 * CAMERA_Z * Math.tan(((FOV / 2) * Math.PI) / 180)) / Math.max(height, 1);
}

export interface Viewport {
  width: number;
  height: number;
}

/** A box in page coordinates (not viewport): read on resize only. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Stage {
  /** Centre of the title block in the room, on `z = 0`. */
  x: number;
  y: number;
  /** Its size in room units. */
  width: number;
  height: number;
  /** Overall light: 0 once the title block has scrolled away. */
  power: number;
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** The scene for the title block `box`: on it, as large as it, dark once it has gone. */
export function stageOf(box: Box, view: Viewport, scrollY: number): Stage {
  const unit = unitsPerPixel(view.height);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2 - scrollY;
  const away = (scrollY - box.top) / Math.max(box.height + view.height * 0.3, 1);
  return {
    x: (cx - view.width / 2) * unit,
    y: -(cy - view.height / 2) * unit,
    width: box.width * unit,
    height: box.height * unit,
    power: 1 - smooth01(away),
  };
}

/* ───────────────────────────────── Time ───────────────────────────────── */

/** Bullet time: how fast time runs while it stands still. */
export const FROZEN = 0.012;
/** A click lets time run this long at full speed… */
export const RELEASE_S = 0.55;
/** …and then slows back into bullet time over this long. */
export const SLOW_S = 0.9;

/**
 * How fast time runs `since` seconds after it was let go, when it was let go
 * for `hold` seconds: full speed, then down into bullet time.
 */
export function timeScale(since: number, hold: number = RELEASE_S): number {
  if (since < 0) return FROZEN;
  if (since < hold) return 1;
  const t = clamp01((since - hold) / SLOW_S);
  return FROZEN + (1 - FROZEN) * (1 - t) ** 3;
}

/* ─────────────────────────────── Shaders ─────────────────────────────── */

/* The scene ends just under the title block: device pixels from the bottom
   of the canvas, gone at x, whole at y. */
const CUT = /* glsl */ `
uniform vec2 uCut;
float cut() { return smoothstep(uCut.x, uCut.y, gl_FragCoord.y); }`;

/** Height of a rain cell in room units. */
const STEP = 0.3;

const RAIN_VERT = /* glsl */ `
attribute vec4 aCell;   // x, z, row, seed
attribute vec2 aStream; // speed (rows per second), trail (rows)
uniform float uSim;     // the scene's own clock: bullet time slows it
uniform float uRows;
uniform float uTop;
uniform float uFocal;   // device pixels per room unit at depth 1
varying float vLevel;
varying float vHead;
varying float vGlyph;
varying float vAlt;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float row = aCell.z;
  float seed = aCell.w;
  float span = uRows + aStream.y * 1.5;
  float head = mod(seed * span * 7.0 + uSim * aStream.x, span);
  float behind = head - row;
  float trail = behind >= 0.0 ? exp(-behind / aStream.y * 2.4) : 0.0;
  vHead = behind >= 0.0 && behind < 1.0 ? 1.0 : 0.0;

  float tick = floor(uSim * (0.6 + seed * 1.8) + row * 0.37);
  vGlyph = floor(hash(row * 12.9898 + seed * 78.233 + tick) * ${GLYPH_COUNT.toFixed(1)});
  vAlt = step(0.86, hash(seed * 311.7));

  vec3 p = vec3(aCell.x, uTop - row * ${STEP.toFixed(2)}, aCell.y);
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  float fog = smoothstep(-24.0, -11.0, view.z);
  vLevel = (0.04 + 0.96 * trail) * fog;
  gl_PointSize = ${(STEP * 0.9).toFixed(3)} * uFocal / -view.z;
  gl_Position = projectionMatrix * view;
}`;

const RAIN_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
${GLYPH_AT}
${CUT}
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
  gl_FragColor = light(tint * ink * vLevel * (1.0 + vHead) * 0.42 * uPower * cut());
}`;

/** Bullets in the air at once, rings in each wake, and room units between rings. */
const BULLETS = 3;
const RINGS = 9;
const SPACING = 0.55;
/** Length of a tracer, room units. */
const TRACER = 2.6;
/** A bullet: its length (base to tip) and the radius of its body, room units. */
const BULLET_L = 0.42;
const BULLET_R = 0.062;
/** Where the round nose starts, from the base. */
const SHANK = 0.25;

/** The outline of a bullet, base to tip, turned round its axis: a flat base
    with a small bevel, a straight body, and a round ogive nose. */
function bulletProfile(): Vector2[] {
  const points = [new Vector2(0, 0), new Vector2(BULLET_R * 0.86, 0), new Vector2(BULLET_R, 0.012)];
  points.push(new Vector2(BULLET_R, SHANK));
  const nose = BULLET_L - SHANK;
  for (let i = 1; i <= 14; i += 1) {
    const t = i / 14;
    points.push(new Vector2(BULLET_R * Math.sqrt(Math.max(1 - t ** 2.4, 0)), SHANK + nose * t));
  }
  return points;
}

/* Metal, lit by the room of the film: a dark room, a long light above, one
   at the side, the ink of the vibe at the rim, rifling on the body. */
const BULLET_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const BULLET_FRAG = /* glsl */ `
${CUT}
uniform vec3 uInk;
uniform float uPower;
uniform float uSpin;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 eye = normalize(cameraPosition - vWorld);
  if (dot(n, eye) < 0.0) n = -n;
  vec3 r = reflect(-eye, n);
  float fresnel = pow(1.0 - max(dot(eye, n), 0.0), 3.0);

  float above = (r.y - 0.55) / 0.22;
  float side = (r.x - 0.6) / 0.25;
  vec3 room = vec3(0.07) + vec3(1.1) * exp(-above * above) + vec3(0.45) * exp(-side * side);
  room += vec3(0.12) * smoothstep(-0.2, 0.9, r.y);
  vec3 sun = normalize(vec3(-0.3, 0.8, 0.6));
  float glint = pow(max(dot(reflect(-sun, n), eye), 0.0), 60.0);

  vec3 metal = vec3(0.78, 0.77, 0.74);
  vec3 colour = metal * room + vec3(glint) * 1.4 + uInk * fresnel * 0.55;

  // Rifling: shallow grooves on the body, turning as it flies.
  float body = step(0.015, vLocal.y) * step(vLocal.y, ${SHANK.toFixed(3)});
  float angle = atan(vLocal.z, vLocal.x) / 6.2832 + vLocal.y * 1.5 + uSpin;
  float groove = smoothstep(0.42, 0.5, abs(fract(angle * 6.0) - 0.5));
  colour *= 1.0 - body * groove * 0.35;
  // The base is in its own shadow.
  colour *= mix(0.45, 1.0, smoothstep(0.0, 0.03, vLocal.y));

  float alpha = uPower * cut();
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

const WAKE_VERT = /* glsl */ `
attribute vec2 aWake;   // bullet, ring (-1: the tracer)
attribute vec2 aCorner; // -1..1
uniform vec4 uBullets[${BULLETS}]; // position, distance flown
uniform vec3 uDirs[${BULLETS}];
varying vec2 vCorner;
varying float vLevel;
varying float vKind;

void main() {
  int index = int(aWake.x + 0.5);
  vec4 bullet = uBullets[index];
  vec3 dir = normalize(uDirs[index]);
  float ring = aWake.y;
  vec3 world;

  if (ring < 0.0) {
    // The tracer: a ribbon along the flight, turned to the camera.
    // It starts at the base of the bullet.
    vec3 head = (modelMatrix * vec4(bullet.xyz - dir * ${BULLET_L.toFixed(2)}, 1.0)).xyz;
    vec3 axis = normalize(mat3(modelMatrix) * dir);
    float len = min(${TRACER.toFixed(2)}, bullet.w + 0.35);
    vec3 side = normalize(cross(axis, normalize(cameraPosition - head)));
    float along = aCorner.x * 0.5 + 0.5;
    world = head - axis * (1.0 - along) * len + side * aCorner.y * 0.07;
    vLevel = 1.0;
    vKind = 0.0;
  } else {
    // A ring of air, square to the flight, wider and fainter the older it is.
    float back = (ring + 1.0) * ${SPACING.toFixed(2)};
    vec3 up = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 b1 = normalize(cross(dir, up));
    vec3 b2 = cross(dir, b1);
    float radius = 0.1 + back * 0.085;
    vec3 local = bullet.xyz - dir * back + (b1 * aCorner.x + b2 * aCorner.y) * radius * 1.25;
    world = (modelMatrix * vec4(local, 1.0)).xyz;
    vLevel = step(back, bullet.w) * exp(-back * 0.3);
    vKind = 1.0;
  }

  vCorner = aCorner;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const WAKE_FRAG = /* glsl */ `
${CUT}
uniform vec3 uInk;
uniform float uPower;
varying vec2 vCorner;
varying float vLevel;
varying float vKind;
void main() {
  vec3 colour;
  if (vKind < 0.5) {
    float along = vCorner.x * 0.5 + 0.5;
    float y2 = vCorner.y * vCorner.y;
    float glow = exp(-y2 * 7.0);
    float core = exp(-y2 * 50.0);
    // Air the bullet has torn: brightest just behind its base.
    colour = (uInk * glow * 0.6 + vec3(core) * 0.6) * along * along * along;
  } else {
    float r = length(vCorner);
    float off = (r - 0.8) / 0.06;
    float ring = exp(-off * off);
    float haze = (1.0 - smoothstep(0.0, 0.8, r)) * 0.05;
    colour = mix(vec3(1.0), uInk, 0.55) * (ring * 0.6 + haze) * vLevel;
  }
  gl_FragColor = light(colour * uPower * cut());
}`;

/* ───────────────────────────────── Stage ───────────────────────────────── */

export interface BulletTime {
  dispose(): void;
}

export interface BulletTimeOptions {
  canvas: HTMLCanvasElement;
  /** The title block: the scene stands round it. */
  header: HTMLElement;
  /** Called after the first frame is drawn. */
  onReady?: () => void;
}

/** Room units a bullet flies per second of the scene's clock. */
const BULLET_SPEED = 6;
/** On arrival time runs this long before it slows into bullet time. */
const ARRIVAL_HOLD_S = 1.5;
/** The scene's clock at the end of the arrival: where a still scene stands. */
const ARRIVAL_SIM = ARRIVAL_HOLD_S + SLOW_S / 4;

interface Bullet {
  pos: Vector3;
  dir: Vector3;
  flown: number;
}

/** Mount bullet time on `canvas`. Throws when WebGL is not there: the page is whole without it. */
export function mountBulletTime({ canvas, header, onReady }: BulletTimeOptions): BulletTime {
  const calm = () => document.documentElement.hasAttribute("data-calm");

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

  const style = () => getComputedStyle(document.documentElement);
  const atlas = glyphAtlas();
  const shared = {
    uInk: { value: new Vector3(...rgbOf(style().getPropertyValue("--accent"), [0.8, 1, 0])) },
    uInk2: {
      value: new Vector3(...rgbOf(style().getPropertyValue("--accent-2"), [1, 0.24, 0.86])),
    },
    uPower: { value: 0 },
    uCut: { value: new Vector2(0, 1) },
  };

  // The whole moment turns round the centre of the title block.
  const moment = new Group();
  scene.add(moment);

  /* ───────── The rain ───────── */

  const rainGeometry = new BufferGeometry();
  const rainMaterial = lightMaterial(RAIN_VERT, RAIN_FRAG, {
    ...shared,
    uAtlas: { value: atlas },
    uSim: { value: 0 },
    uRows: { value: 1 },
    uTop: { value: 0 },
    uFocal: { value: 1 },
  });
  const rain = new Points(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  moment.add(rain);

  /** Streams across the block and above it, in depth; rows down to its foot. */
  function seedRain(width: number, height: number) {
    const halfWide = width / 2 + 0.8;
    const top = height / 2 + 2.2;
    const rows = Math.ceil((top + height / 2 + 0.4) / STEP);
    const streams = Math.round(Math.min(Math.max(width * 4.5, 20), 52));
    rainMaterial.uniforms.uRows!.value = rows;
    rainMaterial.uniforms.uTop!.value = top;

    const cells: number[] = [];
    const kinds: number[] = [];
    const positions: number[] = [];
    for (let s = 0; s < streams; s += 1) {
      const seed = ((s * 0.618034 + 0.13) % 1) + 0.001;
      const x =
        -halfWide + ((s + 0.5) / streams) * halfWide * 2 + (((s * 37) % 11) / 11 - 0.5) * 0.3;
      const z = -6 + (((s * 53) % 17) / 17) * 8;
      const speed = 5 + ((s * 7) % 9) * 0.6;
      const trail = 5 + ((s * 5) % 9);
      for (let row = 0; row < rows; row += 1) {
        positions.push(x, top - row * STEP, z);
        cells.push(x, z, row, seed);
        kinds.push(speed, trail);
      }
    }
    rainGeometry.dispose();
    rainGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    rainGeometry.setAttribute("aCell", new Float32BufferAttribute(cells, 4));
    rainGeometry.setAttribute("aStream", new Float32BufferAttribute(kinds, 2));
  }

  /* ───────── The bullets and their wakes ───────── */

  const wakeGeometry = new BufferGeometry();
  {
    const corners: number[] = [];
    const wakes: number[] = [];
    const quad = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
    for (let b = 0; b < BULLETS; b += 1) {
      for (let ring = -1; ring < RINGS; ring += 1) {
        for (let i = 0; i < 12; i += 2) {
          corners.push(quad[i]!, quad[i + 1]!);
          wakes.push(b, ring);
        }
      }
    }
    // Positions come from the shader; the attribute only gives the count.
    wakeGeometry.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array((corners.length / 2) * 3), 3),
    );
    wakeGeometry.setAttribute("aCorner", new Float32BufferAttribute(corners, 2));
    wakeGeometry.setAttribute("aWake", new Float32BufferAttribute(wakes, 2));
  }
  const bulletUniforms = Array.from({ length: BULLETS }, () => new Vector4());
  const dirUniforms = Array.from({ length: BULLETS }, () => new Vector3(1, 0, 0));
  const wakeMaterial = lightMaterial(WAKE_VERT, WAKE_FRAG, {
    ...shared,
    uBullets: { value: bulletUniforms },
    uDirs: { value: dirUniforms },
  });
  const wakes = new Mesh(wakeGeometry, wakeMaterial);
  wakes.frustumCulled = false;
  moment.add(wakes);

  const bulletGeometry = new LatheGeometry(bulletProfile(), 40);
  const bulletMaterial = new ShaderMaterial({
    vertexShader: BULLET_VERT,
    fragmentShader: BULLET_FRAG,
    uniforms: { uInk: shared.uInk, uPower: shared.uPower, uCut: shared.uCut, uSpin: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  // Drawn after the light: a bullet covers the rain behind it.
  const shells = Array.from({ length: BULLETS }, () => {
    const shell = new Mesh(bulletGeometry, bulletMaterial);
    shell.renderOrder = 2;
    shell.frustumCulled = false;
    moment.add(shell);
    return shell;
  });
  const alongY = new Vector3(0, 1, 0);
  const facing = new Quaternion();

  const bullets: Bullet[] = Array.from({ length: BULLETS }, () => ({
    pos: new Vector3(),
    dir: new Vector3(1, 0, 0),
    flown: 0,
  }));
  let size = { width: 1, height: 1 };

  /** A bullet comes in from the back left, at its own height and depth. */
  function aim(bullet: Bullet, index: number, x: number) {
    const lane = (index + 0.5) / BULLETS;
    bullet.pos.set(
      x,
      (lane - 0.5) * size.height * 0.8 + (Math.random() - 0.5) * 0.3,
      -3.2 + Math.random() * 1.6,
    );
    bullet.dir.set(1, -0.1 + Math.random() * 0.14, 0.32 + Math.random() * 0.18).normalize();
    bullet.flown = 0;
  }

  /** Bullets placed so that the arrival leaves them frozen across the block. */
  function load() {
    bullets.forEach((bullet, index) => {
      const goal = -size.width / 2 + size.width * (0.18 + 0.3 * index);
      aim(bullet, index, 0);
      const flight = BULLET_SPEED * ARRIVAL_SIM;
      bullet.pos.addScaledVector(bullet.dir, -flight);
      bullet.pos.x += goal;
    });
  }

  /* ───────── Size and place ───────── */

  let view: Viewport = { width: 1, height: 1 };
  let ratio = 1;
  let box: Box = { left: 0, top: 0, width: 1, height: 1 };
  let stage: Stage = { x: 0, y: 0, width: 1, height: 1, power: 0 };
  let loaded = false;

  function measure() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    view = { width, height };
    rainMaterial.uniforms.uFocal!.value =
      (height * ratio) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));

    const rect = header.getBoundingClientRect();
    box = {
      left: rect.left,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
    const next = stageOf(box, view, window.scrollY);
    if (
      Math.abs(next.width - size.width) > 0.05 ||
      Math.abs(next.height - size.height) > 0.05 ||
      !loaded
    ) {
      size = { width: next.width, height: next.height };
      seedRain(size.width, size.height);
      if (!loaded) load();
      loaded = true;
    }
    layout();
  }

  function layout() {
    stage = stageOf(box, view, window.scrollY);
    moment.position.set(stage.x, stage.y, 0);
    // Gone 36 px under the block, whole 24 px above its foot.
    const foot = box.top + box.height - window.scrollY;
    shared.uCut.value.set((view.height - foot - 36) * ratio, (view.height - foot + 24) * ratio);
    wake();
  }

  /* ───────── Pointer, clicks, scroll ───────── */

  const target = { x: 0, y: 0 };
  const turn = { x: 0, y: 0 };
  /** Wall time time was last let go, and for how long. */
  let letGoAt = 0;
  let hold = ARRIVAL_HOLD_S;

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
  // A click in the title block lets time run. Links and buttons keep their clicks.
  header.addEventListener(
    "pointerdown",
    (event) => {
      if (calm() || (event.target as Element).closest("a, button")) return;
      letGoAt = performance.now();
      hold = RELEASE_S;
      wake();
    },
    { signal, passive: true },
  );
  window.addEventListener("scroll", layout, { signal, passive: true });
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
  resizes.observe(header);

  // A new vibe brings new ink; `data-calm` stills the scene or wakes it.
  const attributes = new MutationObserver(() => {
    shared.uInk.value.set(...rgbOf(style().getPropertyValue("--accent"), [0.8, 1, 0]));
    shared.uInk2.value.set(...rgbOf(style().getPropertyValue("--accent-2"), [1, 0.24, 0.86]));
    wake();
  });
  attributes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-vibe", "data-calm"],
  });

  /* ───────── Frame ───────── */

  let frame = 0;
  let last = 0;
  let born = 0;
  let sim = 0;
  let lastScroll = window.scrollY;
  let rush = 0;
  let ready = false;
  let dark = false;

  function fly(dSim: number) {
    const halfWide = size.width / 2;
    bullets.forEach((bullet, index) => {
      bullet.pos.addScaledVector(bullet.dir, BULLET_SPEED * dSim);
      bullet.flown += BULLET_SPEED * dSim;
      // Out at the right: a new one comes in at the left, already in the air.
      if (bullet.pos.x > halfWide + 2.5) aim(bullet, index, -halfWide - 0.6 - Math.random());
    });
  }

  function draw(time: number) {
    frame = 0;
    const still = calm();
    born ||= time;
    letGoAt ||= born;
    // Wall time, so a slow device freezes on the same moment; a hidden tab
    // resets `last`, so there is no jump.
    const dt = last ? Math.min((time - last) / 1000, 0.25) : 1 / 60;
    last = time;

    // Scrolling lets a little time through.
    const scrollY = window.scrollY;
    const speed = Math.min(Math.abs(scrollY - lastScroll) / Math.max(dt, 1e-3) / 2500, 0.35);
    lastScroll = scrollY;
    rush = still ? 0 : approach(rush, speed, 0.1, dt);

    if (still) {
      // A still is the moment the arrival freezes on.
      if (sim < ARRIVAL_SIM) {
        fly(ARRIVAL_SIM - sim);
        sim = ARRIVAL_SIM;
      }
    } else {
      const scale = Math.min(timeScale((time - letGoAt) / 1000, hold) + rush, 1);
      const dSim = dt * scale;
      sim += dSim;
      fly(dSim);
    }
    rainMaterial.uniforms.uSim!.value = sim;
    // A rifled bullet spins on its axis; in bullet time, barely.
    bulletMaterial.uniforms.uSpin!.value = sim * 9;
    bullets.forEach((bullet, index) => {
      bulletUniforms[index]!.set(bullet.pos.x, bullet.pos.y, bullet.pos.z, bullet.flown);
      // The lathe stands on +y: turn it to the flight, its tip on the bullet's place.
      const shell = shells[index]!;
      shell.quaternion.copy(facing.setFromUnitVectors(alongY, bullet.dir));
      shell.position.copy(bullet.pos).addScaledVector(bullet.dir, -BULLET_L);
      dirUniforms[index]!.copy(bullet.dir);
    });

    // The camera of the film: it swings round the frozen moment, slowly.
    const pose = still ? { x: 0.35, y: -0.2 } : target;
    turn.x = still ? pose.x : approach(turn.x, pose.x, 0.03, dt);
    turn.y = still ? pose.y : approach(turn.y, pose.y, 0.03, dt);
    const drift = still ? 0 : Math.sin(time / 1000 / 8) * 0.06;
    moment.rotation.y = turn.x * 0.34 + drift;
    moment.rotation.x = 0.06 + turn.y * 0.12;

    shared.uPower.value = stage.power;
    const lit = stage.power > 0.002;
    if (!lit && dark) return;
    dark = !lit;
    renderer.render(scene, camera);

    if (!ready) {
      ready = true;
      onReady?.();
    }
    if (!still && lit) wake();
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
  measure();

  return {
    dispose() {
      disposed = true;
      sleep();
      listeners.abort();
      resizes.disconnect();
      attributes.disconnect();
      rainGeometry.dispose();
      rainMaterial.dispose();
      wakeGeometry.dispose();
      wakeMaterial.dispose();
      bulletGeometry.dispose();
      bulletMaterial.dispose();
      atlas.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
