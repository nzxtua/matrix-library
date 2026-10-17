import {
  siApple,
  siAppium,
  siBitbucket,
  siClaude,
  siCursor,
  siFirebase,
  siJavascript,
  siJest,
  siNodedotjs,
  siNuxt,
  siOpenapiinitiative,
  siReact,
  siReactquery,
  siRedux,
  siStorybook,
  siTensorflow,
  siTestinglibrary,
  siTypescript,
  siVite,
  siVitest,
  siVuedotjs,
  siWebpack,
  siXcode,
} from "simple-icons";

import mmkvUrl from "#/assets/skills/mmkv.png";
import valtioUrl from "#/assets/skills/valtio.png";
import visionCameraUrl from "#/assets/skills/vision-camera.png";
import zustandUrl from "#/assets/skills/zustand.png";
import {
  aws,
  azurePipelines,
  deepLinking,
  gestureHandler,
  google,
  i18n,
  offline,
  playwright,
  reactNavigation,
  reanimated,
  rest,
} from "#/lib/skill-art";
import type { SkillArt } from "#/lib/skill-art";

/**
 * The real mark of a tool, in one of three shapes:
 * - `glyph`: a one-colour path on a 24 grid (simple-icons);
 * - `art`: multi-colour SVG markup (`skill-art.ts`);
 * - `image`: a raster, for a mark that only exists as one (Vision Camera) or
 *   whose SVG is too heavy to inline (Zustand);
 * - `symbol`: a line symbol for an idea that has no mark (REST, i18n), in the
 *   ink of the page.
 */
export type SkillMark =
  | { kind: "glyph"; path: string; colour?: string }
  | ({ kind: "art"; tint: string } & SkillArt)
  | { kind: "image"; src: string; tint: string }
  | ({ kind: "symbol" } & SkillArt);

/** A brand colour darker than this disappears on the page: the mark takes the ink. */
const MIN_LUMINANCE = 0.08;

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function glyph({ path, hex }: { path: string; hex: string }): SkillMark {
  return {
    kind: "glyph",
    path,
    colour: luminance(hex) < MIN_LUMINANCE ? undefined : `#${hex}`,
  };
}

/** `tint` is the brand colour the capsule glows with on hover. */
const art = (mark: SkillArt, tint: string): SkillMark => ({ kind: "art", tint, ...mark });
const image = (src: string, tint: string): SkillMark => ({ kind: "image", src, tint });
const symbol = (mark: SkillArt): SkillMark => ({ kind: "symbol", ...mark });

/** The colour a capsule glows with on hover; the accent when there is none. */
export function markTint(mark: SkillMark | undefined): string | undefined {
  if (!mark) return undefined;
  if (mark.kind === "symbol") return undefined;
  return mark.kind === "glyph" ? mark.colour : mark.tint;
}

/**
 * The mark of a tool, by the name a skills row gives it (lower case). MMKV
 * has no mark of its own: it shows Margelo, who make react-native-mmkv. A
 * name missing here gets a quiet dot, never a drawn stand-in.
 */
const MARKS: Record<string, SkillMark> = {
  "react native": glyph(siReact),
  "react.js": glyph(siReact),
  react: glyph(siReact),
  "react navigation": art(reactNavigation, "#7b61c1"),
  reanimated: art(reanimated, "#c1c6e5"),
  "gesture handler": art(gestureHandler, "#99a3c7"),
  "vision camera": image(visionCameraUrl, "#f5b53d"),
  mmkv: image(mmkvUrl, "#ffffff"),
  "deep linking": symbol(deepLinking),
  i18n: symbol(i18n),
  "offline-first architecture": symbol(offline),
  tflite: glyph(siTensorflow),
  "ml kit": art(google, "#4285f4"),
  typescript: glyph(siTypescript),
  javascript: glyph(siJavascript),
  "vue.js": glyph(siVuedotjs),
  "nuxt.js": glyph(siNuxt),
  "node.js": glyph(siNodedotjs),
  vite: glyph(siVite),
  webpack: glyph(siWebpack),
  "tanstack query": glyph(siReactquery),
  redux: glyph(siRedux),
  zustand: image(zustandUrl, "#c77f6d"),
  valtio: image(valtioUrl, "#ffffff"),
  rest: symbol(rest),
  openapi: glyph(siOpenapiinitiative),
  appium: glyph(siAppium),
  "aws device farm": art(aws, "#ff9900"),
  "react testing library": glyph(siTestinglibrary),
  playwright: art(playwright, "#2ead33"),
  jest: glyph(siJest),
  vitest: glyph(siVitest),
  storybook: glyph(siStorybook),
  "azure pipelines": art(azurePipelines, "#2560e0"),
  "bitbucket pipelines": glyph(siBitbucket),
  "xcode cloud": glyph(siXcode),
  testflight: glyph(siApple),
  firebase: glyph(siFirebase),
  "claude code": glyph(siClaude),
  cursor: glyph(siCursor),
};

export function skillMark(name: string): SkillMark | undefined {
  return MARKS[name.toLowerCase()];
}
