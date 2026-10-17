import type { CSSProperties } from "react";

import type { SkillRow } from "#/lib/markdown";
import { markTint, skillMark } from "#/lib/skill-marks";
import type { SkillMark } from "#/lib/skill-marks";

/** The width of a mark over its height: a wordmark (AWS) runs wider than 1. */
function aspect(viewBox: string): number {
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  return width / height;
}

function Mark({ mark }: { mark: SkillMark }) {
  if (mark.kind === "image") {
    return <img className="doc-skill__mark" src={mark.src} alt="" decoding="async" />;
  }
  if (mark.kind === "art" || mark.kind === "symbol") {
    return (
      <svg
        className="doc-skill__mark"
        data-art={mark.kind === "art" || undefined}
        data-symbol={mark.kind === "symbol" || undefined}
        viewBox={mark.viewBox}
        style={{ aspectRatio: aspect(mark.viewBox) }}
        aria-hidden="true"
        focusable="false"
        // Vendored artwork from `skill-art.ts`, never user input.
        dangerouslySetInnerHTML={{ __html: mark.body }}
      />
    );
  }
  return (
    <svg className="doc-skill__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={mark.path} />
    </svg>
  );
}

/**
 * A skills row ("**Web**\tTypeScript, Vite"): the label in its own column, then
 * one capsule per tool with its real mark in its own colour. A tool without a
 * mark gets a quiet dot, never a drawn stand-in. Hidden commas and brackets
 * keep a copy of the row in the words of the source.
 */
export function SkillLine({ row }: { row: SkillRow }) {
  const last = row.items.length - 1;
  return (
    <div className="doc-skill">
      <p className="doc-skill__label">
        {row.label}
        <span className="sr-only">: </span>
      </p>
      <ul className="doc-skill__list" aria-label={row.label}>
        {row.items.map((item, index) => {
          const mark = skillMark(item.name);
          const style = { "--n": index, "--brand": markTint(mark) } as CSSProperties;
          return (
            <li key={index} className="doc-skill__item" style={style}>
              {mark ? <Mark mark={mark} /> : <span className="doc-skill__dot" aria-hidden="true" />}
              <span className="doc-skill__name">{item.name}</span>
              {item.detail && (
                <span className="doc-skill__detail">
                  <span className="sr-only"> (</span>
                  {item.detail}
                  <span className="sr-only">)</span>
                </span>
              )}
              {index < last && <span className="sr-only">, </span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
