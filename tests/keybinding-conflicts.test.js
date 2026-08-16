// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeReplacedBindings,
  describeAccelRejection,
  encodeReplacedBindings,
  findAccelConflicts,
  formatConflictSummary,
  mergeReplacedBindings,
} from "../keybinding-conflicts.js";

// Stand-in for the Gtk.accelerator_parse based matcher used in preferences.
const caseInsensitiveMatch = (a, b) => a.toLowerCase() === b.toLowerCase();

const WINDOW_MENU = {
  schemaId: "org.gnome.desktop.wm.keybindings",
  label: "Windows",
  key: "activate-window-menu",
  summary: "Activate the window menu",
  accels: ["<Alt>space"],
};

const SWITCH_INPUT = {
  schemaId: "org.gnome.desktop.wm.keybindings",
  label: "Windows",
  key: "switch-input-source",
  summary: "Switch input source",
  accels: ["<Super>space", "XF86Keyboard"],
};

test("the shipped default is reported as conflicting with the window menu", () => {
  const conflicts = findAccelConflicts(
    "<Alt>space",
    [WINDOW_MENU, SWITCH_INPUT],
    caseInsensitiveMatch,
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "activate-window-menu");
});

test("conflicts match regardless of how the accelerator was spelled", () => {
  const conflicts = findAccelConflicts(
    "<alt>Space",
    [WINDOW_MENU],
    caseInsensitiveMatch,
  );

  assert.equal(conflicts.length, 1);
});

test("only the matching accelerators of a multi-binding key are reported", () => {
  const conflicts = findAccelConflicts(
    "<Super>space",
    [SWITCH_INPUT],
    caseInsensitiveMatch,
  );

  assert.deepEqual(conflicts[0].accels, ["<Super>space"]);
});

test("a free combination and a disabled shortcut report no conflicts", () => {
  assert.deepEqual(
    findAccelConflicts("<Ctrl><Alt>k", [WINDOW_MENU], caseInsensitiveMatch),
    [],
  );
  assert.deepEqual(
    findAccelConflicts("", [WINDOW_MENU], caseInsensitiveMatch),
    [],
  );
});

test("conflict summaries name the first conflict and count the rest", () => {
  assert.equal(
    formatConflictSummary([WINDOW_MENU]),
    "Also used by Activate the window menu (Windows)",
  );
  assert.equal(
    formatConflictSummary([WINDOW_MENU, SWITCH_INPUT]),
    "Also used by Activate the window menu (Windows) and 1 other shortcut",
  );
  assert.equal(
    formatConflictSummary([WINDOW_MENU, SWITCH_INPUT, WINDOW_MENU]),
    "Also used by Activate the window menu (Windows) and 2 other shortcuts",
  );
  assert.equal(formatConflictSummary([]), "");
});

test("unmodified keys are rejected but function keys are allowed", () => {
  assert.equal(
    describeAccelRejection({
      valid: true,
      hasModifier: true,
      functionKey: false,
    }),
    null,
  );
  assert.equal(
    describeAccelRejection({
      valid: true,
      hasModifier: false,
      functionKey: true,
    }),
    null,
  );
  assert.match(
    describeAccelRejection({
      valid: true,
      hasModifier: false,
      functionKey: false,
    }),
    /Add a modifier/,
  );
  assert.match(
    describeAccelRejection({
      valid: false,
      hasModifier: true,
      functionKey: false,
    }),
    /cannot be used/,
  );
});

test("replaced bindings survive an encode and decode round trip", () => {
  const records = [
    { schemaId: "org.gnome.desktop.wm.keybindings", key: "a", value: ["x"] },
  ];

  assert.deepEqual(
    decodeReplacedBindings(encodeReplacedBindings(records)),
    records,
  );
  assert.equal(encodeReplacedBindings([]), "");
});

test("decoding tolerates empty, malformed, and unexpected payloads", () => {
  assert.deepEqual(decodeReplacedBindings(""), []);
  assert.deepEqual(decodeReplacedBindings("not json"), []);
  assert.deepEqual(decodeReplacedBindings('{"key":"value"}'), []);
  assert.deepEqual(decodeReplacedBindings('[null,{"schemaId":"a"}]'), []);
});

test("replacing the same shortcut twice keeps the original value", () => {
  const first = mergeReplacedBindings(
    [],
    [
      {
        schemaId: "org.gnome.desktop.wm.keybindings",
        key: "activate-window-menu",
        value: ["<Alt>space"],
      },
    ],
  );
  const second = mergeReplacedBindings(first, [
    {
      schemaId: "org.gnome.desktop.wm.keybindings",
      key: "activate-window-menu",
      value: [],
    },
  ]);

  assert.equal(second.length, 1);
  assert.deepEqual(second[0].value, ["<Alt>space"]);
});

test("records for different keys and relocatable paths are kept apart", () => {
  const merged = mergeReplacedBindings(
    [{ schemaId: "s", key: "binding", path: "/custom0/", value: "<Alt>space" }],
    [
      { schemaId: "s", key: "binding", path: "/custom1/", value: "<Alt>space" },
      { schemaId: "s", key: "other", value: ["<Alt>space"] },
    ],
  );

  assert.equal(merged.length, 3);
});
