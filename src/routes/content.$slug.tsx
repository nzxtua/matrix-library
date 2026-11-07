import { createFileRoute, redirect } from "@tanstack/react-router";

import { DocPage } from "#/components/ContentPage";

export const Route = createFileRoute("/content/$slug")({
  // The dynamic import keeps the documents out of the Enter page's bundle, and
  // lets `preloadRoute` fetch them while the Enter button shows its progress.
  loader: async ({ params }) => {
    const { docBySlug } = await import("#/lib/content");
    const doc = docBySlug(params.slug);
    // A document that is gone: the library shows what there is.
    if (!doc) throw redirect({ to: "/content", replace: true });
    return { title: doc.title };
  },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.title }] }),
  component: DocPage,
});
