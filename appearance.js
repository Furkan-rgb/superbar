// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

export const SURFACE_COLOR_PRESETS = Object.freeze({
  light: Object.freeze([
    Object.freeze({
      key: "neutral",
      label: "Neutral (Default)",
      color: Object.freeze([245, 245, 244]),
    }),
    Object.freeze({
      key: "porcelain",
      label: "Porcelain",
      color: Object.freeze([248, 247, 244]),
    }),
    Object.freeze({
      key: "linen",
      label: "Linen",
      color: Object.freeze([247, 243, 236]),
    }),
    Object.freeze({
      key: "silver",
      label: "Silver",
      color: Object.freeze([238, 239, 239]),
    }),
    Object.freeze({
      key: "mist",
      label: "Mist",
      color: Object.freeze([241, 244, 243]),
    }),
  ]),
  dark: Object.freeze([
    Object.freeze({
      key: "neutral",
      label: "Neutral (Default)",
      color: Object.freeze([23, 23, 23]),
    }),
    Object.freeze({
      key: "soft-black",
      label: "Soft Black",
      color: Object.freeze([28, 28, 30]),
    }),
    Object.freeze({
      key: "graphite",
      label: "Graphite",
      color: Object.freeze([36, 36, 38]),
    }),
    Object.freeze({
      key: "warm-charcoal",
      label: "Warm Charcoal",
      color: Object.freeze([33, 30, 27]),
    }),
    Object.freeze({
      key: "midnight",
      label: "Midnight",
      color: Object.freeze([24, 26, 29]),
    }),
    Object.freeze({
      key: "oled-black",
      label: "OLED Black",
      color: Object.freeze([13, 13, 13]),
    }),
  ]),
});

export function getSurfaceColor(variant, presetKey) {
  const presets = SURFACE_COLOR_PRESETS[variant];
  return presets.find(({ key }) => key === presetKey)?.color ?? presets[0].color;
}

export function resolveThemeVariant(configuredMode, systemPrefersDark) {
  if (configuredMode === "light" || configuredMode === "dark") {
    return configuredMode;
  }

  return systemPrefersDark ? "dark" : "light";
}

export function getSurfaceAppearance({
  configuredMode,
  systemPrefersDark,
  lightPresetKey,
  darkPresetKey,
  opacityPercentage,
}) {
  const variant = resolveThemeVariant(configuredMode, systemPrefersDark);
  const presetKey = variant === "dark" ? darkPresetKey : lightPresetKey;

  return {
    variant,
    color: getSurfaceColor(variant, presetKey),
    opacity: Math.min(1, Math.max(0.65, opacityPercentage / 100)),
  };
}
