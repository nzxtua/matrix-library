import { describe, expect, test } from "vite-plus/test";

import { groupHotkeys } from "#/components/Keymap";

describe("groupHotkeys", () => {
  test("two shortcuts for one thing are one row, in the order of registration", () => {
    const groups = groupHotkeys([
      { keys: "mod+k", label: "search", group: "find" },
      { keys: "e", label: "echo", group: "find" },
      { keys: "/", label: "search", group: "find" },
    ]);

    expect(groups).toEqual([
      {
        group: "find",
        rows: [
          { label: "search", keys: ["mod+k", "/"] },
          { label: "echo", keys: ["e"] },
        ],
      },
    ]);
  });

  test("a shortcut that is registered twice shows once", () => {
    const groups = groupHotkeys([
      { keys: "?", label: "keys", group: "page" },
      { keys: "?", label: "keys", group: "page" },
    ]);

    expect(groups).toEqual([{ group: "page", rows: [{ label: "keys", keys: ["?"] }] }]);
  });

  test("the groups keep one order, whatever was registered first", () => {
    const groups = groupHotkeys([
      { keys: "?", label: "keys", group: "page" },
      { keys: "j", label: "next block", group: "read" },
      { keys: "l", label: "ruler", group: "light" },
      { keys: "/", label: "search", group: "find" },
    ]);

    expect(groups.map(({ group }) => group)).toEqual(["find", "light", "read", "page"]);
  });

  test("a group without keys is left out", () => {
    const groups = groupHotkeys([{ keys: "l", label: "ruler", group: "light" }]);

    expect(groups.map(({ group }) => group)).toEqual(["light"]);
  });

  test("the same name in two groups is two rows", () => {
    const groups = groupHotkeys([
      { keys: "n", label: "next", group: "find" },
      { keys: "j", label: "next", group: "read" },
    ]);

    expect(groups).toEqual([
      { group: "find", rows: [{ label: "next", keys: ["n"] }] },
      { group: "read", rows: [{ label: "next", keys: ["j"] }] },
    ]);
  });
});
