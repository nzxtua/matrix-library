import { useEffect } from "react";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import { startConsole } from "#/lib/console";
import { PREFS_BOOT_SCRIPT } from "#/lib/prefs";
import { useVibe } from "#/lib/vibes";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        title: "Enter",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  // The prerendered shell has the default vibe; the reader's own vibe follows
  // on the client.
  const vibe = useVibe();

  // Both pages: whoever opens the devtools finds the wiring.
  useEffect(() => startConsole(), []);

  return (
    // The boot script sets `data-vibe`, `data-size`, `data-motion` and `data-calm` on <html>
    // before React hydrates: those attributes are not React's to check.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* First in <head>: the reader's look is set before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
        <HeadContent />
        {/* The browser's own chrome takes a trace of the light. */}
        <meta name="theme-color" content={vibe.themeColor} />
      </head>
      {/* Browser extensions (Grammarly and others) add attributes to <body>
          before React hydrates. This silences that mismatch for <body>'s own
          attributes only; its children are still checked. */}
      <body suppressHydrationWarning>
        {children}

        <Scripts />
      </body>
    </html>
  );
}
