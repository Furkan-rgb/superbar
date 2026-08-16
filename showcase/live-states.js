// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

/* Fixture states for the live renderer (scripts/render-live.mjs).
 *
 * Each row is a real Superbar result object, so the field names here have to
 * match what the search code actually produces: `label` rather than `title`,
 * `answerContext` on calculator answers, `city`/`temp`/`details` on weather.
 * Rows carrying `appId` get a themed icon resolved from AppSystem at render
 * time, which is what makes app rows show their real icon instead of a
 * symbolic placeholder.
 *
 * `settings` values are written to the extension's GSettings before the state
 * is applied, so the bar picks them up the same way it would for a user.
 */

const WEB_ROW = (text) => ({
  type: "web",
  label: text,
  subtitle: "Search with Google",
  icon: "web-browser-symbolic",
  query: text,
});

export default {
  "dark-empty": {
    label: "Empty search",
    settings: { "theme-mode": "dark" },
    query: "",
    mode: "generic",
    rows: [],
  },

  "light-search": {
    label: "Search results",
    settings: { "theme-mode": "light" },
    query: "terminal",
    mode: "generic",
    selected: 0,
    rows: [
      {
        type: "app",
        label: "Terminal",
        appId: "org.gnome.Terminal.desktop",
      },
      {
        type: "window",
        label: "Terminal — superbar",
        subtitle: "Workspace 1",
        appId: "org.gnome.Terminal.desktop",
        icon: "go-jump-symbolic",
      },
      WEB_ROW("terminal"),
    ],
  },

  "dark-search": {
    label: "Search results",
    settings: { "theme-mode": "dark" },
    query: "files",
    mode: "generic",
    selected: 0,
    rows: [
      {
        type: "app",
        label: "Files",
        subtitle: "Switch to active window",
        appId: "org.gnome.Nautilus.desktop",
      },
      {
        type: "file",
        label: "Downloads",
        subtitle: "Folder",
        icon: "folder-download-symbolic",
      },
      WEB_ROW("files"),
    ],
  },

  "dark-bottom-search": {
    label: "Bottom-positioned results",
    settings: { "theme-mode": "dark", "bar-position": "bottom" },
    query: "files",
    mode: "generic",
    selected: 0,
    rows: [
      {
        type: "app",
        label: "Files",
        subtitle: "Switch to active window",
        appId: "org.gnome.Nautilus.desktop",
      },
      {
        type: "file",
        label: "Downloads",
        subtitle: "Folder",
        icon: "folder-download-symbolic",
      },
      WEB_ROW("files"),
    ],
  },

  "light-clipboard": {
    label: "Clipboard history",
    settings: { "theme-mode": "light" },
    query: "clip",
    mode: "clipboard",
    selected: 0,
    rows: [
      {
        type: "clipboard",
        label: "https://extensions.gnome.org",
        subtitle: "Clipboard history",
        icon: "edit-paste-symbolic",
        value: "https://extensions.gnome.org",
      },
      {
        type: "clipboard",
        label: "Superbar makes search feel immediate.",
        subtitle: "Clipboard history",
        icon: "edit-paste-symbolic",
        value: "Superbar makes search feel immediate.",
      },
      {
        type: "clipboard",
        label: "make test",
        subtitle: "Clipboard history",
        icon: "edit-paste-symbolic",
        value: "make test",
      },
    ],
  },

  "dark-clipboard-copied": {
    label: "Clipboard copied state",
    settings: { "theme-mode": "dark" },
    query: "clipboard",
    mode: "clipboard",
    selected: 0,
    copiedValue: "https://extensions.gnome.org",
    rows: [
      {
        type: "clipboard",
        label: "https://extensions.gnome.org",
        subtitle: "Clipboard history",
        icon: "edit-paste-symbolic",
        value: "https://extensions.gnome.org",
      },
      {
        type: "clipboard",
        label: "Superbar makes search feel immediate.",
        subtitle: "Clipboard history",
        icon: "edit-paste-symbolic",
        value: "Superbar makes search feel immediate.",
      },
      {
        type: "clipboard",
        label: "make test",
        subtitle: "Clipboard history",
        icon: "edit-paste-symbolic",
        value: "make test",
      },
    ],
  },

  "light-calculator": {
    label: "Calculator answer",
    settings: { "theme-mode": "light" },
    query: "128 * 4.5",
    mode: "calculator",
    selected: 0,
    rows: [
      {
        type: "calc",
        label: "= 576",
        subtitle: "Press Enter to copy",
        icon: "accessories-calculator-symbolic",
        value: "576",
        answerContext: "128 * 4.5",
      },
    ],
  },

  "dark-weather": {
    label: "Weather result",
    settings: { "theme-mode": "dark" },
    query: "weather Amsterdam",
    mode: "weather",
    selected: 0,
    rows: [
      {
        type: "weather",
        icon: "weather-few-clouds-symbolic",
        city: "Amsterdam",
        description: "Partly cloudy",
        temp: "21°C",
        details:
          "Feels like 20°C  ·  Wind 14 km/h  ·  Humidity 68%  ·  ↑23°  ↓14°",
      },
    ],
  },
};
