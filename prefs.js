// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { SURFACE_COLOR_PRESETS } from "./appearance.js";
import { SEARCH_ENGINES } from "./search-engines.js";
import {
  describeAccel,
  describeAccelRejection,
  formatConflict,
  formatConflictSummary,
} from "./keybinding-conflicts.js";
import {
  findConflictsFor,
  readReplacedBindings,
  replaceConflicts,
  restoreReplacedBindings,
} from "./keybinding-settings.js";

function addRoundedRectangle(cr, x, y, width, height, radius) {
  cr.newSubPath();
  cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
  cr.arc(
    x + width - radius,
    y + height - radius,
    radius,
    0,
    Math.PI / 2,
  );
  cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
  cr.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
  cr.closePath();
}

function createColorPresetFactory(options) {
  const optionsByLabel = new Map(
    options.map((option) => [option.label, option]),
  );
  const factory = new Gtk.SignalListItemFactory();

  factory.connect("setup", (_factory, listItem) => {
    const swatch = new Gtk.DrawingArea({
      content_width: 22,
      content_height: 22,
      valign: Gtk.Align.CENTER,
      margin_end: 10,
    });
    swatch._surfaceColor = options[0].color;
    swatch.set_draw_func((area, cr, width, height) => {
      const [red, green, blue] = area._surfaceColor;
      addRoundedRectangle(cr, 0.5, 0.5, width - 1, height - 1, 6);
      cr.setSourceRGBA(red / 255, green / 255, blue / 255, 1);
      cr.fillPreserve();
      cr.setSourceRGBA(0.5, 0.5, 0.5, 0.55);
      cr.setLineWidth(1);
      cr.stroke();
    });

    const label = new Gtk.Label({ xalign: 0 });
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      valign: Gtk.Align.CENTER,
    });
    content.append(swatch);
    content.append(label);
    content._swatch = swatch;
    content._label = label;
    listItem.set_child(content);
  });

  factory.connect("bind", (_factory, listItem) => {
    const content = listItem.get_child();
    const label = listItem.get_item().get_string();
    const option = optionsByLabel.get(label) ?? options[0];
    content._label.set_label(label);
    content._swatch._surfaceColor = option.color;
    content._swatch.queue_draw();
  });

  return factory;
}

function addComboSettingRow(
  group,
  settings,
  key,
  title,
  subtitle,
  options,
  showColorSwatches = false,
) {
  const optionKeys = options.map((option) => option.key);
  const row = new Adw.ComboRow({
    title,
    subtitle,
    model: Gtk.StringList.new(options.map((option) => option.label)),
  });
  if (showColorSwatches) {
    row.factory = createColorPresetFactory(options);
    row.list_factory = createColorPresetFactory(options);
  }
  const currentIndex = optionKeys.indexOf(settings.get_string(key));
  row.set_selected(currentIndex >= 0 ? currentIndex : 0);
  row.connect("notify::selected", () => {
    settings.set_string(key, optionKeys[row.selected] ?? optionKeys[0]);
  });
  group.add(row);
  return row;
}

