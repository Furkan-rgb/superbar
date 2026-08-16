#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

/* Drives the real extension with real input events.
 *
 * These checks exist because the bugs they cover are invisible to reading and
 * to the unit tests: dismissal listened for button-press-event for months,
 * which looks like it handles clicks and silently ignored every touch tap.
 * Nothing short of pressing the keys and tapping the screen finds that, so a
 * headless Shell gets Superbar installed and a virtual keyboard, pointer and
 * touchscreen are pointed at it.
 *
 * Run with `make smoke`. It needs GNOME Shell on the machine and takes about a
 * minute, which is why it is not part of `make test`.
 */

import { HeadlessSession, sleep } from "./headless-session.mjs";

const SUPERBAR_UUID = "superbar@Furkan-rgb.github.io";
const STAGE_WIDTH = 1600;
const STAGE_HEIGHT = 1000;
// Far enough from a centred bar to be outside it on any of these checks.
const OUTSIDE_X = 60;
const OUTSIDE_Y = 940;
// A press has to reach the Shell, be recognised, and close the bar; the easing
// is off, so this is transport rather than animation.
const SETTLE_MS = 600;

const SETUP = `
(() => {
  const Clutter = imports.gi.Clutter;
  const seat = Clutter.get_default_backend().get_default_seat();
  globalThis.__smoke = {
    superbar: Main.extensionManager.lookup('${SUPERBAR_UUID}').stateObj,
    keyboard: seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE),
    pointer: seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE),
    touch: seat.create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE),
  };
  return 'ready';
})()`;

/* Opens the bar and jumps it to the end of its easing, so a check never races
 * the open animation. */
const openBar = (prefix = "", text = "") => `
(() => {
  const superbar = globalThis.__smoke.superbar;
  superbar._closeSearch({ preserveSession: false });
  superbar._openSearch();
  const container = superbar._container;
  container.remove_all_transitions();
  container.opacity = 255;
  container.scale_x = 1;
  container.scale_y = 1;
  container.translation_y = 0;
  superbar._setQueryModePrefix(${JSON.stringify(prefix)});
  superbar._entry.set_text(${JSON.stringify(text)});
  return 'open';
})()`;

const state = `
(() => {
  const superbar = globalThis.__smoke.superbar;
  return {
    open: superbar._searchOpen,
    query: superbar._queryText(),
    chip: superbar._modeChipLabel.text,
    mode: superbar._modeLabel.text,
  };
})()`;

const pressButton = (button) => `
(() => {
  const Clutter = imports.gi.Clutter;
  const GLib = imports.gi.GLib;
  const pointer = globalThis.__smoke.pointer;
  pointer.notify_absolute_motion(GLib.get_monotonic_time(), ${OUTSIDE_X}, ${OUTSIDE_Y});
  pointer.notify_button(GLib.get_monotonic_time(), Clutter.${button}, Clutter.ButtonState.PRESSED);
  pointer.notify_button(GLib.get_monotonic_time(), Clutter.${button}, Clutter.ButtonState.RELEASED);
  return 'pressed';
})()`;

const clickInsideBar = `
(() => {
  const Clutter = imports.gi.Clutter;
  const GLib = imports.gi.GLib;
  const pointer = globalThis.__smoke.pointer;
  const container = globalThis.__smoke.superbar._container;
  const [x, y] = container.get_transformed_position();
  const [width, height] = container.get_transformed_size();
  pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
  pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
  pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
  return 'pressed';
})()`;

const tapTouch = `
(() => {
  const GLib = imports.gi.GLib;
  const touch = globalThis.__smoke.touch;
  touch.notify_touch_down(GLib.get_monotonic_time(), 0, ${OUTSIDE_X}, ${OUTSIDE_Y});
  touch.notify_touch_up(GLib.get_monotonic_time(), 0);
  return 'tapped';
})()`;

const pressKey = (keyName) => `
(() => {
  const Clutter = imports.gi.Clutter;
  const GLib = imports.gi.GLib;
  const keyboard = globalThis.__smoke.keyboard;
  const keyval = Clutter['KEY_${keyName}'];
  keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
  keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
  return 'pressed';
})()`;

/* Each check opens the bar itself rather than inheriting whatever the previous
 * one left behind, so a failure cannot cascade into the checks after it. */
const CHECKS = [
  {
    name: "a click outside closes the bar",
    open: openBar(),
    input: pressButton("BUTTON_PRIMARY"),
    expect: { open: false },
  },
  {
    // The bug this whole script exists for: touch raises no button event.
    name: "a touch tap outside closes the bar",
    open: openBar(),
    input: tapTouch,
    expect: { open: false },
  },
  {
    name: "a secondary click outside closes the bar",
    open: openBar(),
    input: pressButton("BUTTON_SECONDARY"),
    expect: { open: false },
  },
  {
    name: "a click inside the bar leaves it open",
    open: openBar(),
    input: clickInsideBar,
    expect: { open: true },
  },
  {
    name: "Tab moves to the next mode",
    open: openBar(),
    input: pressKey("Tab"),
    expect: { open: true, chip: "clip", mode: "Clipboard" },
  },
  {
    name: "Tab keeps what was already typed",
    open: openBar("", "invoice"),
    input: pressKey("Tab"),
    expect: { open: true, chip: "clip", query: "clip invoice" },
  },
  {
    name: "Shift+Tab moves to the previous mode",
    open: openBar(),
    input: pressKey("ISO_Left_Tab"),
    expect: { open: true, chip: "define", mode: "Dictionary" },
  },
  {
    name: "Backspace at the start clears the mode chip",
    open: openBar("clip "),
    input: pressKey("BackSpace"),
    expect: { open: true, chip: "", mode: "All results" },
  },
  {
    name: "Escape closes a bar with nothing typed",
    open: openBar(),
    input: pressKey("Escape"),
    expect: { open: false },
  },
];

function compare(actual, expected) {
  const failures = Object.entries(expected).flatMap(([key, want]) =>
    actual[key] === want
      ? []
      : [`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual[key])}`],
  );
  return failures;
}

const session = new HeadlessSession({
  "bar-width": "900",
  keep: false,
  unsafe: true,
  waylandDisplay: "superbar-smoke",
});

let failed = 0;

try {
  process.stdout.write("Starting a headless GNOME Shell…\n");
  await session.start(STAGE_WIDTH, STAGE_HEIGHT);
  session.evalInShell(SETUP);

  for (const check of CHECKS) {
    session.evalInShell(check.open);
    await sleep(200);
    session.evalInShell(check.input);
    await sleep(SETTLE_MS);

    const actual = session.evalJson(state);
    const failures = compare(actual, check.expect);

    if (failures.length === 0) {
      process.stdout.write(`  ok    ${check.name}\n`);
    } else {
      failed += 1;
      process.stdout.write(`  FAIL  ${check.name}\n`);
      failures.forEach((failure) => process.stdout.write(`          ${failure}\n`));
    }
  }

  process.stdout.write(
    `\n${CHECKS.length - failed}/${CHECKS.length} input checks passed.\n`,
  );
} catch (error) {
  process.stderr.write(`Input smoke test failed to run: ${error.message}\n`);
  const log = session.shellLog?.join("") ?? "";
  if (log) process.stderr.write(`${log.split("\n").slice(-15).join("\n")}\n`);
  failed = failed || 1;
} finally {
  session.stop();
}

process.exitCode = failed > 0 ? 1 : 0;
