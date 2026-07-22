// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchUri,
  getSearchEngine,
  SEARCH_ENGINES,
} from "../search-engines.js";

test("Google remains the default search engine", () => {
  assert.equal(SEARCH_ENGINES[0].key, "google");
  assert.equal(getSearchEngine("unknown").key, "google");
});

test("search URLs use the selected engine and encode the query", () => {
  assert.equal(
    buildSearchUri("duckduckgo", "GNOME extensions & themes"),
    "https://duckduckgo.com/?q=GNOME%20extensions%20%26%20themes",
  );
});

test("an invalid engine safely uses Google", () => {
  assert.equal(
    buildSearchUri("invalid", "superbar"),
    "https://www.google.com/search?q=superbar",
  );
});
