// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

const SETTINGS_PANEL_CATEGORY = "X-GNOME-Settings-Panel";

export function isSettingsPanelApp(appInfo) {
  const categories = appInfo?.get_categories?.() ?? "";
  return categories
    .split(";")
    .some((category) => category === SETTINGS_PANEL_CATEGORY);
}

export function buildAppSearchText({
  label,
  name,
  genericName,
  description,
  keywords = [],
  appId,
  settingsPanel = false,
}) {
  return [
    ...(settingsPanel ? ["Settings", "Preferences"] : []),
    label,
    name,
    genericName,
    description,
    ...keywords,
    appId,
  ]
    .filter(Boolean)
    .join(" ");
}
