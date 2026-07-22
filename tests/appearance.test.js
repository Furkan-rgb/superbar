// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  getGnomeAppPalette,
  getSurfaceAppearance,
  getSurfaceColor,
  resolveColorSource,
  resolveThemeVariant,
} from "../appearance.js";

test("System mode follows the system color preference", () => {
  assert.equal(resolveThemeVariant("system", false), "light");
  assert.equal(resolveThemeVariant("system", true), "dark");
});

test("fixed modes override the system color preference", () => {
  assert.equal(resolveThemeVariant("light", true), "light");
  assert.equal(resolveThemeVariant("dark", false), "dark");
});

test("an unknown mode safely behaves like System mode", () => {
  assert.equal(resolveThemeVariant("unknown", false), "light");
  assert.equal(resolveThemeVariant("unknown", true), "dark");
});

test("only the GNOME apps color source opts into theme colors", () => {
  assert.equal(resolveColorSource("gnome-apps"), "gnome-apps");
  assert.equal(resolveColorSource("superbar"), "superbar");
  assert.equal(resolveColorSource("unknown"), "superbar");
});

test("GNOME app palettes combine semantic surfaces with the system accent", () => {
  assert.deepEqual(getGnomeAppPalette("light", "green"), {
    background: [250, 250, 251],
    foreground: [0, 0, 6],
    accent: [58, 148, 74],
    accentForeground: [21, 119, 46],
  });
  assert.deepEqual(getGnomeAppPalette("dark", "green"), {
    background: [34, 34, 38],
    foreground: [255, 255, 255],
    accent: [58, 148, 74],
    accentForeground: [141, 230, 152],
  });
});

test("unknown GNOME accents safely fall back to blue", () => {
  assert.deepEqual(
    getGnomeAppPalette("light", "unknown"),
    getGnomeAppPalette("light", "blue"),
  );
});

test("the current neutral colors remain the defaults", () => {
  assert.deepEqual(getSurfaceColor("light", "neutral"), [245, 245, 244]);
  assert.deepEqual(getSurfaceColor("dark", "neutral"), [23, 23, 23]);
});

test("an unknown preset falls back to the neutral color", () => {
  assert.deepEqual(getSurfaceColor("light", "unknown"), [245, 245, 244]);
  assert.deepEqual(getSurfaceColor("dark", "unknown"), [23, 23, 23]);
});

test("the active variant selects its corresponding preset", () => {
  const light = getSurfaceAppearance({
    configuredMode: "system",
    systemPrefersDark: false,
    lightPresetKey: "linen",
    darkPresetKey: "graphite",
    opacityPercentage: 90,
  });
  const dark = getSurfaceAppearance({
    configuredMode: "system",
    systemPrefersDark: true,
    lightPresetKey: "linen",
    darkPresetKey: "graphite",
    opacityPercentage: 90,
  });

  assert.deepEqual(light, {
    variant: "light",
    color: [247, 243, 236],
    opacity: 0.9,
  });
  assert.deepEqual(dark, {
    variant: "dark",
    color: [36, 36, 38],
    opacity: 0.9,
  });
});

test("background opacity is limited to the supported range", () => {
  const appearanceAt = (opacityPercentage) =>
    getSurfaceAppearance({
      configuredMode: "light",
      systemPrefersDark: false,
      lightPresetKey: "neutral",
      darkPresetKey: "neutral",
      opacityPercentage,
    }).opacity;

  assert.equal(appearanceAt(20), 0.65);
  assert.equal(appearanceAt(90), 0.9);
  assert.equal(appearanceAt(140), 1);
});
