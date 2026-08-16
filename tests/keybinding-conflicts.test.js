// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeReplacedBindings,
  describeAccel,
  describeAccelRejection,
  encodeReplacedBindings,
  findAccelConflicts,
  formatConflictSummary,
  isSameAccel,
  mergeReplacedBindings,
  parseAccel,
} from "../keybinding-conflicts.js";

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

const CTRL_ALT_K = {
  schemaId: "org.gnome.shell.keybindings",
  label: "GNOME Shell",
  key: "toggle-something",
  summary: "Toggle something",
  accels: ["<Control><Alt>k"],
};

test("the shipped default is reported as conflicting with the window menu", () => {
  const conflicts = findAccelConflicts(
    "<Alt>space",
    [WINDOW_MENU, SWITCH_INPUT],
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "activate-window-menu");
});

test("conflicts match regardless of how the modifiers were spelled", () => {
  for (const accel of ["<alt>space", "<ALT>space"]) {
    assert.equal(
      findAccelConflicts(accel, [WINDOW_MENU]).length,
      1,
      accel,
    );
  }

  assert.equal(
    findAccelConflicts("<primary><ALT>k", [CTRL_ALT_K]).length,
    1,
  );
});

test("modifiers that only look interchangeable are kept apart", () => {
  for (const accel of ["<Meta>space", "<Super>space", "<Hyper>space"]) {
    assert.deepEqual(
      findAccelConflicts(accel, [WINDOW_MENU]),
      [],
      accel,
    );
  }
});

// GDK keysym names are case-sensitive, so "<Alt>Space" is not an accelerator at
// all. Nothing writes that spelling — accelerators reaching the settings come
// from Gtk.accelerator_name_with_keycode — but a conflict scan must not claim a
// match it cannot back up.
test("a key name in the wrong case is not treated as a match", () => {
  assert.deepEqual(
    findAccelConflicts("<Alt>Space", [WINDOW_MENU]),
    [],
  );
});

// Media keys are stored as bare key names rather than accelerators, so they
// cannot be parsed and compare only against themselves.
test("unparseable system bindings match only themselves", () => {
  assert.equal(
    findAccelConflicts("XF86Keyboard", [SWITCH_INPUT]).length,
    1,
  );
  assert.deepEqual(
    findAccelConflicts("<Alt>k", [SWITCH_INPUT]),
    [],
  );
});

test("only the matching accelerators of a multi-binding key are reported", () => {
  const conflicts = findAccelConflicts(
    "<Super>space",
    [SWITCH_INPUT],
  );

  assert.deepEqual(conflicts[0].accels, ["<Super>space"]);
});

test("a free combination and a disabled shortcut report no conflicts", () => {
  assert.deepEqual(
    findAccelConflicts("<Ctrl><Alt>k", [WINDOW_MENU]),
    [],
  );
  assert.deepEqual(
    findAccelConflicts("", [WINDOW_MENU]),
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

test("modifier spellings and aliases resolve to one combination", () => {
  assert.deepEqual(parseAccel("<Alt>space"), {
    modifiers: ["alt"],
    key: "space",
  });
  assert.deepEqual(parseAccel("<primary><ALT>k"), {
    modifiers: ["alt", "control"],
    key: "k",
  });
  // Order of modifiers is not part of the combination.
  assert.deepEqual(parseAccel("<Alt><Control>k"), parseAccel("<Control><Alt>k"));
  // Nor is a modifier repeated.
  assert.deepEqual(parseAccel("<Alt><alt>k"), parseAccel("<Alt>k"));
  assert.equal(parseAccel(""), null);
  assert.equal(parseAccel("<Alt>"), null);
});

// GNOME ships show-screen-recording-ui as "<Ctrl><Shift><Alt>R", but a
// shortcut captured in preferences is written back as "<Shift><Control><Alt>r".
// Treating those as different combinations hides a real conflict.
test("a letter key matches whichever case it was written in", () => {
  const RECORDER = {
    schemaId: "org.gnome.shell.keybindings",
    label: "GNOME Shell",
    key: "show-screen-recording-ui",
    summary: "Show the screen recording UI",
    accels: ["<Ctrl><Shift><Alt>R"],
  };

  assert.equal(
    findAccelConflicts("<Shift><Control><Alt>r", [RECORDER]).length,
    1,
  );
  assert.ok(isSameAccel("<Alt>k", "<Alt>K"));
  // Named keysyms are still not folded: "Space" is not a key name at all.
  assert.ok(!isSameAccel("<Alt>space", "<Alt>Space"));
});

test("the shared matcher agrees with itself in both directions", () => {
  assert.ok(isSameAccel("<Alt>space", "<alt>space"));
  assert.ok(isSameAccel("<Primary>k", "<Control>k"));
  assert.ok(isSameAccel("XF86AudioPlay", "XF86AudioPlay"));
  assert.ok(!isSameAccel("<Alt>space", "<Meta>space"));
  assert.ok(!isSameAccel("<Alt>space", "<Alt>Space"));
  assert.ok(!isSameAccel("<Alt>k", "XF86AudioPlay"));
});

test("accelerators are described the way they are printed on keycaps", () => {
  assert.equal(describeAccel("<Alt>space"), "Alt+Space");
  assert.equal(describeAccel("<Super>k"), "Super+K");
  // Reading order, not the alphabetical order used for comparison.
  assert.equal(describeAccel("<Shift><Alt><Control>Tab"), "Ctrl+Alt+Shift+Tab");
  assert.equal(describeAccel("<Primary>F7"), "Ctrl+F7");
  assert.equal(describeAccel("XF86AudioPlay"), "XF86AudioPlay");
  assert.equal(describeAccel(""), "");
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
