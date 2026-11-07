import { createFileRoute } from "@tanstack/react-router";

import { LibraryPage } from "#/components/Library";
import { copy } from "#/lib/copy";

export const Route = createFileRoute("/content/")({
  head: () => ({ meta: [{ title: copy.library.pageTitle }] }),
  component: LibraryPage,
});
