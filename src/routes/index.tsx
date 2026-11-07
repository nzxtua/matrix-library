import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import { MatrixFlashlight } from "#/components/MatrixFlashlight";

/**
 * The prerendered shell holds no route: where this page goes, the shell has an
 * empty Suspense boundary. This route has no loader, so it is ready before
 * React hydrates the shell, and a page rendered at once would not match it
 * (React error 418 in the production build). `ClientOnly` renders nothing
 * while React hydrates, and the page right after.
 */
function EnterPage() {
  return (
    <ClientOnly>
      <MatrixFlashlight />
    </ClientOnly>
  );
}

export const Route = createFileRoute("/")({ wrapInSuspense: true, component: EnterPage });
