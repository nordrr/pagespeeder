import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEnteredUrl } from "../src/url-input.mjs";

test("adds HTTPS to bare domains and retains paths, ports, and query strings", () => {
  assert.equal(normalizeEnteredUrl("  example.com/shop?q=1  "), "https://example.com/shop?q=1");
  assert.equal(normalizeEnteredUrl("localhost:3000/path"), "https://localhost:3000/path");
  assert.equal(normalizeEnteredUrl("//example.com/path"), "https://example.com/path");
});

test("preserves explicit HTTP and HTTPS and rejects invalid or unsupported URLs", () => {
  assert.equal(normalizeEnteredUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(normalizeEnteredUrl("https://example.com"), "https://example.com/");
  for (const value of ["", "not a url", "ftp://example.com", "javascript:alert(1)"]) {
    assert.equal(normalizeEnteredUrl(value), "");
  }
});
