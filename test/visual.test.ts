import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { diffPng } from "@/server/report/visual";
import { routeKey } from "@/server/store/baselines";

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe("diffPng", () => {
  it("reports zero mismatch for identical images", () => {
    const a = solidPng(20, 20, [255, 0, 0, 255]);
    const b = solidPng(20, 20, [255, 0, 0, 255]);
    const d = diffPng(a, b);
    expect(d.dimensionMismatch).toBe(false);
    expect(d.diffPixels).toBe(0);
    expect(d.mismatchRatio).toBe(0);
  });

  it("reports full mismatch for completely different images", () => {
    const a = solidPng(20, 20, [255, 0, 0, 255]);
    const b = solidPng(20, 20, [0, 0, 255, 255]);
    const d = diffPng(a, b);
    expect(d.diffPixels).toBeGreaterThan(0);
    expect(d.mismatchRatio).toBeGreaterThan(0.9);
    expect(d.diffPng.length).toBeGreaterThan(0);
  });

  it("flags a dimension mismatch when sizes differ", () => {
    const a = solidPng(20, 20, [0, 0, 0, 255]);
    const b = solidPng(30, 20, [0, 0, 0, 255]);
    const d = diffPng(a, b);
    expect(d.dimensionMismatch).toBe(true);
    expect(d.mismatchRatio).toBe(1);
  });
});

describe("routeKey", () => {
  it("slugifies a route path", () => {
    expect(routeKey("/login")).toBe("login");
    expect(routeKey("/users/profile")).toBe("users-profile");
  });

  it("strips an origin and falls back to root", () => {
    expect(routeKey("http://localhost:3000/")).toBe("root");
    expect(routeKey("/")).toBe("root");
  });
});
