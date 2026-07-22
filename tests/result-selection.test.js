// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import { getNextResultIndex } from "../result-selection.js";

test("down moves from the visually highlighted first result to the second", () => {
  assert.equal(getNextResultIndex(-1, 3), 1);
});

test("down activates the first result when it is the only result", () => {
  assert.equal(getNextResultIndex(-1, 1), 0);
});

test("down advances an active selection and stops at the last result", () => {
  assert.equal(getNextResultIndex(0, 3), 1);
  assert.equal(getNextResultIndex(1, 3), 2);
  assert.equal(getNextResultIndex(2, 3), 2);
});

test("down leaves selection inactive when there are no results", () => {
  assert.equal(getNextResultIndex(-1, 0), -1);
});
