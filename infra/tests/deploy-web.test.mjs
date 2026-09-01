import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheControlFor, contentTypeFor } from "../scripts/deploy-web.mjs";

test("html revalidates in the browser but lets CloudFront hold briefly", () => {
  assert.equal(cacheControlFor("index.html"), "public, max-age=0, s-maxage=300");
  assert.equal(cacheControlFor("chat/index.html"), "public, max-age=0, s-maxage=300");
});

test("hashed bundles are immutable for a year", () => {
  assert.equal(
    cacheControlFor("assets/chat-Be5YMDAU.js"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    cacheControlFor("assets/thingy-page-entry-Bdo7nhWf.css"),
    "public, max-age=31536000, immutable",
  );
  // Unhashed names must never be immutable.
  assert.equal(cacheControlFor("assets/short-x.js"), "public, max-age=3600");
});

test("images and icons cache for a week, the rest for an hour", () => {
  assert.equal(cacheControlFor("img/thingy.png"), "public, max-age=604800");
  assert.equal(cacheControlFor("favicon.svg"), "public, max-age=604800");
  assert.equal(cacheControlFor("robots.txt"), "public, max-age=3600");
  assert.equal(cacheControlFor("sitemap.xml"), "public, max-age=3600");
});

test("content types resolve by extension with a safe fallback", () => {
  assert.equal(contentTypeFor("chat/index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("assets/a-12345678.js"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeFor("favicon.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("mystery.bin"), "application/octet-stream");
});
