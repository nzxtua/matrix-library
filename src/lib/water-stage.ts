/**
 * The water: a still pool under the card of the next document, at the foot
 * of a content page (Three.js, WebGL). No React.
 *
 * The card stands on the water and the water reflects it, flipped at its foot:
 * the card itself, painted from the page, its edge, its words in their fonts
 * and colours, its arrow and its tubes. The surface is a height field seen in
 * perspective, so a ripple is a flat ellipse. Wind runs across it in long low
 * waves, and they draw the reflection out into streaks the further it lies
 * from the card. The light of the vibe (`--accent`) catches the crests.
 *
 * Rain falls into it: now and then a drop rings out somewhere on the pool.
 * The pointer is a finger in the water: moving over the pool leaves a wake, a
 * press splashes. The pool settles in the first time the card comes into view,
 * with one drop under its middle. A card under the pointer is painted again,
 * so the water shows it lit.
 *
 * `data-calm` makes it still water, drawn once per change.
 *
 * Load this module with a dynamic `import()` only: it imports `three`.
 */

import {
  CanvasTexture,
  FrontSide,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

import { approach, lightMaterial, rgbOf } from "#/lib/three-ink";

/* ──────────────────────────────── Layout ──────────────────────────────── */

/** A box in pixels: viewport or page, as the caller says. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The deepest the pool goes, in pixels. */
export const POOL_DEPTH = 170;

/**
 * The pool under `card`: from its foot down, as wide as it, as deep as the
 * `room` under the card allows and never deeper than `POOL_DEPTH`.
 */
export function poolUnder(card: Rect, room: number): Rect {
  return {
    left: card.left,
    top: card.top + card.height,
    width: card.width,
    height: Math.min(Math.max(room, 0), POOL_DEPTH),
  };
}

/** Depth scale of the water, in pixels: smaller is a steeper view. */
export const FLOOR_D = 240;
/** Pixels below the foot where the water would meet the horizon. */
export const FLOOR_V0 = 10;

/**
 * A point of the pool on the plane of the water. `x` is pixels from the
 * centre of the pool, `v` pixels below the foot of the card. Units grow with
 * distance: one unit is `v + FLOOR_V0` pixels wide on screen.
 */
export function floorAt(x: number, v: number): { x: number; z: number } {
  const near = Math.max(v, 0) + FLOOR_V0;
  return { x: x / near, z: FLOOR_D / near };
}

/* ─────────────────────────────── Shaders ─────────────────────────────── */

/** Ripples alive at once: the oldest gives way. */
const RIPPLES = 14;

const POOL_VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vLocal; // pixels: x from the left, y down from the foot of the card
void main() {
  vLocal = vec2((position.x + 0.5) * uSize.x, (0.5 - position.y) * uSize.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const POOL_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform sampler2D uCard;
uniform vec4 uCardBox;   // left, top (relative to the foot, negative), width, height: pixels
uniform vec4 uRipples[${RIPPLES}]; // floor x, floor z, age (s), amplitude
uniform float uTime;
uniform vec3 uPointer;   // pixels in the pool, and presence
uniform vec3 uInk;
uniform vec3 uHaze;
uniform float uPower;
varying vec2 vLocal;

float height(vec2 p) {
  // Wind: long low waves across, and a finer chop over them.
  float h = 0.011 * sin(p.x * 1.2 + p.y * 0.5 + uTime * 0.9)
          + 0.007 * sin(-p.x * 0.7 + p.y * 1.6 + uTime * 1.3)
          + 0.003 * sin(p.x * 3.3 - p.y * 2.1 + uTime * 2.2);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float d = distance(p, r.xy);
    float front = d - r.z * 2.1;
    float ring = exp(-front * front / 0.35);
    h += r.w * sin(front * 20.0) * ring * exp(-r.z * 1.4);
  }
  return h;
}

vec4 card(vec2 seen, float blur) {
  vec2 uv = seen / uCardBox.zw;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture2D(uCard, uv, blur) * inside;
}

void main() {
  float x = vLocal.x;
  float v = vLocal.y;
  float near = v + ${FLOOR_V0.toFixed(1)};
  vec2 floorP = vec2((x - uSize.x * 0.5) / near, ${FLOOR_D.toFixed(1)} / near);

  float e = 0.02;
  float h = height(floorP);
  float hx = (height(floorP + vec2(e, 0.0)) - h) / e;
  float hz = (height(floorP + vec2(0.0, e)) - h) / e;

  float depth = clamp(v / max(uSize.y, 1.0), 0.0, 1.0);
  float lean = near / (uSize.y + ${FLOOR_V0.toFixed(1)});
  vec2 bend = vec2(hx * 40.0, hz * 16.0) * (0.35 + lean);

  // The card, flipped at its foot. Wind draws it out into streaks: a few
  // samples down the water, further apart the further from the card.
  vec2 seen = vec2(x + bend.x - uCardBox.x, -v + bend.y - uCardBox.y);
  float streak = 1.0 + depth * 14.0;
  float blur = depth * 2.0;
  vec4 reflected = card(seen, blur) * 0.3
                 + card(seen + vec2(0.0, streak), blur) * 0.25
                 + card(seen - vec2(0.0, streak), blur) * 0.25
                 + card(seen + vec2(0.0, streak * 2.0), blur) * 0.2;

  // Water reflects most at a grazing look, near the card; it is dark and
  // clear further toward the reader, tinted by the light of the vibe.
  float fresnel = mix(0.85, 0.16, pow(depth, 0.7));
  vec3 tint = mix(vec3(1.0), uHaze * 0.6 + 0.4, 0.22);
  vec3 colour = reflected.rgb * tint * fresnel;
  colour += uHaze * 0.022 * (1.0 - depth);

  // Crests catch the light of the vibe; the finger brings it closer.
  float crest = smoothstep(0.02, 0.1, -hz) * 0.16;
  float finger = uPointer.z * exp(-dot(vLocal - uPointer.xy, vLocal - uPointer.xy) / 9000.0);
  colour += mix(vec3(0.9), uInk, 0.6) * crest * (0.45 + finger * 1.8);

  // Soft at the ends and at the bottom; a hairline of light where the card
  // meets the water.
  float edge = smoothstep(0.0, 40.0, x) * smoothstep(0.0, 40.0, uSize.x - x);
  float fade = (1.0 - smoothstep(0.45, 1.0, depth)) * smoothstep(0.0, 2.0, v);
  colour += mix(vec3(1.0), uInk, 0.5) * exp(-v * 0.9) * 0.08;
  gl_FragColor = light(colour * edge * fade * uPower);
}`;

/* ──────────────────────────────── The card ──────────────────────────────── */

/** The arrow of the card (`Shelf.tsx`), in its 20 × 20 box. */
const ARROW = "M4 10h12m-4.5-4.5L16 10l-4.5 4.5";

/** Paints `card` as the page shows it: its face, its edge, its words, arrow and tubes. */
function paintCard(card: HTMLElement, canvas: HTMLCanvasElement, ratio: number): Rect {
  const box = card.getBoundingClientRect();
  const pad = 8;
  const frame = {
    left: box.left - pad,
    top: box.top - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
  canvas.width = Math.max(1, Math.round(frame.width * ratio));
  canvas.height = Math.max(1, Math.round(frame.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return frame;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, frame.width, frame.height);
  const at = (rect: DOMRect) => ({ x: rect.left - frame.left, y: rect.top - frame.top });

  // The face and the edge.
  const face = getComputedStyle(card);
  const radius = Number.parseFloat(face.borderTopLeftRadius) || 0;
  ctx.beginPath();
  ctx.roundRect(pad + 0.5, pad + 0.5, box.width - 1, box.height - 1, radius);
  ctx.fillStyle = face.backgroundColor;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = face.borderTopColor;
  ctx.stroke();

  // The words, each fitted to its place.
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element) continue;
    const style = getComputedStyle(element);
    const stroke = Number.parseFloat(style.getPropertyValue("-webkit-text-stroke-width")) || 0;
    const text = node.textContent ?? "";
    for (const match of text.matchAll(/\S+/g)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rect = range.getClientRects()[0];
      if (!rect || rect.width === 0) continue;
      const word = style.textTransform === "uppercase" ? match[0].toUpperCase() : match[0];
      ctx.save();
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing;
      const metrics = ctx.measureText(word);
      const ascent = metrics.fontBoundingBoxAscent || rect.height * 0.8;
      const content = ascent + (metrics.fontBoundingBoxDescent || rect.height * 0.2);
      const place = at(rect);
      ctx.translate(place.x, place.y + (rect.height - content) / 2 + ascent);
      ctx.scale(rect.width / Math.max(metrics.width, 1), 1);
      if (stroke > 0) {
        ctx.lineJoin = "round";
        ctx.lineWidth = stroke * 2;
        ctx.strokeStyle = style.getPropertyValue("-webkit-text-stroke-color");
        ctx.strokeText(word, 0, 0);
      }
      ctx.fillStyle = style.color;
      ctx.fillText(word, 0, 0);
      ctx.restore();
    }
  }

  // The arrow.
  for (const arrow of card.querySelectorAll<SVGElement>(".shelf-arrow")) {
    const rect = arrow.getBoundingClientRect();
    const place = at(rect);
    ctx.save();
    ctx.translate(place.x, place.y);
    ctx.scale(rect.width / 20, rect.height / 20);
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(arrow).color;
    ctx.stroke(new Path2D(ARROW));
    ctx.restore();
  }

  // The tubes of the end card, filled by their read share.
  for (const tube of card.querySelectorAll<HTMLElement>(".doc-next__tubes i")) {
    const rect = tube.getBoundingClientRect();
    const place = at(rect);
    const read = Number.parseFloat(getComputedStyle(tube).getPropertyValue("--read")) || 0;
    const ink = `rgb(${getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()})`;
    ctx.beginPath();
    ctx.roundRect(place.x, place.y, rect.width, rect.height, rect.width / 2);
    ctx.fillStyle = "rgb(255 255 255 / 0.08)";
    ctx.fill();
    if (read > 0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.fillRect(place.x, place.y + rect.height * (1 - read), rect.width, rect.height * read);
      ctx.restore();
    }
  }
  return frame;
}

/* ───────────────────────────────── Stage ───────────────────────────────── */

export interface Water {
  dispose(): void;
}

export interface WaterOptions {
  canvas: HTMLCanvasElement;
  /** The card of the next document: what the water reflects. */
  card: HTMLElement;
  /** The document column: the pool ends where it ends. */
  root: HTMLElement;
  /** Called after the first frame is drawn. */
  onReady?: () => void;
}

/** Mount the water on `canvas`. Throws when WebGL is not there: the page is whole without it. */
export function mountWater({ canvas, card, root, onReady }: WaterOptions): Water {
  const calm = () => document.documentElement.hasAttribute("data-calm");

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  // The shader writes display colours as they are: no conversion on the way out.
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  // One unit is one CSS pixel; y runs up, so the page's y is negated.
  const camera = new OrthographicCamera(0, 1, 0, -1, -10, 10);

  const paper = document.createElement("canvas");
  const cardTexture = new CanvasTexture(paper);
  cardTexture.flipY = false;
  cardTexture.generateMipmaps = true;
  cardTexture.minFilter = LinearMipmapLinearFilter;

  const token = (name: string, fallback: [number, number, number]) =>
    rgbOf(getComputedStyle(document.documentElement).getPropertyValue(name), fallback);
  const uniforms = {
    uSize: { value: new Vector2(1, 1) },
    uCard: { value: cardTexture },
    uCardBox: { value: new Vector4(0, -1, 1, 1) },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector4()) },
    uTime: { value: 0 },
    uPointer: { value: new Vector3() },
    uInk: { value: new Vector3(...token("--accent", [0.8, 1, 0])) },
    uHaze: { value: new Vector3(...token("--haze", [0.56, 0, 1])) },
    uPower: { value: 0 },
  };
  const material = lightMaterial(POOL_VERT, POOL_FRAG, uniforms, FrontSide);
  const geometry = new PlaneGeometry(1, 1);
  const pool = new Mesh(geometry, material);
  pool.frustumCulled = false;
  scene.add(pool);

  /* ───────── Size and place ───────── */

  let view = { width: 1, height: 1 };
  let ratio = 1;
  /** Page coordinates of the card, and the room under it: read on resize only. */
  let cardAt: Rect = { left: 0, top: 0, width: 0, height: 0 };
  let room = 0;
  /** The painted card, relative to the card's own box. */
  let paintOffset = { left: 0, top: 0, width: 1, height: 1 };
  let area: Rect = { left: 0, top: 0, width: 0, height: 0 };

  function repaint() {
    const frame = paintCard(card, paper, ratio);
    const box = card.getBoundingClientRect();
    paintOffset = {
      left: frame.left - box.left,
      top: frame.top - box.top,
      width: frame.width,
      height: frame.height,
    };
    cardTexture.needsUpdate = true;
    layout();
  }

  function measure() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.right = width;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    view = { width, height };
    const rect = card.getBoundingClientRect();
    cardAt = {
      left: rect.left,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
    room = root.getBoundingClientRect().bottom - rect.bottom;
    repaint();
  }

  function layout() {
    const cardNow = { ...cardAt, top: cardAt.top - window.scrollY };
    area = poolUnder(cardNow, room);
    pool.position.set(area.left + area.width / 2, -(area.top + area.height / 2), 0);
    pool.scale.set(Math.max(area.width, 1), Math.max(area.height, 1), 1);
    uniforms.uSize.value.set(area.width, area.height);
    uniforms.uCardBox.value.set(
      paintOffset.left,
      paintOffset.top - cardNow.height,
      paintOffset.width,
      paintOffset.height,
    );
    wake();
  }

  /* ───────── Drops ───────── */

  let clock = 0;
  const ripples = uniforms.uRipples.value;
  let next = 0;

  /** A drop into the pool. Still water stays still. */
  function drop(x: number, v: number, amplitude: number) {
    if (calm()) return;
    const at = floorAt(x - area.width / 2, v);
    ripples[next]!.set(at.x, at.z, 0, amplitude);
    next = (next + 1) % RIPPLES;
    wake();
  }

  const finger = { x: 0, v: 0, on: false };
  let lastDrop = { x: 0, v: 0, at: 0 };
  const inPool = (clientX: number, clientY: number) =>
    clientX >= area.left &&
    clientX <= area.left + area.width &&
    clientY >= area.top &&
    clientY <= area.top + area.height;

  const listeners = new AbortController();
  const { signal } = listeners;

  window.addEventListener(
    "pointermove",
    (event) => {
      finger.on = inPool(event.clientX, event.clientY);
      if (!finger.on) return;
      finger.x = event.clientX - area.left;
      finger.v = event.clientY - area.top;
      const moved = Math.hypot(finger.x - lastDrop.x, finger.v - lastDrop.v);
      if (moved > 16 && clock - lastDrop.at > 0.06) {
        drop(finger.x, finger.v, Math.min(0.018 + moved / 1800, 0.045));
        lastDrop = { x: finger.x, v: finger.v, at: clock };
      }
      wake();
    },
    { signal, passive: true },
  );
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (inPool(event.clientX, event.clientY)) {
        drop(event.clientX - area.left, event.clientY - area.top, 0.1);
      }
    },
    { signal, passive: true },
  );
  document.documentElement.addEventListener(
    "pointerleave",
    () => {
      finger.on = false;
      wake();
    },
    { signal },
  );
  // The card lit or put out: the water shows it once its light has settled.
  let repaintTimer = 0;
  const repaintSoon = () => {
    window.clearTimeout(repaintTimer);
    repaintTimer = window.setTimeout(repaint, 260);
  };
  for (const type of ["pointerenter", "pointerleave", "focusin", "focusout"]) {
    card.addEventListener(type, repaintSoon, { signal });
  }
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
  document.fonts.addEventListener("loadingdone", () => repaint(), { signal });

  // A folded code block or a filtered table moves the card: measure again.
  const resizes = new ResizeObserver(() => measure());
  resizes.observe(canvas);
  resizes.observe(card);
  resizes.observe(root);

  // A new vibe brings new ink, on the card too.
  const attributes = new MutationObserver(() => {
    uniforms.uInk.value.set(...token("--accent", [0.8, 1, 0]));
    uniforms.uHaze.value.set(...token("--haze", [0.56, 0, 1]));
    repaint();
  });
  attributes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-vibe", "data-calm", "data-size"],
  });

  /* ───────── Frame ───────── */

  let frame = 0;
  let last = 0;
  let nextRain = 1.5;
  /** Wall time the card first came into view: the pool settles in from then. */
  let seenAt = 0;
  let presence = 0;
  let ready = false;
  let dark = false;

  function draw(time: number) {
    frame = 0;
    const still = calm();
    const dt = last ? Math.min((time - last) / 1000, 0.1) : 1 / 60;
    last = time;

    const lit = area.height > 0 && area.top < view.height && area.top + area.height > 0;
    if (lit && !seenAt) {
      seenAt = time;
      drop(Math.min(area.width / 2, area.width * 0.4), 6, 0.08);
    }
    const settled = still ? 1 : Math.min(seenAt ? (time - seenAt) / 1200 : 0, 1);
    uniforms.uPower.value = settled * settled * (3 - 2 * settled);

    if (!still && lit) {
      clock += dt;
      // Rain falls into it: a drop somewhere on the pool, now and then.
      if (clock > nextRain) {
        nextRain = clock + 0.5 + Math.random() * 1.6;
        drop(
          Math.random() * area.width,
          area.height * (0.15 + Math.random() * 0.75),
          0.018 + Math.random() * 0.03,
        );
      }
    }
    for (const ripple of ripples) {
      if (ripple.w <= 0) continue;
      ripple.z += still ? 0 : dt;
      if (ripple.z > 5) ripple.w = 0;
    }
    presence = still ? (finger.on ? 1 : 0) : approach(presence, finger.on ? 1 : 0, 0.1, dt);
    uniforms.uPointer.value.set(finger.x, finger.v, presence);
    uniforms.uTime.value = clock;

    if (!lit && dark) return;
    dark = !lit;
    pool.visible = lit;
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
      window.clearTimeout(repaintTimer);
      listeners.abort();
      resizes.disconnect();
      attributes.disconnect();
      geometry.dispose();
      material.dispose();
      cardTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
