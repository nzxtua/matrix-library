import { describe, expect, test } from "vite-plus/test";

import { shelve, slugOf } from "#/lib/shelf";

describe("the shelf", () => {
  test("reads numbers in file names as numbers", () => {
    const order = shelve(["/c/10-faq.md", "/c/2-setup.md", "/c/1-intro.md", "/c/notes.md"]);

    expect(order.map((entry) => entry.file)).toEqual([
      "1-intro.md",
      "2-setup.md",
      "10-faq.md",
      "notes.md",
    ]);
  });

  test("gives every document its own address", () => {
    const order = shelve(["/c/Read Me.md", "/c/read-me.md", "/c/README.md"]);

    expect(new Set(order.map((entry) => entry.slug)).size).toBe(3);
    expect(order.every((entry) => entry.slug.startsWith("read"))).toBe(true);
  });

  test.each([
    ["02 Setup.md", "02-setup"],
    ["Überblick.md", "uberblick"],
    ["Огляд системи.md", "огляд-системи"],
    ["!!!.md", "doc"],
  ])("%s is at %s", (file, slug) => {
    expect(slugOf(file)).toBe(slug);
  });
});
