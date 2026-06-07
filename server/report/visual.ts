import "server-only";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export interface VisualDiff {
  /** true when the two images have different dimensions (cannot overlay). */
  dimensionMismatch: boolean;
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  /** diffPixels / totalPixels, in [0, 1]. */
  mismatchRatio: number;
  /** PNG bytes highlighting the changed pixels (empty on dimension mismatch). */
  diffPng: Buffer;
}

/**
 * Compare two PNG images and produce a pixel diff. Pure function over byte
 * buffers so it can be unit-tested without a browser or the filesystem.
 */
export function diffPng(
  baseline: Buffer,
  current: Buffer,
  pixelThreshold = 0.1,
): VisualDiff {
  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(current);

  if (a.width !== b.width || a.height !== b.height) {
    return {
      dimensionMismatch: true,
      width: b.width,
      height: b.height,
      diffPixels: b.width * b.height,
      totalPixels: b.width * b.height,
      mismatchRatio: 1,
      diffPng: Buffer.alloc(0),
    };
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: pixelThreshold,
  });
  const totalPixels = width * height;

  return {
    dimensionMismatch: false,
    width,
    height,
    diffPixels,
    totalPixels,
    mismatchRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    diffPng: PNG.sync.write(diff),
  };
}
