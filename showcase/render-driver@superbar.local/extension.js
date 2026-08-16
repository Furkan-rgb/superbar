// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

/* Development-only driver for showcase renders.
 *
 * The renders used to come from a hand-written HTML replica of the bar, which
 * meant every visual change had to be made twice and the two copies drifted.
 * This puts the real extension into a fixed state inside a throwaway headless
 * Shell instead, so a render is the same widget tree, stylesheet, icon theme
 * and font stack that a user gets after installing.
 *
 * It is installed by scripts/render-live.mjs and is never packed into a
 * release. Nothing here is safe to ship: it reaches into Superbar's private
 * state on purpose.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import * as Config from "resource:///org/gnome/shell/misc/config.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const SUPERBAR_UUID = "superbar@Furkan-rgb.github.io";
const BUS_NAME = "org.superbar.RenderDriver";
const OBJECT_PATH = "/org/superbar/RenderDriver";

// screenshot_area() writes PNG bytes straight into a GOutputStream; the
// trailing callback is what Gio._promisify() supplies.
Gio._promisify(Shell.Screenshot.prototype, "screenshot_area");

const INTERFACE = `
<node>
  <interface name="org.superbar.RenderDriver">
    <method name="Describe">
      <arg type="s" direction="out" name="info"/>
    </method>
    <method name="ApplyState">
      <arg type="s" direction="in" name="state"/>
      <arg type="s" direction="out" name="info"/>
    </method>
    <method name="Capture">
      <arg type="s" direction="in" name="path"/>
      <arg type="i" direction="in" name="padding"/>
      <arg type="s" direction="out" name="info"/>
    </method>
  </interface>
</node>`;

export default class RenderDriverExtension {
  enable() {
    // Eval() is refused unless the Shell is in unsafe mode. The driver does not
    // need it, but having it available makes poking at a stuck render session
    // far quicker, so it is opt-in through the environment.
    if (GLib.getenv("SUPERBAR_RENDER_UNSAFE") === "1")
      global.context.unsafe_mode = true;

    this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE, this);
    this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    this._nameId = Gio.DBus.session.own_name(
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
    );
  }

  disable() {
    if (this._nameId) Gio.DBus.session.unown_name(this._nameId);
    this._nameId = null;
    this._dbus?.unexport();
    this._dbus = null;
  }

  _superbar() {
    const superbar = Main.extensionManager.lookup(SUPERBAR_UUID)?.stateObj;
    if (!superbar) throw new Error(`${SUPERBAR_UUID} is not loaded`);
    if (!superbar._container || !superbar._entry)
      throw new Error(`${SUPERBAR_UUID} has not built its UI yet`);
    return superbar;
  }

  Describe() {
    const superbar = Main.extensionManager.lookup(SUPERBAR_UUID);
    return JSON.stringify({
      shellVersion: Config.PACKAGE_VERSION ?? "unknown",
      stage: `${Math.round(global.stage.width)}x${Math.round(global.stage.height)}`,
      superbarState: superbar?.state ?? null,
      superbarError: superbar?.error || null,
    });
  }

  /* Resolving app ids here rather than in the fixture file is what puts real
   * themed icons in the renders: lookup_app() goes through the same AppSystem
   * the launcher itself searches, so the icon in the shot is the icon a user
   * would see. Fixtures that name no app fall back to a symbolic icon. */
  _resolveRow(row) {
    if (!row.appId) return row;

    const icon = Shell.AppSystem.get_default()
      .lookup_app(row.appId)
      ?.get_app_info()
      ?.get_icon();
    return icon ? { ...row, gicon: icon } : row;
  }

  ApplyState(stateJson) {
    const state = JSON.parse(stateJson);
    const superbar = this._superbar();

    // Reopening rather than mutating in place means each state starts from the
    // same baseline and picks up whatever settings the driver script just
    // wrote, including bar-position and theme-mode.
    superbar._closeSearch({ preserveSession: false });
    superbar._openSearch();

    // _presentSearch() eases the bar in over 250ms. A render wants the settled
    // frame, not a frame part way through the animation.
    const container = superbar._container;
    container.remove_all_transitions();
    container.opacity = 255;
    container.scale_x = 1;
    container.scale_y = 1;
    container.translation_y = 0;

    const query = state.query ?? "";
    const rows = (state.rows ?? []).map((row) => this._resolveRow(row));

    if (query.length > 0) {
      // set_text() emits text-changed, which would kick off a real search and
      // overwrite the fixture rows a moment later. The handler is connected as
      // an arrow that calls this._onTextChanged(), so shadowing the method on
      // the instance suppresses it without touching signal handlers.
      superbar._cancelPendingSearch();
      const handler = superbar._onTextChanged;
      superbar._onTextChanged = () => {};
      try {
        superbar._entry.set_text(query);
      } finally {
        superbar._onTextChanged = handler;
      }
      superbar._invalidatePendingSearch({ clearResumableSession: true });
    }

    superbar._applyQueryMode({ kind: state.mode ?? "generic" });

    if (rows.length === 0) {
      superbar._hideResults();
    } else {
      superbar._copiedClipboardValue = state.copiedValue ?? null;
      superbar._showResults(rows);
      if (Number.isInteger(state.selected)) superbar._setSelected(state.selected);
    }

    // The results box animates its height; jump straight to the target so the
    // capture does not catch it mid-collapse.
    superbar._updateResultsHeight(false);
    container.queue_relayout();
    global.stage.queue_relayout();

    return JSON.stringify({
      query,
      rows: rows.length,
      selected: superbar._selectedIndex,
    });
  }

  /* Captures the bar rather than the whole stage. A desktop behind it only
   * shrinks the thing the render is meant to show, so the crop is taken from
   * the container's own allocation, grown by `padding` to leave room for the
   * drop shadow the stylesheet paints outside it. */
  CaptureAsync([path, padding], invocation) {
    const container = this._superbar()._container;
    const [containerX, containerY] = container.get_transformed_position();
    const [containerWidth, containerHeight] = container.get_transformed_size();

    const x = Math.max(0, Math.floor(containerX - padding));
    const y = Math.max(0, Math.floor(containerY - padding));
    const width = Math.min(
      Math.round(global.stage.width) - x,
      Math.ceil(containerWidth + padding * 2),
    );
    const height = Math.min(
      Math.round(global.stage.height) - y,
      Math.ceil(containerHeight + padding * 2),
    );

    let stream;
    try {
      stream = Gio.File.new_for_path(path).replace(
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
      );
    } catch (error) {
      invocation.return_error_literal(
        Gio.IOErrorEnum,
        Gio.IOErrorEnum.FAILED,
        `cannot open ${path}: ${error.message}`,
      );
      return;
    }

    new Shell.Screenshot()
      .screenshot_area(x, y, width, height, stream)
      .then(() => {
        stream.close(null);
        invocation.return_value(
          new GLib.Variant("(s)", [JSON.stringify({ path, x, y, width, height })]),
        );
      })
      .catch((error) => {
        try {
          stream.close(null);
        } catch {
          // The stream is being abandoned either way.
        }
        invocation.return_error_literal(
          Gio.IOErrorEnum,
          Gio.IOErrorEnum.FAILED,
          `capture failed: ${error.message}`,
        );
      });
  }
}
