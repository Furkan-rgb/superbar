// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppSearchText,
  isSettingsPanelApp,
} from "../app-search.js";

test("GNOME Settings panels are recognized by their desktop category", () => {
  const panel = {
    get_categories: () =>
      "GNOME;GTK;Settings;X-GNOME-Settings-Panel;HardwareSettings;",
  };
  const regularApp = {
    get_categories: () => "GNOME;GTK;Utility;",
  };

  assert.equal(isSettingsPanelApp(panel), true);
  assert.equal(isSettingsPanelApp(regularApp), false);
  assert.equal(isSettingsPanelApp(null), false);
});

test("settings panels include broad settings terms in searchable metadata", () => {
  const searchText = buildAppSearchText({
    label: "Displays",
    name: "Displays",
    description: "Choose how to use connected monitors",
    keywords: ["Screen", "Resolution", "Monitor"],
    appId: "gnome-display-panel.desktop",
    settingsPanel: true,
  });

  assert.match(searchText, /^Settings Preferences Displays/);
  assert.match(searchText, /Resolution/);
});

test("regular apps do not receive settings-only search terms", () => {
  const searchText = buildAppSearchText({
    label: "Files",
    appId: "org.gnome.Nautilus.desktop",
  });

  assert.equal(searchText, "Files org.gnome.Nautilus.desktop");
});