function addSwitchSettingRow(group, settings, key, title, subtitle) {
  const row = new Adw.SwitchRow({ title, subtitle });
  settings.bind(
    key,
    row,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  group.add(row);
  return row;
}

// ── Shortcut editing ────────────────────────────────────────────────────────

const MODIFIER_KEYVALS = new Set(
  [
    Gdk.KEY_Shift_L,
    Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L,
    Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L,
    Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L,
    Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L,
    Gdk.KEY_Meta_R,
    Gdk.KEY_Hyper_L,
    Gdk.KEY_Hyper_R,
    Gdk.KEY_ISO_Level3_Shift,
    Gdk.KEY_ISO_Level5_Shift,
    Gdk.KEY_Caps_Lock,
    Gdk.KEY_Shift_Lock,
    Gdk.KEY_Num_Lock,
    Gdk.KEY_Scroll_Lock,
  ],
);

// ── Keybinding row ──────────────────────────────────────────────────────────

const KeybindingRow = GObject.registerClass(
  {
    GTypeName: "SuperbarKeybindingRow",
  },
  class KeybindingRow extends Adw.ActionRow {
    _init(settings, key, params = {}) {
      super._init(params);

      this._settings = settings;
      this._key = key;

      this.onReplacedChanged = null;

      this._conflictIcon = new Gtk.Image({
        icon_name: "dialog-warning-symbolic",
        valign: Gtk.Align.CENTER,
        visible: false,
      });

      this._shortcutLabel = new Gtk.ShortcutLabel({
        valign: Gtk.Align.CENTER,
        disabled_text: "Disabled",
      });
      this.syncState();

      const editBtn = new Gtk.Button({
        icon_name: "document-edit-symbolic",
        valign: Gtk.Align.CENTER,
        has_frame: false,
        tooltip_text: "Change shortcut",
      });
      editBtn.connect("clicked", () => this._startCapture());

      const clearBtn = new Gtk.Button({
        icon_name: "edit-clear-symbolic",
        valign: Gtk.Align.CENTER,
        has_frame: false,
        tooltip_text: "Disable shortcut",
      });
      clearBtn.connect("clicked", () => {
        this._settings.set_strv(this._key, []);
        this.syncState();
      });

      this.add_suffix(this._conflictIcon);
      this.add_suffix(this._shortcutLabel);
      this.add_suffix(editBtn);
      this.add_suffix(clearBtn);
    }

    syncState() {
      const shortcuts = this._settings.get_strv(this._key);
      const accel = shortcuts.length ? shortcuts[0] : "";
      this._shortcutLabel.accelerator = accel;

      const conflicts = findConflictsFor(accel);
      this._conflictIcon.visible = conflicts.length > 0;
      this._conflictIcon.tooltip_text = conflicts.length
        ? `${formatConflictSummary(conflicts)}. The shortcut may open ` +
          `something else, or nothing at all, depending on what has focus.`
        : "";
    }

    _startCapture() {
      const dialog = new Adw.Window({
        modal: true,
        transient_for: this.get_root(),
        default_width: 380,
        default_height: 200,
        title: "New Shortcut",
      });

      const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
        valign: Gtk.Align.CENTER,
      });

      const headerBar = new Adw.HeaderBar({ show_end_title_buttons: false });
      // Every keystroke here is a shortcut candidate, so nothing in the dialog
      // may take focus: a focused button turns Space and Enter into a click
      // instead of a capture.
      const cancelBtn = new Gtk.Button({ label: "Cancel", focusable: false });
      cancelBtn.connect("clicked", () => dialog.destroy());
      headerBar.pack_start(cancelBtn);

      const label = new Gtk.Label({
        label: "<b>Press a new key combination…</b>",
        use_markup: true,
      });
      const hint = new Gtk.Label({
        label: "Press Escape to cancel",
        css_classes: ["dim-label"],
      });

      box.append(label);
      box.append(hint);

      const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
      });
      content.append(headerBar);
      content.append(box);
      dialog.set_content(content);

      // The compositor owns combinations like Alt+Space, and would act on them
      // instead of delivering them here — which would make exactly the
      // shortcuts this dialog needs to detect impossible to press. Inhibiting
      // lasts only while the dialog is up.
      let inhibitedSurface = null;
      dialog.connect("map", () => {
        inhibitedSurface = dialog.get_surface();
        inhibitedSurface?.inhibit_system_shortcuts(null);
        this._inhibitedSurface = inhibitedSurface;
      });
      dialog.connect("unmap", () => {
        inhibitedSurface?.restore_system_shortcuts();
        inhibitedSurface = null;
        this._inhibitedSurface = null;
      });

      const controller = new Gtk.EventControllerKey();
      // Capture phase, so the dialog sees the key before any focused widget
      // gets a chance to consume it.
      controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
      controller.connect("key-pressed", (_ctrl, keyval, keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
          dialog.destroy();
          return Gdk.EVENT_STOP;
        }

        if (MODIFIER_KEYVALS.has(keyval)) return Gdk.EVENT_PROPAGATE;

        const mask =
          state &
          (Gdk.ModifierType.SHIFT_MASK |
            Gdk.ModifierType.CONTROL_MASK |
            Gdk.ModifierType.ALT_MASK |
            Gdk.ModifierType.SUPER_MASK);

        const accel = Gtk.accelerator_name_with_keycode(
          null,
          keyval,
          keycode,
          mask,
        );

        const rejection = describeAccelRejection({
          valid: Boolean(accel) && Gtk.accelerator_valid(keyval, mask),
          hasModifier: mask !== 0,
          functionKey: keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F35,
        });

        // Keep the dialog up so the rejected combination can be corrected
        // without reopening it.
        if (rejection) {
          hint.label = rejection;
          hint.add_css_class("error");
          return Gdk.EVENT_STOP;
        }

        dialog.destroy();
        this._applyAccel(accel);
        return Gdk.EVENT_STOP;
      });

      dialog.add_controller(controller);
      dialog.present();
    }

    _setAccel(accel) {
      this._settings.set_strv(this._key, [accel]);
      this.syncState();
    }

    // Conflicting shortcuts are only ever cleared through this prompt. Doing it
    // silently would rewrite the user's configuration behind their back, and it
    // would still miss the conflicts we cannot see: shortcuts owned by other
    // extensions, and applications that grab keys for themselves.
    _applyAccel(accel) {
      const conflicts = findConflictsFor(accel);
      if (conflicts.length === 0) {
        this._setAccel(accel);
        return;
      }

      const conflictList = conflicts
        .map((conflict) => `\u2022 ${formatConflict(conflict)}`)
        .join("\n");

      const alert = new Adw.AlertDialog({
        heading: "Shortcut Already in Use",
        body:
          `${describeAccel(accel)} is already assigned to:\n\n${conflictList}\n\n` +
          "Leaving both in place makes the shortcut unreliable \u2014 which one " +
          "responds can depend on what is focused. Replacing clears the " +
          "other assignments, and Superbar can restore them later.",
      });

      alert.add_response("cancel", "Cancel");
      alert.add_response("replace", "Replace");
      alert.set_response_appearance(
        "replace",
        Adw.ResponseAppearance.DESTRUCTIVE,
      );
      alert.set_default_response("cancel");
      alert.set_close_response("cancel");
      alert.connect("response", (_alert, response) => {
        if (response === "replace") this._replaceConflicts(accel, conflicts);
      });

      alert.present(this);
    }

    _replaceConflicts(accel, conflicts) {
      replaceConflicts(this._settings, conflicts);

      this._setAccel(accel);
      this.onReplacedChanged?.();
    }
  },
);

