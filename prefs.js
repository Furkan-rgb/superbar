import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
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
            Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
            Gdk.KEY_Control_L, Gdk.KEY_Control_R,
            Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
            Gdk.KEY_Super_L, Gdk.KEY_Super_R,
            Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
          ].includes(keyval)
        )
          return Gdk.EVENT_PROPAGATE;

        const mask =
          state &
          (Gdk.ModifierType.SHIFT_MASK |
            Gdk.ModifierType.CONTROL_MASK |
            Gdk.ModifierType.ALT_MASK |
            Gdk.ModifierType.SUPER_MASK);

        const accel = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
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
  }
);

// ── Preferences page ────────────────────────────────────────────────────────

export default class SuperbarPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    window.set_default_size(600, 500);
    const settings = this.getSettings("org.gnome.shell.extensions.superbar");

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
      subtitle: `${this.metadata.version}`,
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
      })
    );
    sourceRow.connect("activated", () =>
      Gio.AppInfo.launch_default_for_uri(
        "https://github.com/Furkan-rgb/superbar",
        null
      )
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
      subtitle: "buymeacoffee.com/furkan.rgb",
      activatable: true,
    });
    coffeeRow.add_suffix(
      new Gtk.Image({
        icon_name: "external-link-symbolic",
        valign: Gtk.Align.CENTER,
      })
    );
    coffeeRow.connect("activated", () =>
      Gio.AppInfo.launch_default_for_uri(
        "https://buymeacoffee.com/furkan.rgb",
        null
      )
    );
    donateGroup.add(coffeeRow);
  }
}
