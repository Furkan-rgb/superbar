import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Soup from "gi://Soup";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

function ensureActorVisibleInScrollView(scrollView, actor) {
  const adjustment = scrollView.get_vadjustment
    ? scrollView.get_vadjustment()
    : scrollView.get_vscroll_bar().get_adjustment();
  const value = adjustment.value;
  const pageSize =
    adjustment.page_size ?? adjustment.pageSize ?? scrollView.height;
  const upper = adjustment.upper;
  const padding = 6;

  if (!pageSize || upper <= pageSize) return;

  const box = actor.get_allocation_box();
  let y1 = box.y1;
  let y2 = box.y2;
  let parent = actor.get_parent();

  while (parent && parent !== scrollView) {
    const parentBox = parent.get_allocation_box();
    y1 += parentBox.y1;
    y2 += parentBox.y1;
    parent = parent.get_parent();
  }

  if (!parent) return;

  let targetValue = value;
  if (y1 < value + padding) {
    targetValue = y1 - padding;
  } else if (y2 > value + pageSize - padding) {
    targetValue = y2 + padding - pageSize;
  }

  targetValue = Math.max(0, Math.min(upper - pageSize, targetValue));
  if (targetValue !== value) {
    adjustment.set_value(targetValue);
  }
}

export default class SearchBar extends Extension {
  enable() {
    this._settings = this.getSettings("org.gnome.shell.extensions.superbar");
    this._session = new Soup.Session();
    this._clipboard = St.Clipboard.get_default();
    this._clipboardHistory = [];
    this._loadClipboardHistory();

    this._container = new St.BoxLayout({
      style_class: "spotlight-container",
      vertical: true,
      reactive: true,
      can_focus: true,
    });

    this._inputRow = new St.BoxLayout({
      style_class: "spotlight-input-row",
      vertical: false,
    });

    this._icon = new St.Icon({
      icon_name: "system-search-symbolic",
      style_class: "spotlight-icon",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._entry = new St.Entry({
      hint_text: "Search apps, calculate...",
      style_class: "spotlight-entry",
      can_focus: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._inputRow.add_child(this._icon);
    this._inputRow.add_child(this._entry);
    this._container.add_child(this._inputRow);

    this._resultsBox = new St.BoxLayout({
      style_class: "spotlight-results-box",
      vertical: true,
      x_expand: true,
    });

    this._resultsScroll = new St.ScrollView({
      style_class: "spotlight-results-scroll",
      x_expand: true,
      overlay_scrollbars: true,
    });
    this._resultsScroll.set_child(this._resultsBox);
    this._resultsScroll.set_policy(
      St.PolicyType.NEVER,
      St.PolicyType.AUTOMATIC,
    );

    this._resultsClip = new St.Widget({
      style_class: "spotlight-results-clip",
      layout_manager: new Clutter.BinLayout(),
      x_expand: true,
      clip_to_allocation: true,
    });
    this._resultsClip.add_child(this._resultsScroll);
    this._resultsScroll.height = 0;
    this._resultsClip.height = 0;
    this._container.add_child(this._resultsClip);

    this._keyPressId = this._entry.clutter_text.connect(
      "key-press-event",
      (actor, event) => {
        if (!this._container.visible) return Clutter.EVENT_PROPAGATE;

        const key = event.get_key_symbol();

        if (key === Clutter.KEY_Down || key === Clutter.KEY_Tab) {
          const max = this._results.length - 1;
          if (this._selectedIndex < max) {
            this._setSelected(this._selectedIndex + 1);
          } else if (this._results.length > 0 && this._selectedIndex === -1) {
            this._setSelected(0);
          }
          return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Up) {
          if (this._selectedIndex > 0) {
            this._setSelected(this._selectedIndex - 1);
          } else if (this._selectedIndex === 0) {
            this._setSelected(-1);
          }
          return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
          const targetIndex =
            this._selectedIndex > -1 ? this._selectedIndex : 0;
          if (this._results.length > 0) {
            this._activateResult(targetIndex);
          }
          return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Escape) {
          if (this._entry.get_text().length > 0) {
            this._entry.set_text("");
          } else {
            this._closeSearch();
          }
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      },
    );

    Main.layoutManager.addChrome(this._container);
    this._repositionContainer();

    this._container.set_pivot_point(0.5, 0.5);
    this._container.opacity = 0;
    this._container.scale_x = 0.95;
    this._container.scale_y = 0.95;
    this._container.hide();

    this._selectedIndex = -1;
    this._results = [];

    this._desktopSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface",
    });
    this._themeChangeId = this._desktopSettings.connect(
      "changed::color-scheme",
      this._updateTheme.bind(this),
    );
    this._updateTheme();

    this._textChangedId = this._entry.clutter_text.connect("text-changed", () =>
      this._onTextChanged(),
    );

    this._settingsChangedIds = [
      this._settings.connect("changed::bar-width", () =>
        this._repositionContainer(),
      ),
      this._settings.connect("changed::bar-position", () =>
        this._repositionContainer(),
      ),
      this._settings.connect("changed::clipboard-monitor-enabled", () => {
        if (this._settings.get_boolean("clipboard-monitor-enabled")) {
          this._startClipboardMonitoring();
        } else if (this._clipboardPollId) {
          GLib.source_remove(this._clipboardPollId);
          this._clipboardPollId = null;
        }
      }),
    ];

    Main.wm.addKeybinding(
      "toggle-shortcut",
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      this._toggleSearch.bind(this),
    );

    this._startClipboardMonitoring();
  }

  disable() {
    Main.wm.removeKeybinding("toggle-shortcut");
    if (this._settingsChangedIds) {
      this._settingsChangedIds.forEach((id) => this._settings.disconnect(id));
      this._settingsChangedIds = null;
    }
    this._settings = null;

    if (this._clipboardPollId) {
      GLib.source_remove(this._clipboardPollId);
      this._clipboardPollId = null;
    }

    if (this._themeChangeId) {
      this._desktopSettings.disconnect(this._themeChangeId);
      this._themeChangeId = null;
    }
    this._desktopSettings = null;

    if (this._textChangedId) {
      this._entry.clutter_text.disconnect(this._textChangedId);
      this._textChangedId = null;
    }

    if (this._keyPressId) {
      this._entry.clutter_text.disconnect(this._keyPressId);
      this._keyPressId = null;
    }

    if (this._searchTimeout) {
      GLib.source_remove(this._searchTimeout);
      this._searchTimeout = null;
    }

    if (this._selectionScrollTimeoutId) {
      GLib.source_remove(this._selectionScrollTimeoutId);
      this._selectionScrollTimeoutId = null;
    }

    if (this._clickShield) {
      this._clickShield.destroy();
      this._clickShield = null;
    }

    if (this._container) {
      Main.layoutManager.removeChrome(this._container);
      this._container.destroy();
      this._container = null;
    }

    if (this._session) {
      this._session.abort();
      this._session = null;
    }

    this._icon = null;
    this._entry = null;
    this._inputRow = null;
    this._resultsBox = null;
    this._resultsScroll = null;
    this._resultsClip = null;
  }

  // --- Open / Close ---

  _toggleSearch() {
    if (this._container.visible) {
      this._closeSearch();
    } else {
      this._openSearch();
    }
  }

  _openSearch() {
    this._pollClipboard();

    this._clickShield = new St.Widget({
      reactive: true,
      width: global.stage.width,
      height: global.stage.height,
    });
    Main.layoutManager.addChrome(this._clickShield);
    this._container
      .get_parent()
      .set_child_above_sibling(this._container, this._clickShield);
    this._shieldClickId = this._clickShield.connect(
      "button-press-event",
      () => {
        this._closeSearch();
        return Clutter.EVENT_STOP;
      },
    );

    this._container.show();
    global.stage.set_key_focus(this._entry);

    this._container.ease({
      opacity: 255,
      scale_x: 1.0,
      scale_y: 1.0,
      time: 180,
      transition: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });

    if (this._entry.get_text().length > 0) {
      this._onTextChanged();
    }
  }

  _closeSearch() {
    global.stage.set_key_focus(null);

    if (this._shieldClickId && this._clickShield) {
      this._clickShield.disconnect(this._shieldClickId);
      this._shieldClickId = null;
    }
    if (this._clickShield) {
      Main.layoutManager.removeChrome(this._clickShield);
      this._clickShield.destroy();
      this._clickShield = null;
    }

    this._animateResultsHeight(0);

    this._container.ease({
      opacity: 0,
      scale_x: 0.95,
      scale_y: 0.95,
      time: 130,
      transition: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        this._container.hide();
        this._clearResults();
      },
    });
  }

  // --- Search ---

  _onTextChanged() {
    const text = this._entry.get_text().trim();

    if (this._searchTimeout) {
      GLib.source_remove(this._searchTimeout);
      this._searchTimeout = null;
    }

    if (text.length === 0) {
      this._clearResults();
      this._animateResultsHeight(0);
      return;
    }

    this._searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      this._searchTimeout = null;
      const currentText = this._entry.get_text().trim();
      if (currentText.length === 0) return GLib.SOURCE_REMOVE;

      if (this._isCurrencyExpression(currentText)) {
        this._fetchCurrency(currentText);
        return GLib.SOURCE_REMOVE;
      }
      if (
        /^(?:weather|temp(?:erature)?|forecast|humidity|rain|snow|wind|hot|cold|clima|meteo)\s+/i.test(
          currentText,
        )
      ) {
        this._fetchWeather(currentText);
        return GLib.SOURCE_REMOVE;
      }
      if (/^def(?:ine)?\s+/i.test(currentText)) {
        this._fetchDictionary(currentText);
        return GLib.SOURCE_REMOVE;
      }

      const clipboardQuery = this._parseClipboardQuery(currentText);
      if (clipboardQuery !== null) {
        this._showResults(this._searchClipboardHistory(clipboardQuery));
        return GLib.SOURCE_REMOVE;
      }

      const actionQuery = this._parseActionQuery(currentText);
      if (actionQuery !== null) {
        this._showResults(this._searchSystemCommands(actionQuery));
        return GLib.SOURCE_REMOVE;
      }

      if (this._isMathExpression(currentText)) {
        const calcResult = this._evaluate(currentText);
        if (calcResult !== null) {
          this._showResults([
            {
              type: "calc",
              label: `= ${calcResult}`,
              icon: "accessories-calculator-symbolic",
              value: String(calcResult),
            },
          ]);
          return GLib.SOURCE_REMOVE;
        }
      }

      const windowResults = this._searchWindows(currentText);
      const appResults = this._searchApps(currentText);
      const systemFolders = [
        "Downloads",
        "Documents",
        "Pictures",
        "Videos",
        "Music",
      ];
      const folderMatches = systemFolders
        .map((f) => ({
          score: this._scoreSearchMatch(f, currentText),
          type: "file",
          label: f,
          icon: "folder-symbolic",
          uri: `file://${GLib.get_home_dir()}/${f}`,
        }))
        .filter((result) => result.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map(({ score, ...result }) => result);

      this._searchFiles(currentText).then((fileResults) => {
        if (this._entry.get_text().trim() !== currentText) return;

        const rankedFileResults = this._rankResultsByQuery(
          fileResults,
          currentText,
        );

        const combinedResults = [
          ...windowResults,
          ...folderMatches,
          ...appResults,
          ...rankedFileResults,
          {
            type: "web",
            label: `Search the web for "${currentText}"`,
            icon: "web-browser-symbolic",
            query: currentText,
          },
        ];

        this._showResults(
          this._dedupeResults(combinedResults).slice(
            0,
            this._settings.get_int("max-results"),
          ),
        );
      });

      return GLib.SOURCE_REMOVE;
    });
  }

  _parseClipboardQuery(text) {
    const normalized = text.trim();
    const match = normalized.match(
      /^(?:clip|clipboard|history)(?::|\s+)?(.*)$/i,
    );
    if (!match) return null;
    return match[1].trim();
  }

  _getClipboardHistoryPath() {
    return GLib.build_filenamev([
      GLib.get_user_data_dir(),
      "search-bar-clipboard-history.json",
    ]);
  }

  _loadClipboardHistory() {
    const file = Gio.File.new_for_path(this._getClipboardHistoryPath());
    file.load_contents_async(null, (_file, res) => {
      try {
        const [success, contents] = file.load_contents_finish(res);
        if (!success) return;
        const data = JSON.parse(new TextDecoder().decode(contents));
        if (!Array.isArray(data)) return;
        this._clipboardHistory = data
          .filter((entry) => typeof entry?.text === "string")
          .slice(0, this._settings.get_int("clipboard-history-limit"));
      } catch (_e) {
        // history file missing or corrupt; start fresh
      }
    });
  }

  _saveClipboardHistory() {
    try {
      GLib.file_set_contents(
        this._getClipboardHistoryPath(),
        JSON.stringify(this._clipboardHistory),
      );
    } catch (_e) {
      // save errors are non-fatal; silently ignore
    }
  }

  _startClipboardMonitoring() {
    if (!this._settings.get_boolean("clipboard-monitor-enabled")) return;
    this._pollClipboard();
    this._clipboardPollId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      1200,
      () => {
        this._pollClipboard();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _pollClipboard() {
    this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (...args) => {
      const textArg = args.find((arg) => typeof arg === "string");
      this._storeClipboardEntry(textArg ?? "");
    });
  }

  _storeClipboardEntry(text) {
    if (typeof text !== "string") return;

    const normalized = text.trim();
    if (!normalized) return;

    if (this._clipboardHistory[0]?.text === text) return;

    this._clipboardHistory = [
      {
        text,
        preview: normalized.replace(/\s+/g, " ").slice(0, 80),
        timestamp: Date.now(),
      },
      ...this._clipboardHistory.filter((entry) => entry.text !== text),
    ].slice(0, this._settings.get_int("clipboard-history-limit"));

    this._saveClipboardHistory();

    if (this._container.visible) {
      const query = this._parseClipboardQuery(this._entry.get_text().trim());
      if (query !== null) {
        this._showResults(this._searchClipboardHistory(query));
      }
    }
  }

  _scoreSearchMatch(text, query) {
    const haystack = text.toLowerCase().trim();
    const needle = query.toLowerCase().trim();
    if (!needle) return 0;
    if (!haystack) return -1;

    if (haystack === needle) return 1000;
    if (haystack.startsWith(needle))
      return 850 - (haystack.length - needle.length);

    const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((word) => word.startsWith(needle))) {
      return 700 - (haystack.length - needle.length);
    }

    const includeIndex = haystack.indexOf(needle);
    if (includeIndex !== -1) return 500 - includeIndex;

    let queryIndex = 0;
    let firstMatch = -1;
    let lastMatch = -1;
    let contiguousBonus = 0;

    for (let index = 0; index < haystack.length; index += 1) {
      if (haystack[index] !== needle[queryIndex]) continue;

      if (firstMatch === -1) firstMatch = index;
      if (lastMatch === index - 1) contiguousBonus += 8;
      lastMatch = index;
      queryIndex += 1;

      if (queryIndex === needle.length) {
        return 300 - firstMatch + contiguousBonus;
      }
    }

    return -1;
  }

  _rankResultsByQuery(
    results,
    query,
    textSelector = (result) => result.label ?? "",
  ) {
    return results
      .map((result) => ({
        score: this._scoreSearchMatch(textSelector(result), query),
        result,
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.result);
  }

  _searchClipboardHistory(query) {
    return this._rankResultsByQuery(
      this._clipboardHistory.map((entry) => ({
        type: "clipboard",
        label: entry.preview ?? entry.text.replace(/\s+/g, " ").slice(0, 80),
        icon: "edit-paste-symbolic",
        value: entry.text,
        timestamp: entry.timestamp,
      })),
      query,
      (result) => result.value,
    );
  }

  _parseActionQuery(text) {
    const normalized = text.trim();
    if (normalized === ">") return "";

    const symbolMatch = normalized.match(/^>\s*(.*)$/);
    if (symbolMatch) return symbolMatch[1].trim();

    const prefixMatch = normalized.match(
      /^(?:cmd|command|action)(?::|\s+)?(.*)$/i,
    );
    if (prefixMatch) return prefixMatch[1].trim();

    return null;
  }

  _searchApps(text) {
    const query = text.toLowerCase();
    // get_installed() returns Gio.AppInfo (DesktopAppInfo) objects, not Shell.App
    return Shell.AppSystem.get_default()
      .get_installed()
      .map((appInfo) => ({
        score: this._scoreSearchMatch(appInfo.get_name() ?? "", query),
        appInfo,
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, this._settings.get_int("max-results"))
      .map(({ appInfo }) => ({
        type: "app",
        label: appInfo.get_name(),
        gicon: appInfo.get_icon(),
        appId: appInfo.get_id(),
      }));
  }

  _dedupeResults(results) {
    const seenUris = new Set();

    return results.filter((result) => {
      if (!result.uri) return true;
      if (seenUris.has(result.uri)) return false;

      seenUris.add(result.uri);
      return true;
    });
  }

  _searchWindows(text) {
    const query = text.toLowerCase();
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
    return windows
      .map((w) => {
        const title = w.get_title() ?? "";
        const app = Shell.WindowTracker.get_default().get_window_app(w);
        const appName = app?.get_name() ?? "";
        return {
          score: Math.max(
            this._scoreSearchMatch(title, query),
            this._scoreSearchMatch(appName, query),
          ),
          window: w,
          title,
        };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(({ window, title }) => ({
        type: "window",
        label: `Switch to: ${title}`,
        icon: "go-jump-symbolic",
        window,
      }));
  }

  _searchSystemCommands(text) {
    const query = text.toLowerCase();
    const commands = [
      {
        label: "Shut Down",
        cmd: "gnome-session-quit --power-off",
        icon: "system-shutdown-symbolic",
        keywords: ["poweroff", "power off", "shutdown", "off"],
      },
      {
        label: "Restart",
        cmd: "gnome-session-quit --reboot",
        icon: "view-refresh-symbolic",
        keywords: ["reboot", "reload", "restart"],
      },
      {
        label: "Log Out",
        cmd: "gnome-session-quit --logout",
        icon: "system-log-out-symbolic",
        keywords: ["logout", "sign out", "log out"],
      },
      {
        label: "Lock Screen",
        cmd: "loginctl lock-session",
        icon: "system-lock-screen-symbolic",
        keywords: ["lock", "screen lock"],
      },
      {
        label: "Sleep",
        cmd: "systemctl suspend",
        icon: "weather-clear-night-symbolic",
        keywords: ["suspend", "sleep"],
      },
      {
        label: "Open Settings",
        cmd: "gnome-control-center",
        icon: "org.gnome.Settings-symbolic",
        keywords: ["settings", "preferences", "control center"],
      },
      {
        label: "Wi-Fi Settings",
        cmd: "gnome-control-center wifi",
        icon: "network-wireless-signal-excellent-symbolic",
        keywords: ["wifi", "wi-fi", "wireless", "network"],
      },
      {
        label: "Bluetooth Settings",
        cmd: "gnome-control-center bluetooth",
        icon: "bluetooth-active-symbolic",
        keywords: ["bluetooth", "bt"],
      },
      {
        label: "Display Settings",
        cmd: "gnome-control-center display",
        icon: "video-display-symbolic",
        keywords: ["display", "monitor", "screen settings"],
      },
      {
        label: "Sound Settings",
        cmd: "gnome-control-center sound",
        icon: "audio-volume-high-symbolic",
        keywords: ["sound", "audio", "volume settings"],
      },
      {
        label: "Open Downloads",
        cmd: `gio open "${GLib.get_home_dir()}/Downloads"`,
        icon: "folder-download-symbolic",
        keywords: ["downloads", "download folder"],
      },
      {
        label: "Open Documents",
        cmd: `gio open "${GLib.get_home_dir()}/Documents"`,
        icon: "folder-documents-symbolic",
        keywords: ["documents", "docs", "document folder"],
      },
      {
        label: "Open Pictures",
        cmd: `gio open "${GLib.get_home_dir()}/Pictures"`,
        icon: "folder-pictures-symbolic",
        keywords: ["pictures", "photos", "images"],
      },
      {
        label: "Take Screenshot",
        cmds: [
          "gnome-screenshot -i",
          "gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.portal.Screenshot.Screenshot '' \"{'interactive': <true>}\"",
        ],
        icon: "applets-screenshooter-symbolic",
        keywords: ["screenshot", "screen capture", "capture"],
      },
    ];
    return commands
      .map((c) => ({
        score: this._scoreSearchMatch(
          [c.label, ...(c.keywords ?? [])].join(" "),
          query,
        ),
        command: c,
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(({ command: c }) => ({
        type: "system",
        label: c.label,
        icon: c.icon,
        cmd: c.cmd,
        cmds: c.cmds,
      }));
  }

  _runSystemAction(result) {
    try {
      if (Array.isArray(result.cmds) && result.cmds.length > 0) {
        for (const command of result.cmds) {
          const executable = command.trim().split(/\s+/)[0];
          if (!GLib.find_program_in_path(executable)) continue;

          GLib.spawn_command_line_async(command);
          return;
        }

        return; // no available executable for this action
      }

      if (result.cmd) {
        GLib.spawn_command_line_async(result.cmd);
      }
    } catch (e) {
      console.error(`[Superbar] Action failed (${result.label}): ${e.message}`);
    }
  }

  async _searchFiles(text) {
    return new Promise((resolve) => {
      try {
        const binary = GLib.find_program_in_path("localsearch")
          ? "localsearch"
          : "tracker3";
        const proc = new Gio.Subprocess({
          argv: [binary, "search", "--limit=6", text],
          flags:
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (proc, res) => {
          try {
            const [, stdout] = proc.communicate_utf8_finish(res);
            if (!stdout) return resolve([]);

            const ansiRegex =
              /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
            const lines = stdout
              .replace(ansiRegex, "")
              .split("\n")
              .filter((l) => l.includes("file://"));

            const fileResults = lines.map((line) => {
              const uri = line.trim().split(/\s+/)[0];
              const file = Gio.File.new_for_uri(uri);
              const pathParts = uri.split("/").filter((p) => p.length > 0);
              const filename = decodeURIComponent(pathParts.pop() || "");
              const fileInfo = file.query_info(
                "standard::symbolic-icon",
                Gio.FileQueryInfoFlags.NONE,
                null,
              );
              return {
                type: "file",
                label: filename,
                gicon: fileInfo.get_symbolic_icon(),
                uri,
              };
            });
            resolve(fileResults);
          } catch (e) {
            resolve([]);
          }
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  // --- Web Fetches ---

  async _fetchWeather(text) {
    const match = text
      .trim()
      .match(
        /^(?:weather|temp(?:erature)?|forecast|humidity|rain|snow|wind|hot|cold|clima|meteo)\s+(.+)$/i,
      );
    if (!match) return;
    const query = match[1].trim();

    try {
      // Step 1: Resolve the city name to coordinates
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
      const geoBytes = await this._session.send_and_read_async(
        Soup.Message.new("GET", geoUrl),
        GLib.PRIORITY_DEFAULT,
        null,
      );

      if (this._entry.get_text().trim() !== text) return;

      const geoData = JSON.parse(new TextDecoder().decode(geoBytes.get_data()));
      if (!geoData.results?.length) return;

      const { name, latitude, longitude, country_code } = geoData.results[0];
      const cityName = country_code
        ? `${name}, ${country_code.toUpperCase()}`
        : name;

      // Step 2: Fetch weather for those coordinates
      const weatherUrl =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
        `&daily=temperature_2m_max,temperature_2m_min` +
        `&timezone=auto&forecast_days=1`;
      const weatherBytes = await this._session.send_and_read_async(
        Soup.Message.new("GET", weatherUrl),
        GLib.PRIORITY_DEFAULT,
        null,
      );

      if (this._entry.get_text().trim() !== text) return;

      const w = JSON.parse(new TextDecoder().decode(weatherBytes.get_data()));
      const c = w.current;
      const d = w.daily;
      const code = c.weather_code;

      this._showResults([
        {
          type: "weather",
          icon: this._weatherIcon(code),
          temp: `${Math.round(c.temperature_2m)}°C`,
          description: this._wmoDescription(code),
          city: cityName,
          details:
            `Feels like ${Math.round(c.apparent_temperature)}°C` +
            `  ·  Wind ${Math.round(c.wind_speed_10m)} km/h` +
            `  ·  Humidity ${c.relative_humidity_2m}%` +
            `  ·  ↑${Math.round(d.temperature_2m_max[0])}°  ↓${Math.round(d.temperature_2m_min[0])}°`,
          uri: `https://wttr.in/${encodeURIComponent(name)}`,
        },
      ]);
    } catch (e) {}
  }

  _weatherIcon(code) {
    if (code <= 1) return "weather-clear-symbolic";
    if (code === 2) return "weather-few-clouds-symbolic";
    if (code === 3) return "weather-overcast-symbolic";
    if (code === 45 || code === 48) return "weather-fog-symbolic";
    if (code >= 95) return "weather-storm-symbolic";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86)
      return "weather-snow-symbolic";
    return "weather-showers-symbolic";
  }

  _wmoDescription(code) {
    const map = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      48: "Icing fog",
      51: "Light drizzle",
      53: "Moderate drizzle",
      55: "Dense drizzle",
      56: "Light freezing drizzle",
      57: "Dense freezing drizzle",
      61: "Slight rain",
      63: "Moderate rain",
      65: "Heavy rain",
      66: "Light freezing rain",
      67: "Heavy freezing rain",
      71: "Slight snow",
      73: "Moderate snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Slight showers",
      81: "Moderate showers",
      82: "Violent showers",
      85: "Slight snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm, slight hail",
      99: "Thunderstorm, heavy hail",
    };
    return map[code] ?? "Unknown";
  }

  async _fetchDictionary(text) {
    const match = text.trim().match(/^def(?:ine)?\s+(.+)$/i);
    if (!match) return;
    const word = match[1];

    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const bytes = await this._session.send_and_read_async(
        Soup.Message.new("GET", url),
        GLib.PRIORITY_DEFAULT,
        null,
      );

      if (this._entry.get_text().trim() !== text) return;

      const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
      if (data?.length > 0) {
        const meaning = data[0].meanings[0].definitions[0].definition;
        this._showResults([
          {
            type: "web",
            label: `${word}: ${meaning}`,
            icon: "accessories-dictionary-symbolic",
            query: word,
          },
        ]);
      }
    } catch (_e) {
      // dictionary lookup failed; silently ignore
    }
  }

  _isCurrencyExpression(text) {
    return /^\d+(\.\d+)?\s*[a-zA-Z]+\s+to\s+[a-zA-Z]+$/i.test(text.trim());
  }

  async _fetchCurrency(text) {
    const commonNames = {
      yen: "JPY",
      euro: "EUR",
      euros: "EUR",
      dollar: "USD",
      dollars: "USD",
      pound: "GBP",
      pounds: "GBP",
      rupee: "INR",
    };

    const parts = text.trim().toLowerCase().split(/\s+/);
    const amount = parts[0];
    const from = commonNames[parts[1]] || parts[1].toUpperCase();
    const to = commonNames[parts[3]] || parts[3].toUpperCase();

    if (from.length !== 3 || to.length !== 3) return;

    try {
      const url = `https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`;
      const bytes = await this._session.send_and_read_async(
        Soup.Message.new("GET", url),
        GLib.PRIORITY_DEFAULT,
        null,
      );

      if (this._entry.get_text().trim() !== text) return;

      const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
      if (data.rates?.[to] !== undefined) {
        this._showResults([
          {
            type: "calc",
            label: `${data.rates[to]} ${to}`,
            icon: "view-refresh-symbolic",
            value: String(data.rates[to]),
          },
        ]);
      }
    } catch (_e) {
      // currency fetch failed; silently ignore
    }
  }

  // --- Math ---

  _isMathExpression(text) {
    return (
      /^[\d\s\+\-\*\/\(\)\.\%\^]+$/.test(text) && /[\+\-\*\/\%\^]/.test(text)
    );
  }

  _evaluate(expr) {
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result === "number" && isFinite(result)) {
        return Math.round(result * 1e10) / 1e10;
      }
    } catch (_) {}
    return null;
  }

  // --- Results ---

  _showResults(results) {
    this._clearResults();
    this._results = results;
    this._selectedIndex = -1;

    if (results.length === 0) {
      this._animateResultsHeight(0);
      return;
    }

    results.forEach((result, index) => {
      const row = new St.Button({
        style_class: "spotlight-result-row",
        x_expand: true,
        can_focus: false,
      });

      if (result.type === "weather") {
        row.add_style_class_name("weather-card");

        const topRow = new St.BoxLayout({ vertical: false, x_expand: true });
        topRow.add_child(
          new St.Icon({
            icon_name: result.icon,
            style_class: "weather-card-icon",
          }),
        );
        topRow.add_child(
          new St.Label({
            text: result.temp,
            style_class: "weather-temp",
            y_align: Clutter.ActorAlign.CENTER,
          }),
        );

        const infoBox = new St.BoxLayout({
          vertical: true,
          x_expand: true,
          y_align: Clutter.ActorAlign.CENTER,
        });
        infoBox.add_child(
          new St.Label({
            text: result.description,
            style_class: "weather-desc",
          }),
        );
        infoBox.add_child(
          new St.Label({ text: result.city, style_class: "weather-city" }),
        );
        topRow.add_child(infoBox);

        const card = new St.BoxLayout({ vertical: true, x_expand: true });
        card.add_child(topRow);
        card.add_child(
          new St.Label({
            text: result.details,
            style_class: "weather-details",
            x_expand: true,
          }),
        );
        row.set_child(card);
      } else {
        if (result.type === "calc") row.add_style_class_name("answer");

        const rowBox = new St.BoxLayout({ vertical: false, x_expand: true });
        const icon = result.gicon
          ? new St.Icon({
              gicon: result.gicon,
              icon_size: 24,
              style_class: "spotlight-result-icon",
            })
          : new St.Icon({
              icon_name: result.icon || "system-search-symbolic",
              icon_size: 24,
              style_class: "spotlight-result-icon",
            });
        rowBox.add_child(icon);
        rowBox.add_child(
          new St.Label({
            text: result.label,
            style_class: "spotlight-result-label",
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
          }),
        );
        row.set_child(rowBox);
      }

      row.connect("clicked", () => this._activateResult(index));
      this._resultsBox.add_child(row);
    });

    this._updateSelection();

    this._resultsBox.queue_relayout();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
      const [, naturalHeight] = this._resultsBox.get_preferred_height(
        this._resultsBox.width,
      );
      this._animateResultsHeight(Math.min(naturalHeight, 450));
      return GLib.SOURCE_REMOVE;
    });
  }

  _clearResults() {
    this._results = [];
    this._selectedIndex = -1;
    this._resultsBox.get_children().forEach((c) => c.destroy());
  }

  _activateResult(index) {
    const result = this._results[index];
    if (!result) return;

    if (result.type === "app") {
      try {
        // Resolve the Shell.App to get proper window management (focus if running)
        const shellApp = Shell.AppSystem.get_default().lookup_app(result.appId);
        if (shellApp) {
          shellApp.activate();
        } else {
          // Fallback: launch via Gio directly
          const appInfo = GioUnix.DesktopAppInfo.new(result.appId);
          if (appInfo) appInfo.launch([], null);
        }
      } catch (e) {
        console.error(`[Search Bar] Failed to launch app: ${e}`);
      }
    } else if (result.type === "calc") {
      St.Clipboard.get_default().set_text(
        St.ClipboardType.CLIPBOARD,
        result.value,
      );
    } else if (result.type === "clipboard") {
      this._clipboard.set_text(St.ClipboardType.CLIPBOARD, result.value);
    } else if (result.type === "weather") {
      Gio.AppInfo.launch_default_for_uri(result.uri, null);
    } else if (result.type === "web") {
      const uri =
        result.uri ??
        `https://www.google.com/search?q=${encodeURIComponent(result.query)}`;
      Gio.AppInfo.launch_default_for_uri(uri, null);
    } else if (result.type === "system") {
      this._runSystemAction(result);
    } else if (result.type === "window") {
      result.window.get_workspace().activate(global.get_current_time());
      result.window.activate(global.get_current_time());
    } else if (result.type === "file") {
      Gio.AppInfo.launch_default_for_uri(result.uri, null);
    }

    this._closeSearch();
  }

  _setSelected(index) {
    this._selectedIndex = index;
    this._updateSelection();
  }

  _updateSelection() {
    const rows = this._resultsBox.get_children();
    rows.forEach((row, i) => {
      row.remove_style_class_name("selected");
      row.remove_style_class_name("inactive-selection");

      if (i === this._selectedIndex) {
        row.add_style_class_name("selected");
      } else if (this._selectedIndex === -1 && i === 0) {
        row.add_style_class_name("inactive-selection");
      }
    });

    this._queueScrollToSelection();
  }

  _queueScrollToSelection() {
    if (this._selectionScrollTimeoutId) {
      GLib.source_remove(this._selectionScrollTimeoutId);
      this._selectionScrollTimeoutId = null;
    }

    this._resultsBox.queue_relayout();
    this._selectionScrollTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      0,
      () => {
        this._selectionScrollTimeoutId = null;
        this._scrollToSelection();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _scrollToSelection() {
    if (this._selectedIndex < 0) return;

    const row = this._resultsBox.get_child_at_index(this._selectedIndex);
    if (!row) return;

    ensureActorVisibleInScrollView(this._resultsScroll, row);
  }

  _animateResultsHeight(targetHeight) {
    this._resultsScroll.height = targetHeight;
    this._resultsScroll.set_height(targetHeight);
    this._resultsClip.ease({
      height: targetHeight,
      time: 200,
      transition: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
  }

  // --- Layout ---

  _repositionContainer() {
    const containerWidth = this._settings.get_int("bar-width");
    const positionKey = this._settings.get_string("bar-position");
    const fractionMap = { top: 0.25, center: 0.4, bottom: 0.65 };
    const fraction = fractionMap[positionKey] ?? 0.25;
    this._container.set_size(containerWidth, -1);
    this._container.set_position(
      Math.floor((global.stage.width - containerWidth) / 2),
      Math.floor(global.stage.height * fraction),
    );
  }

  // --- Theme ---

  _updateTheme() {
    const colorScheme = this._desktopSettings.get_string("color-scheme");
    if (colorScheme === "prefer-dark") {
      this._container.add_style_class_name("dark-mode");
    } else {
      this._container.remove_style_class_name("dark-mode");
    }
  }
}