// ── Replaced shortcuts row ──────────────────────────────────────────────────

const ReplacedShortcutsRow = GObject.registerClass(
  {
    GTypeName: "SuperbarReplacedShortcutsRow",
  },
  class ReplacedShortcutsRow extends Adw.ActionRow {
    _init(settings, params = {}) {
      super._init({
        title: "Replaced System Shortcuts",
        ...params,
      });

      this._settings = settings;
      this.onRestored = null;

      const restoreBtn = new Gtk.Button({
        label: "Restore",
        valign: Gtk.Align.CENTER,
      });
      restoreBtn.connect("clicked", () => this._restore());
      this.add_suffix(restoreBtn);

      this.sync();
    }

    sync() {
      const records = readReplacedBindings(this._settings);

      this.visible = records.length > 0;
      if (records.length === 0) return;

      this.subtitle = `Cleared to free the Superbar shortcut: ${records
        .map((record) => formatConflict(record))
        .join(", ")}`;
    }

    _restore() {
      restoreReplacedBindings(this._settings);
      this.sync();
      this.onRestored?.();
    }
  },
);

// ── Preferences page ────────────────────────────────────────────────────────

export default class SuperbarPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    window.set_default_size(600, 500);
    const settings = this.getSettings();

    // ── Keyboard shortcut page ─────────────────────────────────────────────
    const shortcutPage = new Adw.PreferencesPage({
      title: "General",
      icon_name: "preferences-system-symbolic",
    });
    window.add(shortcutPage);

    const sourcesPage = new Adw.PreferencesPage({
      title: "Search Sources",
      icon_name: "system-search-symbolic",
    });
    window.add(sourcesPage);

    const shortcutGroup = new Adw.PreferencesGroup({
      title: "Keyboard Shortcut",
      description: "Shortcut to open and close Superbar",
    });
    shortcutPage.add(shortcutGroup);

    const row = new KeybindingRow(settings, "toggle-shortcut", {
      title: "Toggle Superbar",
      subtitle: "Click the edit button and press your desired key combination",
    });
    shortcutGroup.add(row);

    const replacedRow = new ReplacedShortcutsRow(settings);
    shortcutGroup.add(replacedRow);
    row.onReplacedChanged = () => replacedRow.sync();
    replacedRow.onRestored = () => row.syncState();

    // ── Search group ────────────────────────────────────────────────────────
    const searchGroup = new Adw.PreferencesGroup({
      title: "Search",
      description: "Control web searches and how matching results are ordered",
    });
    shortcutPage.add(searchGroup);

    const searchEngineRow = addComboSettingRow(
      searchGroup,
      settings,
      "default-search-engine",
      "Default Search Engine",
      "Used when opening web searches in your browser",
      SEARCH_ENGINES,
    );
    settings.bind(
      "web-search-enabled",
      searchEngineRow,
      "sensitive",
      Gio.SettingsBindFlags.GET,
    );

    const adaptiveRankingRow = new Adw.SwitchRow({
      title: "Adaptive Ranking",
      subtitle:
        "Prioritize frequently selected apps and actions; queries and file paths are never stored",
    });
    settings.bind(
      "adaptive-ranking-enabled",
      adaptiveRankingRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    searchGroup.add(adaptiveRankingRow);

    const resetRankingRow = new Adw.ActionRow({
      title: "Reset Learned Ranking",
      subtitle: "Forget previously selected apps and system actions",
    });
    const resetRankingBtn = new Gtk.Button({
      label: "Reset",
      valign: Gtk.Align.CENTER,
    });
    resetRankingBtn.connect("clicked", () =>
      settings.reset("ranking-history"),
    );
    resetRankingRow.add_suffix(resetRankingBtn);
    searchGroup.add(resetRankingRow);

    // ── Search sources page ────────────────────────────────────────────────
    const builtInSourcesGroup = new Adw.PreferencesGroup({
      title: "Superbar Results",
      description:
        "Choose which built-in sources and query types Superbar can use",
    });
    sourcesPage.add(builtInSourcesGroup);

    const builtInSources = [
      [
        "applications-search-enabled",
        "Applications",
        "Find installed applications by name, description, and keywords",
      ],
      [
        "windows-search-enabled",
        "Open Windows",
        "Find and switch to matching windows across workspaces",
      ],
      [
        "files-search-enabled",
        "Files and Folders",
        "Search common folders and the local file index",
      ],
      [
        "clipboard-search-enabled",
        "Clipboard History",
        "Show results for clip, clipboard, and history queries",
      ],
      [
        "calculator-search-enabled",
        "Calculator",
        "Evaluate mathematical expressions",
      ],
      [
        "weather-search-enabled",
        "Weather",
        "Look up explicit weather queries using Open-Meteo",
      ],
      [
        "dictionary-search-enabled",
        "Dictionary",
        "Look up definitions for define queries",
      ],
      [
        "currency-search-enabled",
        "Currency Conversion",
        "Convert currencies using amount CODE to CODE queries",
      ],
      [
        "web-search-enabled",
        "Web Search",
        "Include a browser search fallback in generic results",
      ],
      [
        "system-actions-search-enabled",
        "System Actions",
        "Show commands for >, cmd, command, and action queries",
      ],
    ];
    builtInSources.forEach(([key, title, subtitle]) =>
      addSwitchSettingRow(
        builtInSourcesGroup,
        settings,
        key,
        title,
        subtitle,
      ),
    );

    const providerGroup = new Adw.PreferencesGroup({
      title: "App-Provided Results",
      description:
        "Queries are sent to applications enabled in GNOME Search settings",
    });
    sourcesPage.add(providerGroup);

    addSwitchSettingRow(
      providerGroup,
      settings,
      "gnome-search-providers-enabled",
      "GNOME Search Providers",
      "Include results from Settings, Files, Calendar, Contacts, and other apps",
    );

    const manageProvidersRow = new Adw.ActionRow({
      title: "Manage GNOME Search Providers",
      subtitle: "Choose system-wide providers and their result order",
      activatable: true,
    });
    manageProvidersRow.add_suffix(
      new Gtk.Image({
        icon_name: "go-next-symbolic",
        valign: Gtk.Align.CENTER,
      }),
    );
    manageProvidersRow.connect("activated", () => {
      const controlCenter = GLib.find_program_in_path("gnome-control-center");
      if (!controlCenter) return;

      try {
        Gio.Subprocess.new(
          [controlCenter, "search"],
          Gio.SubprocessFlags.NONE,
        );
      } catch (_e) {
        // GNOME Settings may be unavailable on a nonstandard installation.
      }
    });
    providerGroup.add(manageProvidersRow);

    // ── Behavior group ─────────────────────────────────────────────────────
    const behaviorGroup = new Adw.PreferencesGroup({
      title: "Clipboard",
      description: "Control how clipboard history is collected and stored",
    });
    shortcutPage.add(behaviorGroup);

    const clipToggleRow = new Adw.SwitchRow({
      title: "Enable Clipboard Monitoring",
      subtitle: "Track clipboard changes to build a searchable history",
    });
    settings.bind(
      "clipboard-monitor-enabled",
      clipToggleRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    behaviorGroup.add(clipToggleRow);

    const clipLimitRow = new Adw.SpinRow({
      title: "History Limit",
      subtitle: "Maximum number of clipboard entries to remember",
      adjustment: new Gtk.Adjustment({
        lower: 10,
        upper: 200,
        step_increment: 5,
        page_increment: 20,
        value: settings.get_int("clipboard-history-limit"),
      }),
    });
    settings.bind(
      "clipboard-history-limit",
      clipLimitRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    behaviorGroup.add(clipLimitRow);

    const clearRow = new Adw.ActionRow({
      title: "Clear Clipboard History",
      subtitle: "Remove all saved clipboard entries from disk",
    });
    const clearBtn = new Gtk.Button({
      label: "Clear",
      valign: Gtk.Align.CENTER,
      css_classes: ["destructive-action"],
    });
    clearBtn.connect("clicked", () => {
      const historyPath = GLib.build_filenamev([
        GLib.get_user_data_dir(),
        "search-bar-clipboard-history.json",
      ]);
      try {
        Gio.File.new_for_path(historyPath).replace_contents(
          new TextEncoder().encode("[]"),
          null,
          false,
          Gio.FileCreateFlags.PRIVATE |
            Gio.FileCreateFlags.REPLACE_DESTINATION,
          null,
        );
        GLib.chmod(historyPath, 0o600);
      } catch (_e) {
        // Clearing history is best-effort.
      }

      const request = settings.get_uint("clipboard-history-clear-request");
      settings.set_uint(
        "clipboard-history-clear-request",
        (request + 1) >>> 0,
      );
    });
    clearRow.add_suffix(clearBtn);
    behaviorGroup.add(clearRow);

    // ── Appearance group ───────────────────────────────────────────────────
    const appearanceGroup = new Adw.PreferencesGroup({
      title: "Appearance",
      description: "Adjust the colors, size, and position of the bar",
    });
    shortcutPage.add(appearanceGroup);

    const maxResultsRow = new Adw.SpinRow({
      title: "Max Search Results",
      subtitle: "How many results to show in the list",
      adjustment: new Gtk.Adjustment({
        lower: 3,
        upper: 20,
        step_increment: 1,
        page_increment: 5,
        value: settings.get_int("max-results"),
      }),
    });
    settings.bind(
      "max-results",
      maxResultsRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    appearanceGroup.add(maxResultsRow);

    addComboSettingRow(
      appearanceGroup,
      settings,
      "theme-mode",
      "Color Theme",
      "Follow GNOME Shell or use a fixed light or dark style",
      [
        { key: "system", label: "System" },
        { key: "light", label: "Light" },
        { key: "dark", label: "Dark" },
      ],
    );

    const colorSourceRow = addComboSettingRow(
      appearanceGroup,
      settings,
      "color-source",
      "Color Source",
      "Use Superbar colors or match the palette used by GNOME apps",
      [
        { key: "superbar", label: "Superbar Palette" },
        { key: "gnome-apps", label: "Match GNOME Apps" },
      ],
    );

    const lightColorRow = addComboSettingRow(
      appearanceGroup,
      settings,
      "light-color-preset",
      "Light Background",
      "Background color used in light mode",
      SURFACE_COLOR_PRESETS.light,
      true,
    );

    const darkColorRow = addComboSettingRow(
      appearanceGroup,
      settings,
      "dark-color-preset",
      "Dark Background",
      "Background color used in dark mode",
      SURFACE_COLOR_PRESETS.dark,
      true,
    );

    const updateColorPresetSensitivity = () => {
      const usesSuperbarPalette = colorSourceRow.selected === 0;
      lightColorRow.sensitive = usesSuperbarPalette;
      darkColorRow.sensitive = usesSuperbarPalette;
    };
    colorSourceRow.connect(
      "notify::selected",
      updateColorPresetSensitivity,
    );
    updateColorPresetSensitivity();

    const backgroundOpacityRow = new Adw.SpinRow({
      title: "Background Opacity",
      subtitle: "Control how much of the desktop shows through Superbar",
      adjustment: new Gtk.Adjustment({
        lower: 65,
        upper: 100,
        step_increment: 1,
        page_increment: 5,
        value: settings.get_int("background-opacity"),
      }),
    });
    backgroundOpacityRow.add_suffix(
      new Gtk.Label({
        label: "%",
        css_classes: ["dim-label"],
      }),
    );
    settings.bind(
      "background-opacity",
      backgroundOpacityRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    appearanceGroup.add(backgroundOpacityRow);

    const barWidthRow = new Adw.SpinRow({
      title: "Bar Width",
      subtitle: "Width of the Superbar in pixels",
      adjustment: new Gtk.Adjustment({
        lower: 400,
        upper: 1200,
        step_increment: 10,
        page_increment: 50,
        value: settings.get_int("bar-width"),
      }),
    });
    settings.bind(
      "bar-width",
      barWidthRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    appearanceGroup.add(barWidthRow);

    const positionLabels = ["Top", "Center", "Bottom"];
    const positionKeys = ["top", "center", "bottom"];
    const positionRow = new Adw.ComboRow({
      title: "Vertical Position",
      subtitle: "Where on screen the bar appears",
      model: Gtk.StringList.new(positionLabels),
    });
    const currentPos = settings.get_string("bar-position");
    const currentPositionIndex = positionKeys.indexOf(currentPos);
    positionRow.set_selected(
      currentPositionIndex >= 0 ? currentPositionIndex : 1,
    );
    positionRow.connect("notify::selected", () => {
      settings.set_string(
        "bar-position",
        positionKeys[positionRow.selected] ?? "top",
      );
    });
    appearanceGroup.add(positionRow);

    // ── About / Donate page ────────────────────────────────────────────────
    const aboutPage = new Adw.PreferencesPage({
      title: "About",
      icon_name: "help-about-symbolic",
    });
    window.add(aboutPage);

    // Project info
    const infoGroup = new Adw.PreferencesGroup({ title: "Superbar" });
    aboutPage.add(infoGroup);

    const descRow = new Adw.ActionRow({
      title: "Version",
      subtitle: `${this.metadata.version ?? "Development"}`,
    });
    infoGroup.add(descRow);

    const sourceRow = new Adw.ActionRow({
      title: "Source Code",
      subtitle: "github.com/Furkan-rgb/superbar",
      activatable: true,
    });
    sourceRow.add_suffix(
      new Gtk.Image({
        icon_name: "external-link-symbolic",
        valign: Gtk.Align.CENTER,
      }),
    );
    sourceRow.connect("activated", () =>
      Gio.AppInfo.launch_default_for_uri(
        "https://github.com/Furkan-rgb/superbar",
        null,
      ),
    );
    infoGroup.add(sourceRow);

    // Donate
    const donateGroup = new Adw.PreferencesGroup({
      title: "Support Development",
      description:
        "Superbar is free and open-source. If you find it useful, consider buying me a coffee — it keeps the project going!",
    });
    aboutPage.add(donateGroup);

    const coffeeRow = new Adw.ActionRow({
      title: "Buy Me a Coffee ☕",
      subtitle: "buymeacoffee.com/furkan12",
      activatable: true,
    });
    coffeeRow.add_suffix(
      new Gtk.Image({
        icon_name: "external-link-symbolic",
        valign: Gtk.Align.CENTER,
      }),
    );
    coffeeRow.connect("activated", () =>
      Gio.AppInfo.launch_default_for_uri(
        "https://buymeacoffee.com/furkan12",
        null,
      ),
    );
    donateGroup.add(coffeeRow);
  }
}
