# 3D logo in the panel — short design

Date: 2026-11-23 · Status: awaiting approval

## Intent

The panel logo is `src/content/logo.png` drawn as 76-column ASCII art
(`AsciiImage`). The thin waves of the logo break up at that density. The
owner wants the logo in real 3D (Three.js), more detailed and closer to the
original, with an effect that feels unusual. Direction picked: **hybrid**.
At rest the logo is solid 3D. ASCII stays as the motion language: the logo
compiles out of glyphs, and a ring of glyphs runs through the relief.

## Goals

- Silhouette within about 1 px of the PNG at panel size, on Retina too.
- Real depth: extruded strokes, a rounded bevel, cast shadows.
- The pointer is a torch. A real light rides over the relief, so the
  highlights and shadows move with it.
- Works for any `logo.png`: the shape is traced from the image at runtime.
  The logo is content; it is not hard-coded.

## Non-goals / anti-goals

- No product-viewer orbit, no drag. The tilt is passive and small.
- No cost at rest: no animation frame runs while nothing changes.
- It must never draw attention away from reading. The rest state is dim
  ink, as today.
- It must not break the page without WebGL: then the ASCII logo stays.

## Approaches

|                | Approach                                                                                  | Trade-off                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **A (picked)** | Trace the PNG alpha to contours (marching squares), then one `ExtrudeGeometry` per stroke | Real meshes, real shadows, per-stroke motion. Exact outline. Generic for any logo. Costs a one-time trace (~10–30 ms). |
| B              | One SDF height-field in a fragment shader                                                 | Cheapest, smooth bevels. But the 3D is fake: it breaks at any real tilt, and the strokes cannot move one by one.       |
| C              | Hand-model the 20 strokes as sine curves                                                  | Perfect curves, but only for this logo. The site treats the logo as content. Rejected.                                 |

## Design (approach A)

**Trace** — `src/lib/logo-trace.ts`, pure, no DOM. Input: an ink mask
(alpha for a cut-out PNG; for an opaque PNG, the difference from the corner
colour). Output: shapes with holes, outer clockwise / holes the other way,
simplified (Ramer–Douglas–Peucker), specks dropped. Tests check behaviour:
2 blobs → 2 shapes; a ring → 1 shape with 1 hole; a speck is dropped; the
simplified outline stays within its tolerance.

**Stage** — `src/lib/logo-stage.ts`, Three.js, no React, loaded with a
dynamic `import()`, like `tube-stage.ts`.

- One mesh per stroke. Depth is about 4 % of the logo width. Rounded bevel.
- Ink material in the vibe colour (`--accent`). It glows dimly at rest:
  "there, but not lit".
- An invisible shadow-catcher plane, so the strokes cast soft shadows.
- **Torch**: a point light above the pointer. White core, accent falloff,
  a haze-coloured glow on the ground (`--haze`). The pointer also tilts the
  group a little, and the camera moves against it (Meng To
  _add-mouse-driven-orbit_: one damped target, unequal opposing layers,
  frame-rate independent damping).
- **Reveal** (first show, 1.1 s): the strokes rise out of the panel one by
  one, from the centre outwards, with a spring overshoot. A glyph band
  rides the rising front: the cells "compile" into solid strokes.
- **Ripple** (pointer enters, at most once per 1.4 s, 650 ms): a ring runs
  out from the entry point. It lifts the strokes in Z as it passes. Inside
  the ring the picture turns into glyphs. The glyphs are chosen by
  brightness, as in `ascii-art.ts`, and the cell size matches today's
  76-column art.
- ASCII post pass: the scene renders into a render target. A full-screen
  quad shows the crisp scene, and glyph cells only inside the storm band.
- Keyboard focus lights the whole logo.
- Calm (`data-calm`): no tilt, no rise, no ripple. Hover lights the whole
  logo. One still frame per change.
- Vibe colours are re-read when `data-vibe` changes.
- Cost: frames run only while something moves. Pause when the tab is
  hidden. DPR = min(devicePixelRatio, 2) (Meng To _3d-retina-resolution_,
  Auto mode). All GPU resources are disposed on unmount.

**Component** — `src/components/LogoStage.tsx`: a canvas with
`role="img"` and the label. It mounts the stage. Until the stage is ready,
or if WebGL fails, `AsciiImage` is shown as today.

**Edits** — `Panel.tsx` (use `LogoStage`), `styles/panel.css` (canvas size
and fade-in), `README.md` (panel description and file map).

## Left to the builder

The exact light intensities, the bevel size, the band width and the spring
constants. Tune them against screenshots of the four vibes.
