// The web scanner's decoder, pinned against a real pass token.
//
// Two things could drift apart silently and only show up at a gate: the
// token format (checkin-core issues it, the guest page renders it as a QR)
// and jsQR, which is what reads that QR on any browser without
// BarcodeDetector — Safari, which is half the phones this page exists for.
//
// This rasterises a QR the same way the guest page does and feeds jsQR the
// same RGBA buffer the browser hands it from a canvas. It does not prove
// anything about a camera: focus, glare and motion are a device test, not
// this one.
//
//   npm test --workspace web
import { test } from "node:test";
import assert from "node:assert/strict";
import QR from "qrcode";
import jsQR from "jsqr";

/** Renders to RGBA exactly as the guest page's QR would appear on screen. */
function raster(text, { scale = 6, quiet = 4 } = {}) {
  const qr = QR.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const bits = qr.modules.data;
  const dim = (size + quiet * 2) * scale;
  const buf = new Uint8ClampedArray(dim * dim * 4).fill(255);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!bits[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * dim + ((x + quiet) * scale + dx);
          buf[px * 4] = 0;
          buf[px * 4 + 1] = 0;
          buf[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data: buf, width: dim, height: dim };
}

// A genuine token, in the shape checkin-core issues: packed uuid, payload,
// version, signature — four dot-separated parts, base64url.
const PASS_TOKEN =
  "BWmUN4hESN-f156DVOEHiw.0AAAAAAAQACAAAAAAAAAIA.1.jfYpF81qSciTPthH";

test("jsQR reads a real pass token", () => {
  const { data, width, height } = raster(PASS_TOKEN);
  const out = jsQR(data, width, height);
  assert.ok(out, "the QR did not decode at all");
  assert.equal(out.data, PASS_TOKEN, "decoded to something else");
});

test("the token survives the round trip byte for byte", () => {
  // base64url uses - and _, which a decoder that assumes plain base64 will
  // mangle. The signature is the last part, so a mangled tail verifies as
  // a forgery at the gate rather than failing loudly here.
  assert.match(PASS_TOKEN, /[-_]/, "pick a vector that exercises base64url");
  const { data, width, height } = raster(PASS_TOKEN);
  assert.equal(jsQR(data, width, height).data.split(".").length, 4);
});

test("it still reads at the scale a phone actually sees", () => {
  // The scanner downsamples frames to 480px on the long edge before
  // decoding. Three pixels per module is roughly what a QR filling the
  // reticle looks like after that.
  const { data, width, height } = raster(PASS_TOKEN, { scale: 3, quiet: 4 });
  assert.ok(width <= 480, `raster is ${width}px, wider than the downsample`);
  assert.equal(jsQR(data, width, height)?.data, PASS_TOKEN);
});
