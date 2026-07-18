import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

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

      this._shortcutLabel = new Gtk.ShortcutLabel({
        valign: Gtk.Align.CENTER,
        disabled_text: "Disabled",
      });
      this._syncLabel();

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
        this._syncLabel();
      });

      this.add_suffix(this._shortcutLabel);
      this.add_suffix(editBtn);
      this.add_suffix(clearBtn);
    }

    _syncLabel() {
      const shortcuts = this._settings.get_strv(this._key);
      this._shortcutLabel.accelerator = shortcuts.length ? shortcuts[0] : "";
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
      const cancelBtn = new Gtk.Button({ label: "Cancel" });
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

      const controller = new Gtk.EventControllerKey();
      controller.connect("key-pressed", (_ctrl, keyval, keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
          dialog.destroy();
          return Gdk.EVENT_STOP;
        }

        // Ignore bare modifiers
        if (
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
          ].includes(keyval)
        )
          return Gdk.EVENT_PROPAGATE;

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
        if (accel && accel !== "") {
          this._settings.set_strv(this._key, [accel]);
          this._syncLabel();
        }

        dialog.destroy();
        return Gdk.EVENT_STOP;
      });

      dialog.add_controller(controller);
      dialog.present();
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

    // ── Search group ────────────────────────────────────────────────────────
    const searchGroup = new Adw.PreferencesGroup({
      title: "Search",
      description: "Control how Superbar orders matching results",
    });
    shortcutPage.add(searchGroup);

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
        GLib.file_set_contents(historyPath, "[]");
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
      description: "Adjust the size and position of the bar",
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

    const themeLabels = ["System", "Light", "Dark"];
    const themeKeys = ["system", "light", "dark"];
    const themeRow = new Adw.ComboRow({
      title: "Color Theme",
      subtitle: "Follow GNOME Shell or use a fixed light or dark style",
      model: Gtk.StringList.new(themeLabels),
    });
    const currentTheme = settings.get_string("theme-mode");
    const currentThemeIndex = themeKeys.indexOf(currentTheme);
    themeRow.set_selected(currentThemeIndex >= 0 ? currentThemeIndex : 0);
    themeRow.connect("notify::selected", () => {
      settings.set_string(
        "theme-mode",
        themeKeys[themeRow.selected] ?? "system",
      );
    });
    appearanceGroup.add(themeRow);

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

    const positionLabels = ["Top (¼ from top)", "Center", "Bottom"];
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
