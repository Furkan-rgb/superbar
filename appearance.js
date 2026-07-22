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

// Libadwaita's semantic window colors. Superbar runs in GNOME Shell's St
// process, where Gtk and Adw must not be imported, so these values mirror the
// public Libadwaita palette and are combined with the live GNOME accent
// preference below.
export const GNOME_APP_SURFACE_COLORS = Object.freeze({
  light: Object.freeze({
    background: Object.freeze([250, 250, 251]),
    foreground: Object.freeze([0, 0, 6]),
  }),
  dark: Object.freeze({
    background: Object.freeze([34, 34, 38]),
    foreground: Object.freeze([255, 255, 255]),
  }),
});

export const GNOME_ACCENT_COLORS = Object.freeze({
  blue: Object.freeze({
    background: Object.freeze([53, 132, 228]),
    lightForeground: Object.freeze([4, 97, 190]),
    darkForeground: Object.freeze([129, 208, 255]),
  }),
  teal: Object.freeze({
    background: Object.freeze([33, 144, 164]),
    lightForeground: Object.freeze([0, 113, 132]),
    darkForeground: Object.freeze([123, 223, 244]),
  }),
  green: Object.freeze({
    background: Object.freeze([58, 148, 74]),
    lightForeground: Object.freeze([21, 119, 46]),
    darkForeground: Object.freeze([141, 230, 152]),
  }),
  yellow: Object.freeze({
    background: Object.freeze([200, 136, 0]),
    lightForeground: Object.freeze([144, 83, 0]),
    darkForeground: Object.freeze([255, 192, 87]),
  }),
  orange: Object.freeze({
    background: Object.freeze([237, 91, 0]),
    lightForeground: Object.freeze([182, 34, 0]),
    darkForeground: Object.freeze([255, 156, 91]),
  }),
  red: Object.freeze({
    background: Object.freeze([230, 45, 66]),
    lightForeground: Object.freeze([192, 0, 35]),
    darkForeground: Object.freeze([255, 136, 140]),
  }),
  pink: Object.freeze({
    background: Object.freeze([213, 97, 153]),
    lightForeground: Object.freeze([162, 50, 108]),
    darkForeground: Object.freeze([255, 160, 216]),
  }),
  purple: Object.freeze({
    background: Object.freeze([145, 65, 172]),
    lightForeground: Object.freeze([137, 57, 164]),
    darkForeground: Object.freeze([251, 167, 255]),
  }),
  slate: Object.freeze({
    background: Object.freeze([111, 131, 150]),
    lightForeground: Object.freeze([82, 102, 120]),
    darkForeground: Object.freeze([187, 209, 229]),
  }),
  // GNOME 50 adds brown to the desktop accent preference. These are the
  // middle and contrast-adjusted colors from the GNOME brown palette.
  brown: Object.freeze({
    background: Object.freeze([152, 106, 68]),
    lightForeground: Object.freeze([99, 69, 44]),
    darkForeground: Object.freeze([205, 171, 143]),
  }),
});

export function getSurfaceColor(variant, presetKey) {
  const presets = SURFACE_COLOR_PRESETS[variant];
  return presets.find(({ key }) => key === presetKey)?.color ?? presets[0].color;
}

export function resolveColorSource(configuredSource) {
  return configuredSource === "gnome-apps" ? "gnome-apps" : "superbar";
}

export function getGnomeAppPalette(variant, accentName) {
  const resolvedVariant = variant === "dark" ? "dark" : "light";
  const surface = GNOME_APP_SURFACE_COLORS[resolvedVariant];
  const accent = GNOME_ACCENT_COLORS[accentName] ?? GNOME_ACCENT_COLORS.blue;

  return {
    background: surface.background,
    foreground: surface.foreground,
    accent: accent.background,
    accentForeground:
      resolvedVariant === "dark"
        ? accent.darkForeground
        : accent.lightForeground,
  };
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
