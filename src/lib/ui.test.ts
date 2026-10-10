import { beforeEach, describe, expect, test } from "vite-plus/test";

import { getUi, setRuler, setTorch } from "#/lib/ui";

describe("the ruler and the torch", () => {
  beforeEach(() => {
    setRuler(false);
    setTorch(false);
  });

  test("the torch puts the ruler away", () => {
    setRuler(true);
    setTorch(true);
    expect(getUi()).toMatchObject({ torch: true, ruler: false });
  });

  test("the ruler puts the torch away", () => {
    setTorch(true);
    setRuler(true);
    expect(getUi()).toMatchObject({ torch: false, ruler: true });
  });

  test("switching one off leaves the other as it was", () => {
    setRuler(true);
    setTorch(false);
    expect(getUi()).toMatchObject({ torch: false, ruler: true });
  });
});
