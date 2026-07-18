import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Soup from "gi://Soup";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as SystemActions from "resource:///org/gnome/shell/misc/systemActions.js";
import * as Screenshot from "resource:///org/gnome/shell/ui/screenshot.js";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";

const FILE_SEARCH_DELAY_MS = 80;
const REMOTE_SEARCH_DELAY_MS = 220;
const RESULTS_REVEAL_ANIMATION_MS = 85;
const RESULTS_COLLAPSE_ANIMATION_MS = 45;
const RESULTS_MIN_HEIGHT = 120;
const RESULTS_MAX_HEIGHT_FRACTION = 0.52;
const OPEN_ANIMATION_MS = 250;
const OPEN_TRANSLATION_Y = -10;
const OPEN_SCALE = 0.985;
const BACKGROUND_BLUR_RADIUS = 30;
const STRONG_LOCAL_MATCH_SCORE = 600;
// Local results below this relevance score are hidden entirely (only the web
// search remains). Substring/word/prefix matches clear it; scattered
// subsequence matches — the usual source of unrelated results — do not.
const MINIMUM_LOCAL_MATCH_SCORE = 500;
const RESUMABLE_SESSION_TTL_MS = 5 * 60 * 1000;
const MONITOR_EDGE_MARGIN = 24;
const RANKING_HISTORY_LIMIT = 50;
const RANKING_HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const SOURCE_RANK_BONUS = {
  app: 100,
  appAction: 60,
  window: 80,
  folder: 35,
  file: 10,
};
const SYSTEM_FOLDERS = [
  "Downloads",
  "Documents",
  "Pictures",
  "Videos",
  "Music",
];

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function scoreSingleSearchTerm(haystack, needle) {
  if (!needle) return 0;
  if (!haystack) return -1;

  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) {
    return 880 - Math.min(80, haystack.length - needle.length);
  }

  const words = haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const wordIndex = words.findIndex((word) => word.startsWith(needle));
  if (wordIndex !== -1) {
    const lengthPenalty = Math.min(80, haystack.length - needle.length);
    return 760 - wordIndex * 8 - lengthPenalty;
  }

  const includeIndex = haystack.indexOf(needle);
  if (includeIndex !== -1) {
    return 620 - Math.min(140, includeIndex * 4);
  }

  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let contiguousMatches = 0;

  for (let index = 0; index < haystack.length; index += 1) {
    if (haystack[index] !== needle[queryIndex]) continue;

    if (firstMatch === -1) firstMatch = index;
    if (lastMatch === index - 1) contiguousMatches += 1;
    lastMatch = index;
    queryIndex += 1;

    if (queryIndex === needle.length) {
      const span = lastMatch - firstMatch + 1;
      const gapPenalty = Math.max(0, span - needle.length) * 10;
      const startPenalty = firstMatch * 3;
      return Math.max(
        120,
        420 + contiguousMatches * 5 - gapPenalty - startPenalty,
      );
    }
  }

  return -1;
}

function scoreSearchMatch(text, query) {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  if (!haystack) return -1;

  const phraseScore = scoreSingleSearchTerm(haystack, needle);
  const terms = needle.split(/\s+/).filter(Boolean);
  if (terms.length < 2) return phraseScore;

  const termScores = terms.map((term) =>
    scoreSingleSearchTerm(haystack, term),
  );
  if (termScores.some((score) => score < 0)) return phraseScore;

  const averageScore =
    termScores.reduce((total, score) => total + score, 0) /
    termScores.length;
  const orderedBonus = haystack.includes(needle) ? 60 : 0;
  const tokenScore = Math.min(
    970,
    Math.round(averageScore - (terms.length - 1) * 12 + orderedBonus),
  );

  return Math.max(phraseScore, tokenScore);
}

function evaluateMathExpression(expression) {
  const compactExpression = expression.replace(/\s+/g, "");
  const tokens =
    compactExpression.match(/(?:\d+(?:\.\d*)?|\.\d+|[()+\-*/%^])/g) ?? [];

  if (tokens.join("") !== compactExpression) return null;

  let position = 0;

  const parsePrimary = () => {
    const token = tokens[position];

    if (token === "(") {
      position++;
      const value = parseExpression();
      if (tokens[position] !== ")")
        throw new Error("Missing closing parenthesis");
      position++;
      return value;
    }

    if (token === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
      throw new Error("Expected a number");

    position++;
    return Number(token);
  };

  const parsePower = () => {
    const left = parsePrimary();
    if (tokens[position] !== "^") return left;

    position++;
    return left ** parseUnary();
  };

  const parseUnary = () => {
    const token = tokens[position];
    if (token === "+" || token === "-") {
      position++;
      const value = parseUnary();
      return token === "-" ? -value : value;
    }

    return parsePower();
  };

  const parseTerm = () => {
    let value = parseUnary();

    while (["*", "/", "%"].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = parseUnary();

      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
    }

    return value;
  };

  const parseExpression = () => {
    let value = parseTerm();

    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }

    return value;
  };

  try {
    const result = parseExpression();
    if (position !== tokens.length || !Number.isFinite(result)) return null;
    return Math.round(result * 1e10) / 1e10;
  } catch (_e) {
    return null;
  }
}

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
    this._enabled = true;
    this._searchGeneration = 0;
    this._pendingActivation = null;
    this._resumableSession = null;
    this._activeMonitorIndex = null;
    this._settings = this.getSettings();
    this._rankingHistory = new Map();
    this._loadRankingHistory();
    this._session = new Soup.Session();
    this._clipboard = St.Clipboard.get_default();
    this._clipboardHistory = [];
    this._loadClipboardHistory();

    this._appSystem = Shell.AppSystem.get_default();
    this._appUsage = Shell.AppUsage.get_default();
    this._appSystem.connectObject(
      "installed-changed",
      () => this._refreshAppCache(),
      this,
    );
    this._refreshAppCache();
    this._windowTracker = Shell.WindowTracker.get_default();
    this._windowTracker.connectObject(
      "tracked-windows-changed",
      () => this._refreshCurrentSearch(),
      this,
    );
    this._folderCache = SYSTEM_FOLDERS.map((name) => ({
      type: "file",
      label: name,
      subtitle: "Folder",
      icon: "folder-symbolic",
      uri: Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_home_dir(), name]),
      ).get_uri(),
    }));

    this._container = new St.Widget({
      style_class: "spotlight-container",
      layout_manager: new Clutter.BinLayout(),
      reactive: true,
      can_focus: true,
    });

    this._blurLayer = new St.Widget({
      style_class: "spotlight-blur-layer",
      layout_manager: new Clutter.BinLayout(),
      x_expand: true,
      y_expand: true,
    });
    this._blurSurface = new St.Widget({
      style_class: "spotlight-blur-surface",
      x_expand: true,
      y_expand: true,
      margin_top: 10,
      margin_right: 10,
      margin_bottom: 10,
      margin_left: 10,
    });
    this._blurLayer.add_child(this._blurSurface);
    this._materialLayer = new St.Widget({
      style_class: "spotlight-material",
      x_expand: true,
      y_expand: true,
    });
    this._highlightLayer = new St.Widget({
      style_class: "spotlight-highlight",
      x_expand: true,
      y_expand: true,
    });
    this._contentLayer = new St.BoxLayout({
      style_class: "spotlight-content",
      vertical: true,
      x_expand: true,
      y_expand: true,
    });

    this._container.add_child(this._blurLayer);
    this._container.add_child(this._materialLayer);
    this._container.add_child(this._highlightLayer);
    this._container.add_child(this._contentLayer);
    this._createBackgroundBlur();

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
      hint_text: "Search",
      style_class: "spotlight-entry",
      can_focus: true,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._inputRow.add_child(this._icon);
    this._inputRow.add_child(this._entry);

    this._modeIndicator = new St.BoxLayout({
      style_class: "spotlight-mode-indicator",
      vertical: false,
      reactive: false,
      can_focus: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._modeInner = new St.BoxLayout({
      style_class: "spotlight-mode-inner",
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._modeDot = new St.Widget({
      style_class: "spotlight-mode-dot",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._modeLabel = new St.Label({
      text: "All results",
      style_class: "spotlight-mode-label",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._modeLabel.clutter_text.set_single_line_mode(true);
    this._modeLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    this._modeInner.add_child(this._modeDot);
    this._modeInner.add_child(this._modeLabel);
    this._modeIndicator.add_child(this._modeInner);
    this._inputRow.add_child(this._modeIndicator);
    this._contentLayer.add_child(this._inputRow);

    this._headerDivider = new St.Widget({
      style_class: "spotlight-divider",
      x_expand: true,
    });
    this._contentLayer.add_child(this._headerDivider);

    this._resultsBox = new St.BoxLayout({
      style_class: "spotlight-results-box",
      vertical: true,
      x_expand: true,
    });

    this._statusBox = new St.BoxLayout({
      style_class: "spotlight-status",
      vertical: true,
      x_expand: true,
      y_expand: true,
      visible: false,
    });
    this._statusSpinner = new Spinner(22, {
      animate: false,
      hideOnStop: true,
    });
    this._statusSpinner.add_style_class_name("spotlight-status-icon");
    this._statusSpinner.x_align = Clutter.ActorAlign.CENTER;
    this._statusLabel = new St.Label({
      style_class: "spotlight-status-label",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    this._statusLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    this._statusLabel.clutter_text.set_single_line_mode(true);
    this._statusLabel.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
    this._statusBox.add_child(this._statusSpinner);
    this._statusBox.add_child(this._statusLabel);
    this._resultsBox.add_child(this._statusBox);

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
    this._contentLayer.add_child(this._resultsClip);

    this._footerDivider = new St.Widget({
      style_class: "spotlight-divider spotlight-footer-divider",
      x_expand: true,
    });
    this._contentLayer.add_child(this._footerDivider);

    this._footer = new St.BoxLayout({
      style_class: "spotlight-footer",
      vertical: false,
      x_expand: true,
    });
    this._actionsHint = new St.BoxLayout({
      style_class: "spotlight-actions-hint",
      vertical: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._actionsHint.add_child(
      new St.Label({
        text: ">",
        style_class: "spotlight-footer-key spotlight-actions-key",
      }),
    );
    this._actionsHint.add_child(
      new St.Label({
        text: "Actions",
        style_class: "spotlight-footer-label",
      }),
    );
    this._footer.add_child(this._actionsHint);
    this._footerSpacer = new St.Widget({ x_expand: true });
    this._footer.add_child(this._footerSpacer);

    this._footerHints = new St.BoxLayout({
      style_class: "spotlight-footer-hints",
      vertical: false,
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const createFooterHint = (key, label) => {
      const hint = new St.BoxLayout({
        style_class: "spotlight-footer-hint",
        vertical: false,
        y_align: Clutter.ActorAlign.CENTER,
      });
      hint.add_child(
        new St.Label({ text: key, style_class: "spotlight-footer-key" }),
      );
      hint.add_child(
        new St.Label({ text: label, style_class: "spotlight-footer-label" }),
      );
      this._footerHints.add_child(hint);
      return hint;
    };
    this._navigateHint = createFooterHint("↑↓", "Navigate");
    this._openHint = createFooterHint("↵", "Open");
    this._closeHint = createFooterHint("Esc", "Close");
    this._footer.add_child(this._footerHints);
    this._contentLayer.add_child(this._footer);

    this._entry.clutter_text.connectObject(
      "key-press-event",
      (actor, event) => {
        if (!this._searchOpen) return Clutter.EVENT_PROPAGATE;

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
          } else {
            this._queueFirstResultActivation();
          }
          return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Escape) {
          if (this._entry.get_text().length > 0) {
            this._resetSearch();
          } else {
            this._closeSearch({ preserveSession: false });
          }
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      },
      "text-changed",
      () => this._onTextChanged(),
      this,
    );

    Main.layoutManager.addChrome(this._container);
    this._repositionContainer();

    this._container.set_pivot_point(0.5, 0.5);
    this._container.opacity = 0;
    this._container.scale_x = OPEN_SCALE;
    this._container.scale_y = OPEN_SCALE;
    this._container.translation_y = OPEN_TRANSLATION_Y;
    this._container.hide();

    this._searchOpen = false;
    this._selectedIndex = -1;
    this._results = [];
    this._resultRows = [];
    this._resultMetadataActors = [];
    this._resultsState = "hidden";
    this._updateModeIndicator("");

    this._shellSettings = St.Settings.get();
    this._shellSettings.connectObject(
      "notify::color-scheme",
      () => this._updateTheme(),
      "notify::shell-color-scheme",
      () => this._updateTheme(),
      this,
    );
    Main.sessionMode.connectObject("updated", () => this._updateTheme(), this);
    St.ThemeContext.get_for_stage(global.stage).connectObject(
      "changed",
      () => {
        this._updateTheme();
        this._repositionContainer();
        this._queueResultsHeightUpdate();
      },
      this,
    );
    Main.layoutManager.connectObject(
      "monitors-changed",
      () => this._onMonitorConfigurationChanged(),
      this._container,
    );
    global.display.connectObject(
      "workareas-changed",
      () => {
        this._repositionContainer();
        this._queueResultsHeightUpdate();
      },
      this._container,
    );
    this._updateTheme();

    this._settings.connectObject(
      "changed::bar-width",
      () => {
        this._repositionContainer();
        this._queueResultsHeightUpdate();
      },
      "changed::bar-position",
      () => this._repositionContainer(),
      "changed::theme-mode",
      () => this._updateTheme(),
      "changed::clipboard-monitor-enabled",
      () => this._startClipboardMonitoring(),
      "changed::clipboard-history-clear-request",
      () => this._clearClipboardHistory(),
      "changed::max-results",
      () => this._refreshCurrentSearch(),
      "changed::adaptive-ranking-enabled",
      () => this._refreshCurrentSearch(),
      "changed::ranking-history",
      () => {
        this._loadRankingHistory();
        this._refreshCurrentSearch();
      },
      this,
    );

    Main.wm.addKeybinding(
      "toggle-shortcut",
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      this._toggleSearch.bind(this),
    );

    this._startClipboardMonitoring();
  }

  disable() {
    this._enabled = false;
    Main.wm.removeKeybinding("toggle-shortcut");
    this._removeSource("_clipboardPollId");
    this._cancelPendingSearch();
    this._removeSource("_selectionScrollTimeoutId");
    this._removeSource("_resultsHeightTimeoutId");

    this._settings?.disconnectObject(this);
    this._appSystem?.disconnectObject(this);
    this._windowTracker?.disconnectObject(this);
    this._entry?.clutter_text.disconnectObject(this);
    this._shellSettings?.disconnectObject(this);
    Main.sessionMode.disconnectObject(this);
    St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
    if (this._container) {
      Main.layoutManager.disconnectObject(this._container);
      global.display.disconnectObject(this._container);
    }

    if (this._clickShield) {
      this._clickShield.disconnectObject(this);
      Main.layoutManager.removeChrome(this._clickShield);
      this._clickShield.destroy();
      this._clickShield = null;
    }

    this._resultsClip?.remove_all_transitions();
    if (this._resultsBox) this._clearResults();

    if (this._blurSurface && this._blurEffect) {
      this._blurSurface.remove_effect(this._blurEffect);
      this._blurEffect = null;
    }

    if (this._container) {
      this._container.remove_all_transitions();
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
    this._modeIndicator = null;
    this._modeInner = null;
    this._modeDot = null;
    this._modeLabel = null;
    this._headerDivider = null;
    this._resultsBox = null;
    this._resultsScroll = null;
    this._resultsClip = null;
    this._statusBox = null;
    this._statusSpinner = null;
    this._statusLabel = null;
    this._footerDivider = null;
    this._footer = null;
    this._actionsHint = null;
    this._footerSpacer = null;
    this._footerHints = null;
    this._navigateHint = null;
    this._openHint = null;
    this._closeHint = null;
    this._contentLayer = null;
    this._highlightLayer = null;
    this._materialLayer = null;
    this._blurSurface = null;
    this._blurLayer = null;
    this._settings = null;
    this._appSystem = null;
    this._appUsage = null;
    this._appCache = null;
    this._windowTracker = null;
    this._folderCache = null;
    this._shellSettings = null;
    this._clipboard = null;
    this._clipboardHistory = null;
    this._rankingHistory?.clear();
    this._rankingHistory = null;
    this._results = null;
    this._resultRows = null;
    this._resultMetadataActors = null;
    this._resultsState = null;
    this._selectedIndex = -1;
    this._pendingActivation = null;
    this._resumableSession = null;
    this._activeMonitorIndex = null;
    this._searchOpen = false;
  }

  _createBackgroundBlur() {
    this._blurEffect = null;

    if (!Shell.BlurEffect || Shell.BlurMode?.BACKGROUND === undefined) {
      this._container.add_style_class_name("no-background-blur");
      return;
    }

    try {
      const scaleFactor =
        St.ThemeContext.get_for_stage(global.stage).scale_factor;
      this._blurEffect = new Shell.BlurEffect({
        mode: Shell.BlurMode.BACKGROUND,
        radius: BACKGROUND_BLUR_RADIUS * scaleFactor,
        brightness: 1.0,
      });
      this._blurSurface.add_effect_with_name(
        "superbar-background-blur",
        this._blurEffect,
      );
    } catch (error) {
      this._blurEffect = null;
      this._container.add_style_class_name("no-background-blur");
      console.warn(`[Superbar] Background blur unavailable: ${error.message}`);
    }
  }

  _removeSource(propertyName) {
    const sourceId = this[propertyName];
    if (!sourceId) return;

    GLib.Source.remove(sourceId);
    this[propertyName] = null;
  }

  _refreshCurrentSearch() {
    if (!this._searchOpen || !this._entry?.get_text().trim()) return;
    this._onTextChanged(true);
  }

  _loadRankingHistory() {
    this._rankingHistory?.clear();
    if (!this._settings || !this._rankingHistory) return;

    try {
      const entries = JSON.parse(
        this._settings.get_string("ranking-history"),
      );
      if (!Array.isArray(entries)) return;

      const now = Date.now();
      entries.slice(0, RANKING_HISTORY_LIMIT).forEach((entry) => {
        if (
          typeof entry?.key !== "string" ||
          !Number.isFinite(entry.count) ||
          !Number.isFinite(entry.lastUsed)
        ) {
          return;
        }

        const age = now - entry.lastUsed;
        if (age < 0 || age > RANKING_HISTORY_MAX_AGE_MS) return;

        this._rankingHistory.set(entry.key, {
          count: Math.max(1, Math.min(1000, Math.floor(entry.count))),
          lastUsed: entry.lastUsed,
        });
      });
    } catch (_e) {
      // Invalid ranking data is ignored and replaced on the next activation.
    }
  }

  _saveRankingHistory() {
    if (!this._settings || !this._rankingHistory) return;

    const entries = [...this._rankingHistory.entries()]
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
      .slice(0, RANKING_HISTORY_LIMIT)
      .map(([key, value]) => ({
        key,
        count: value.count,
        lastUsed: value.lastUsed,
      }));

    this._rankingHistory.clear();
    entries.forEach(({ key, count, lastUsed }) => {
      this._rankingHistory.set(key, { count, lastUsed });
    });

    const serialized = JSON.stringify(entries);
    if (serialized !== this._settings.get_string("ranking-history")) {
      this._settings.set_string("ranking-history", serialized);
    }
  }

  _getResultRankingKey(result) {
    const appIdentity = result.appIdentity ?? result.appId;
    if (result.type === "app" && appIdentity) {
      return `app:${result.appAction ?? "launch"}:${appIdentity}`;
    }
    if (result.type === "window" && appIdentity) {
      return `app:switch:${appIdentity}`;
    }
    if (result.type !== "system") return null;

    const actionId =
      result.systemAction ??
      result.argv?.join("\u001f") ??
      result.label;
    return actionId ? `action:${actionId}` : null;
  }

  _getAdaptiveRankingBoost(result) {
    if (
      !this._settings?.get_boolean("adaptive-ranking-enabled") ||
      !this._rankingHistory
    ) {
      return 0;
    }

    const key = this._getResultRankingKey(result);
    const entry = key ? this._rankingHistory.get(key) : null;
    if (!entry) return 0;

    const age = Math.max(0, Date.now() - entry.lastUsed);
    const recencyBoost =
      50 * Math.max(0, 1 - age / RANKING_HISTORY_MAX_AGE_MS);
    const frequencyBoost = Math.min(40, Math.log2(entry.count + 1) * 12);
    return Math.round(recencyBoost + frequencyBoost);
  }

  _recordResultUsage(result) {
    if (
      !this._settings?.get_boolean("adaptive-ranking-enabled") ||
      !this._rankingHistory
    ) {
      return;
    }

    const key = this._getResultRankingKey(result);
    if (!key) return;

    const previous = this._rankingHistory.get(key);
    this._rankingHistory.set(key, {
      count: Math.min(1000, (previous?.count ?? 0) + 1),
      lastUsed: Date.now(),
    });
    this._saveRankingHistory();
  }

  _isCurrentQuery(text, generation = null) {
    return (
      this._enabled &&
      this._entry?.get_text().trim() === text &&
      (generation === null || generation === this._searchGeneration)
    );
  }

  _cancelPendingSearch() {
    this._removeSource("_searchTimeout");

    this._networkCancellable?.cancel();
    this._networkCancellable = null;

    this._fileSearchCancellable?.cancel();
    this._fileSearchCancellable = null;

    if (this._fileSearchProcess) {
      try {
        this._fileSearchProcess.force_exit();
      } catch (_e) {
        // The process may already have exited.
      }
      this._fileSearchProcess = null;
    }
  }

  _queueFirstResultActivation() {
    const text = this._entry?.get_text().trim();
    if (!text) return;

    this._pendingActivation = {
      text,
      generation: this._searchGeneration,
    };
  }

  _consumePendingActivation() {
    const pending = this._pendingActivation;
    if (!pending) return false;

    this._pendingActivation = null;
    return this._isCurrentQuery(pending.text, pending.generation);
  }

  _hasPendingSearch() {
    return Boolean(
      this._searchTimeout ||
        this._networkCancellable ||
        this._fileSearchCancellable ||
        this._fileSearchProcess,
    );
  }

  _saveResumableSession() {
    const text = this._entry?.get_text() ?? "";
    if (!text.trim()) {
      this._resumableSession = null;
      return false;
    }

    // Expiry is checked lazily on the next open, avoiding another main-loop
    // source that would need lifecycle cleanup.
    this._resumableSession = {
      text,
      closedAt: Date.now(),
      hadPendingSearch: this._hasPendingSearch(),
    };
    return true;
  }

  _takeResumableSession() {
    const session = this._resumableSession;
    this._resumableSession = null;

    if (!session) return null;

    const age = Date.now() - session.closedAt;
    if (
      age < 0 ||
      age > RESUMABLE_SESSION_TTL_MS ||
      this._entry?.get_text() !== session.text
    ) {
      return null;
    }

    return session;
  }

  _suspendSearch() {
    this._searchGeneration += 1;
    this._pendingActivation = null;
    this._cancelPendingSearch();
  }

  // --- Open / Close ---

  _toggleSearch() {
    if (this._searchOpen) {
      this._closeSearch();
    } else {
      this._openSearch();
    }
  }

  _openSearch() {
    if (this._searchOpen) return;

    this._activeMonitorIndex = this._getTargetMonitorIndex();
    this._searchOpen = true;
    const resumableSession = this._takeResumableSession();
    const resumed = resumableSession !== null;

    if (resumed) {
      if (resumableSession.hadPendingSearch || this._results.length === 0) {
        this._onTextChanged(true);
      } else {
        this._updateSearchIcon(this._entry.get_text().trim());
        this._updateSelection();
      }
    } else {
      this._resetSearch();
    }

    this._repositionContainer();
    this._pollClipboard();

    if (this._clickShield) {
      this._clickShield.disconnectObject(this);
      Main.layoutManager.removeChrome(this._clickShield);
      this._clickShield.destroy();
    }

    this._clickShield = new St.Widget({
      reactive: true,
    });
    this._resizeClickShield();
    Main.layoutManager.addChrome(this._clickShield);
    this._container
      .get_parent()
      .set_child_above_sibling(this._container, this._clickShield);
    this._clickShield.connectObject(
      "button-press-event",
      () => {
        this._closeSearch();
        return Clutter.EVENT_STOP;
      },
      this,
    );

    this._container.remove_all_transitions();
    this._container.opacity = 0;
    this._container.scale_x = OPEN_SCALE;
    this._container.scale_y = OPEN_SCALE;
    this._container.translation_y = OPEN_TRANSLATION_Y;
    this._container.show();
    global.stage.set_key_focus(this._entry);
    if (resumed) this._entry.clutter_text.set_selection(0, -1);

    this._container.ease({
      opacity: 255,
      scale_x: 1.0,
      scale_y: 1.0,
      translation_y: 0,
      duration: OPEN_ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
  }

  _closeSearch({ preserveSession = true } = {}) {
    if (!this._searchOpen) return;

    const savedSession = preserveSession && this._saveResumableSession();
    this._searchOpen = false;
    global.stage.set_key_focus(null);
    if (savedSession) {
      this._suspendSearch();
    } else {
      this._resetSearch();
    }

    if (this._clickShield) {
      this._clickShield.disconnectObject(this);
      Main.layoutManager.removeChrome(this._clickShield);
      this._clickShield.destroy();
      this._clickShield = null;
    }

    this._container.remove_all_transitions();
    this._container.ease({
      opacity: 0,
      scale_x: OPEN_SCALE,
      scale_y: OPEN_SCALE,
      duration: 130,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => {
        if (this._searchOpen || !this._container) return;

        this._container.hide();
      },
    });
  }

  _resetSearch() {
    this._searchGeneration += 1;
    this._pendingActivation = null;
    this._resumableSession = null;
    this._cancelPendingSearch();
    this._removeSource("_selectionScrollTimeoutId");

    if (this._entry.get_text().length > 0) {
      this._entry.set_text("");
    } else {
      this._hideResults();
    }
  }

  // --- Search ---

  _onTextChanged(preserveSelection = false) {
    const text = this._entry.get_text().trim();
    const generation = ++this._searchGeneration;

    this._pendingActivation = null;
    this._resumableSession = null;
    this._cancelPendingSearch();
    this._updateSearchIcon(text);

    if (text.length === 0) {
      this._hideResults();
      return;
    }

    if (this._isCurrencyExpression(text)) {
      this._scheduleRemoteSearch(text, generation, (cancellable) =>
        this._fetchCurrency(text, generation, cancellable),
      );
      return;
    }

    if (this._isWeatherQuery(text)) {
      this._scheduleRemoteSearch(text, generation, (cancellable) =>
        this._fetchWeather(text, generation, cancellable),
      );
      return;
    }

    if (/^def(?:ine)?\s+/i.test(text)) {
      this._scheduleRemoteSearch(text, generation, (cancellable) =>
        this._fetchDictionary(text, generation, cancellable),
      );
      return;
    }

    const clipboardQuery = this._parseClipboardQuery(text);
    if (clipboardQuery !== null) {
      this._showResults(
        this._searchClipboardHistory(clipboardQuery),
        preserveSelection,
      );
      return;
    }

    const actionQuery = this._parseActionQuery(text);
    if (actionQuery !== null) {
      this._showResults(
        this._searchSystemCommands(actionQuery),
        preserveSelection,
      );
      return;
    }

    if (this._isMathExpression(text)) {
      const calcResult = this._evaluate(text);
      if (calcResult !== null) {
        this._showResults(
          [
            {
              type: "calc",
              label: `= ${calcResult}`,
              subtitle: "Press Enter to copy",
              icon: "accessories-calculator-symbolic",
              value: String(calcResult),
              answerContext: text,
            },
          ],
          preserveSelection,
        );
        return;
      }
    }

    // Apps, windows, and common folders are cheap and render immediately.
    this._showResults(
      this._buildGenericResults(text),
      preserveSelection,
    );

    // Indexed file search is deferred so typing remains responsive.
    if (text.length < 2) return;

    this._removeSource("_searchTimeout");
    this._searchTimeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      FILE_SEARCH_DELAY_MS,
      () => {
        this._searchTimeout = null;
        if (!this._isCurrentQuery(text, generation))
          return GLib.SOURCE_REMOVE;

        const cancellable = new Gio.Cancellable();
        this._fileSearchCancellable = cancellable;
        this._searchFiles(text, cancellable).then((fileResults) => {
          if (this._fileSearchCancellable === cancellable)
            this._fileSearchCancellable = null;
          if (!this._isCurrentQuery(text, generation)) return;

          this._showResults(
            this._buildGenericResults(text, fileResults),
            true,
          );
        });

        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _isWeatherQuery(text) {
    return /^(?:weather|temp(?:erature)?|forecast|humidity|rain|snow|wind|hot|cold|clima|meteo)\s+/i.test(
      text,
    );
  }

  _scheduleRemoteSearch(text, generation, callback) {
    this._showStatus("loading", "Searching…");

    this._removeSource("_searchTimeout");
    this._searchTimeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      REMOTE_SEARCH_DELAY_MS,
      () => {
        this._searchTimeout = null;
        if (!this._isCurrentQuery(text, generation))
          return GLib.SOURCE_REMOVE;

        const cancellable = new Gio.Cancellable();
        this._networkCancellable = cancellable;
        callback(cancellable).finally(() => {
          if (this._networkCancellable === cancellable)
            this._networkCancellable = null;
        });

        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _updateSearchIcon(text) {
    const mode = this._getQueryMode(text);
    this._icon.icon_name = mode.iconName;
    this._updateModeIndicator(text, mode);
  }

  _getQueryMode(text) {
    if (this._isCurrencyExpression(text)) {
      return { label: "Currency", iconName: "view-refresh-symbolic" };
    }
    if (this._isWeatherQuery(text)) {
      return { label: "Weather", iconName: "weather-clear-symbolic" };
    }
    if (/^def(?:ine)?\s+/i.test(text)) {
      return {
        label: "Dictionary",
        iconName: "accessories-dictionary-symbolic",
      };
    }
    if (this._parseClipboardQuery(text) !== null) {
      return { label: "Clipboard", iconName: "edit-paste-symbolic" };
    }
    if (this._parseActionQuery(text) !== null) {
      return { label: "Actions", iconName: "system-run-symbolic" };
    }
    if (
      this._isMathExpression(text) &&
      this._evaluate(text) !== null
    ) {
      return {
        label: "Calculator",
        iconName: "accessories-calculator-symbolic",
      };
    }

    return { label: "All results", iconName: "system-search-symbolic" };
  }

  _updateModeIndicator(text, mode = null) {
    if (!this._modeLabel) return;

    this._modeLabel.text = (mode ?? this._getQueryMode(text)).label;
  }

  _buildGenericResults(text, fileResults = []) {
    const folderMatches = this._folderCache
      .map((folder) => {
        const matchScore = this._scoreSearchMatch(folder.label, text);
        return {
          ...folder,
          _source: "folder",
          _matchScore: matchScore,
        };
      })
      .filter((folder) => folder._matchScore >= 0);

    const matchedFileResults = fileResults
      .map((result) => {
        const labelScore = this._scoreSearchMatch(result.label, text);
        const subtitleScore = this._scoreSearchMatch(
          result.subtitle ?? "",
          text,
        );
        return {
          ...result,
          _source: "file",
          _matchScore: Math.max(
            labelScore,
            subtitleScore < 0 ? -1 : subtitleScore - 120,
          ),
        };
      })
      .filter((result) => result._matchScore >= 0);

    const localResults = this._dedupeResults(
      this._rankGenericResults(
        [
          ...this._searchApps(text),
          ...this._searchWindows(text),
          ...folderMatches,
          ...matchedFileResults,
        ],
      ),
    );
    const maxResults = this._settings.get_int("max-results");
    const webResult = {
      type: "web",
      label: text,
      subtitle: "Search the web",
      icon: "web-browser-symbolic",
      query: text,
    };
    const strongLocalResults = [];
    const weakLocalResults = [];

    for (const result of localResults) {
      const relevance = result._matchScore ?? -1;
      delete result._matchScore;

      // Hide results that only matched weakly (e.g. a scattered subsequence
      // buried in an app's description) so unrelated entries don't appear.
      if (relevance < MINIMUM_LOCAL_MATCH_SCORE) continue;

      const matchScore = Math.max(
        this._scoreSearchMatch(result.label ?? "", text),
        this._scoreSearchMatch(result.subtitle ?? "", text),
      );

      if (matchScore >= STRONG_LOCAL_MATCH_SCORE) {
        strongLocalResults.push(result);
      } else {
        weakLocalResults.push(result);
      }
    }

    return [
      ...strongLocalResults.slice(0, Math.max(0, maxResults - 1)),
      webResult,
      ...weakLocalResults,
    ].slice(0, maxResults);
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
        if (!this._enabled || !success) return;
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
      const historyPath = this._getClipboardHistoryPath();
      GLib.file_set_contents(
        historyPath,
        JSON.stringify(this._clipboardHistory),
      );
      GLib.chmod(historyPath, 0o600);
    } catch (_e) {
      // save errors are non-fatal; silently ignore
    }
  }

  _clearClipboardHistory() {
    this._clipboardHistory = [];
    this._saveClipboardHistory();

    if (!this._searchOpen) return;

    const query = this._parseClipboardQuery(this._entry.get_text().trim());
    if (query !== null) this._showResults([]);
  }

  _startClipboardMonitoring() {
    this._removeSource("_clipboardPollId");
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
      if (!this._enabled) return;
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

    if (this._searchOpen) {
      const query = this._parseClipboardQuery(this._entry.get_text().trim());
      if (query !== null) {
        this._showResults(this._searchClipboardHistory(query), true);
      }
    }
  }

  _scoreSearchMatch(text, query) {
    return scoreSearchMatch(text, query);
  }

  _rankResultsByQuery(
    results,
    query,
    textSelector = (result) => result.label ?? "",
  ) {
    return results
      .map((result, index) => ({
        score: this._scoreSearchMatch(textSelector(result), query),
        result,
        index,
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.result);
  }

  _rankGenericResults(results) {
    const rankedResults = results.map((result, index) => ({
      result,
      index,
      score:
        result._matchScore +
        (SOURCE_RANK_BONUS[result._source] ?? 0) +
        (result._contextBoost ?? 0) +
        this._getAdaptiveRankingBoost(result),
    }));
    const lowestWindowScoreByApp = new Map();

    for (const entry of rankedResults) {
      if (entry.result.type !== "window") continue;

      const identity = entry.result.appIdentity ?? entry.result.appId;
      if (!identity) continue;

      const currentScore = lowestWindowScoreByApp.get(identity);
      if (currentScore === undefined || entry.score < currentScore) {
        lowestWindowScoreByApp.set(identity, entry.score);
      }
    }

    for (const entry of rankedResults) {
      if (
        entry.result.type !== "app" ||
        entry.result.appAction !== "new-window"
      ) {
        continue;
      }

      const identity = entry.result.appIdentity ?? entry.result.appId;
      const lowestWindowScore = lowestWindowScoreByApp.get(identity);
      if (lowestWindowScore !== undefined) {
        entry.score = Math.min(entry.score, lowestWindowScore - 1);
      }
    }

    return rankedResults
      .sort((a, b) => {
        const scoreDifference = b.score - a.score;
        if (scoreDifference !== 0) return scoreDifference;

        if (
          a.result.type === "app" &&
          b.result.type === "app" &&
          a.result.appId &&
          b.result.appId
        ) {
          const usageOrder = this._appUsage.compare(
            a.result.appId,
            b.result.appId,
          );
          if (usageOrder !== 0) return usageOrder;
        }

        const matchDifference =
          b.result._matchScore - a.result._matchScore;
        return matchDifference || a.index - b.index;
      })
      .map(({ result }) => {
        const publicResult = { ...result };
        delete publicResult._source;
        delete publicResult._contextBoost;
        // _matchScore is kept so _buildGenericResults can apply a relevance
        // floor; it is stripped there once the results are partitioned.
        return publicResult;
      });
  }

  _searchClipboardHistory(query) {
    return this._rankResultsByQuery(
      this._clipboardHistory.map((entry) => ({
        type: "clipboard",
        label: entry.preview ?? entry.text.replace(/\s+/g, " ").slice(0, 80),
        subtitle: "Clipboard history",
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

  _refreshAppCache() {
    this._appCache = this._appSystem
      .get_installed()
      .filter(
        (appInfo) =>
          typeof appInfo.should_show !== "function" || appInfo.should_show(),
      )
      .map((appInfo) => {
        const label =
          appInfo.get_display_name?.() ?? appInfo.get_name() ?? "Application";
        const genericName = appInfo.get_generic_name?.()?.trim() ?? "";
        const description = appInfo.get_description?.()?.trim() ?? "";
        const keywords = appInfo.get_keywords?.() ?? [];
        const appId = appInfo.get_id();
        const appIdentity = this._getAppIdentity(
          appInfo,
          appId,
          label,
        );

        return {
          type: "app",
          label,
          gicon: appInfo.get_icon(),
          appId,
          appIdentity,
          classKeys: this._getAppWindowClassKeys(appInfo, appId),
          searchText: [
            label,
            appInfo.get_name?.(),
            genericName,
            description,
            ...keywords,
            appId,
          ]
            .filter(Boolean)
            .join(" "),
        };
      })
      .filter((app) => Boolean(app.appId));
  }

  _getAppIdentity(appInfo, fallbackId = "", fallbackName = "") {
    const name =
      appInfo?.get_display_name?.() ??
      appInfo?.get_name?.() ??
      fallbackName;
    const commandline =
      appInfo?.get_commandline?.() ??
      appInfo?.get_executable?.() ??
      "";
    const startupWmClass = appInfo?.get_startup_wm_class?.() ?? "";
    const normalizedName = normalizeSearchText(name);
    const normalizedCommandline = normalizeSearchText(commandline);
    const normalizedWmClass = normalizeSearchText(startupWmClass);

    if (normalizedCommandline || normalizedWmClass) {
      return [
        normalizedName,
        normalizedCommandline,
        normalizedWmClass,
      ].join("\u001f");
    }

    return fallbackId || normalizedName;
  }

  _getShellAppIdentity(app) {
    if (!app) return "";

    return this._getAppIdentity(
      app.get_app_info?.(),
      app.get_id?.() ?? "",
      app.get_name?.() ?? "",
    );
  }

  // Candidate WM_CLASS keys for an installed app, used to match open windows
  // directly when GNOME fails to associate them with the app's ShellApp
  // (common for Chrome/Chromium/Electron apps and PWAs).
  _getAppWindowClassKeys(appInfo, appId = "") {
    const keys = new Set();
    const add = (value) => {
      const normalized = normalizeSearchText(value ?? "");
      if (normalized) keys.add(normalized);
    };

    add(appInfo?.get_startup_wm_class?.());

    const base = String(appId).replace(/\.desktop$/, "");
    add(base);
    add(base.split(".").pop());

    const executable = appInfo?.get_executable?.() ?? "";
    if (executable) add(executable.split("/").pop());

    return [...keys];
  }

  _getWindowClassKeys(window) {
    const keys = [];
    const push = (value) => {
      const normalized = normalizeSearchText(value ?? "");
      if (normalized) keys.push(normalized);
    };

    push(window.get_wm_class?.());
    push(window.get_wm_class_instance?.());

    return keys;
  }

  _getShellAppSearchScores(text) {
    const scores = new Map();

    try {
      const matchGroups = Shell.AppSystem.search(text) ?? [];
      matchGroups.forEach((group, groupIndex) => {
        group.forEach((appId) => {
          scores.set(appId, 940 - groupIndex * 90);
        });
      });
    } catch (_e) {
      // Fall back to Superbar's own matcher if Shell search is unavailable.
    }

    return scores;
  }

  _searchApps(text) {
    const activeWorkspace = global.workspace_manager.get_active_workspace();
    const targetMonitor =
      this._activeMonitorIndex ?? this._getTargetMonitorIndex();
    const shellSearchScores = this._getShellAppSearchScores(text);
    const runningAppsByIdentity = new Map();
    // MRU-ordered so the first matched window is the most recently used.
    const orderedWindows = global.display.get_tab_list(
      Meta.TabList.NORMAL_ALL,
      null,
    );
    const searchableWindows = new Set(orderedWindows);
    const windowsByClass = new Map();
    for (const window of orderedWindows) {
      for (const key of this._getWindowClassKeys(window)) {
        const bucket = windowsByClass.get(key);
        if (bucket) bucket.push(window);
        else windowsByClass.set(key, [window]);
      }
    }

    for (const runningApp of this._appSystem.get_running?.() ?? []) {
      const identity = this._getShellAppIdentity(runningApp);
      if (!identity) continue;

      const existing = runningAppsByIdentity.get(identity);
      if (
        !existing ||
        runningApp.get_windows().length > existing.get_windows().length
      ) {
        runningAppsByIdentity.set(identity, runningApp);
      }
    }

    return (this._appCache ?? []).flatMap((app) => {
      const labelScore = this._scoreSearchMatch(app.label, text);
      const metadataScore = this._scoreSearchMatch(app.searchText, text);
      const matchScore = Math.max(
        labelScore,
        metadataScore < 0 ? -1 : metadataScore - 80,
        shellSearchScores.get(app.appId) ?? -1,
      );
      if (matchScore < 0) return [];

      const shellApp = this._appSystem.lookup_app(app.appId);
      const equivalentRunningApp = runningAppsByIdentity.get(
        app.appIdentity,
      );
      const actionApp =
        shellApp?.get_windows().length > 0
          ? shellApp
          : equivalentRunningApp ?? shellApp;

      // Start with the windows GNOME associates with the app, then add any
      // whose WM_CLASS matches — this recovers windows for apps GNOME didn't
      // link to their .desktop file (e.g. Chrome). Re-ordered by MRU.
      const matchedWindows = new Set(
        (actionApp?.get_windows() ?? []).filter((window) =>
          searchableWindows.has(window),
        ),
      );
      for (const key of app.classKeys ?? []) {
        for (const window of windowsByClass.get(key) ?? []) {
          matchedWindows.add(window);
        }
      }
      const appWindows = orderedWindows.filter((window) =>
        matchedWindows.has(window),
      );
      let contextBoost = 0;

      if (appWindows.length > 0) contextBoost += 45;
      if (actionApp?.is_on_workspace(activeWorkspace)) contextBoost += 20;
      if (
        appWindows.some(
          (window) => window.get_monitor() === targetMonitor,
        )
      ) {
        contextBoost += 15;
      }

      const results = [];
      if (appWindows.length > 0) {
        results.push({
          type: "app",
          label: app.label,
          subtitle: "Switch to active window",
          gicon: app.gicon,
          appId: app.appId,
          appIdentity: app.appIdentity,
          appAction: "activate",
          shellApp: actionApp,
          activateWindow: appWindows[0] ?? null,
          _source: "app",
          _matchScore: matchScore,
          _contextBoost: contextBoost,
        });

        if (actionApp?.can_open_new_window?.()) {
          results.push({
            type: "app",
            label: `New ${app.label} Window`,
            subtitle: "Open another window",
            gicon: app.gicon,
            appId: app.appId,
            appIdentity: app.appIdentity,
            appAction: "new-window",
            shellApp: actionApp,
            _source: "appAction",
            _matchScore: matchScore,
            _contextBoost: 0,
          });
        }

        return results;
      }

      return [{
        type: app.type,
        label: app.label,
        subtitle: "Open application",
        gicon: app.gicon,
        appId: app.appId,
        appIdentity: app.appIdentity,
        appAction: "launch",
        shellApp: actionApp,
        _source: "app",
        _matchScore: matchScore,
        _contextBoost: contextBoost,
      }];
    });
  }

  _dedupeResults(results) {
    const seenUris = new Set();
    const seenAppActions = new Set();

    return results.filter((result) => {
      if (result.type === "app") {
        const identity = result.appIdentity ?? result.appId;
        const key = `${identity}\u001f${result.appAction ?? "launch"}`;
        if (seenAppActions.has(key)) return false;

        seenAppActions.add(key);
        return true;
      }

      if (!result.uri) return true;
      if (seenUris.has(result.uri)) return false;

      seenUris.add(result.uri);
      return true;
    });
  }

  _searchWindows(text) {
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
    const activeWorkspace = global.workspace_manager.get_active_workspace();
    const targetMonitor =
      this._activeMonitorIndex ?? this._getTargetMonitorIndex();
    const windowData = windows.map((window, mruIndex) => {
      const title = window.get_title()?.trim() ?? "";
      const app = this._windowTracker.get_window_app(window);
      const appName = app?.get_name()?.trim() ?? "";
      const appId = app?.get_id() ?? null;
      const appIdentity = this._getShellAppIdentity(app);
      const label = title || appName || "Untitled window";
      const appKey =
        appIdentity || appId || normalizeSearchText(appName) || "unknown";

      return {
        window,
        mruIndex,
        title,
        app,
        appName,
        appId,
        appIdentity,
        label,
        duplicateKey: `${appKey}\u001f${normalizeSearchText(label)}`,
      };
    });
    const duplicateCounts = new Map();
    const duplicateIndexes = new Map();
    const launchableAppIdentities = new Set(
      (this._appCache ?? []).map((app) => app.appIdentity),
    );

    for (const data of windowData) {
      duplicateCounts.set(
        data.duplicateKey,
        (duplicateCounts.get(data.duplicateKey) ?? 0) + 1,
      );
    }

    return windowData
      .map((data) => {
        const {
          window,
          mruIndex,
          title,
          app,
          appName,
          appId,
          appIdentity,
          label,
          duplicateKey,
        } = data;
        const titleScore = this._scoreSearchMatch(title, text);
        const appScore = this._scoreSearchMatch(appName, text);
        let contextBoost = Math.max(0, 24 - mruIndex * 3);

        if (appScore >= 0 && launchableAppIdentities.has(appIdentity)) {
          return null;
        }

        if (window.get_workspace() === activeWorkspace) contextBoost += 45;
        if (window.get_monitor() === targetMonitor) contextBoost += 20;

        const locationParts = [];
        const workspace = window.get_workspace();
        if (workspace === activeWorkspace) {
          locationParts.push("Current workspace");
        } else if (workspace) {
          locationParts.push(`Workspace ${workspace.index() + 1}`);
        }

        if ((Main.layoutManager.monitors?.length ?? 0) > 1) {
          locationParts.push(`Monitor ${window.get_monitor() + 1}`);
        }

        const duplicateCount = duplicateCounts.get(duplicateKey) ?? 1;
        if (duplicateCount > 1) {
          const duplicateIndex =
            (duplicateIndexes.get(duplicateKey) ?? 0) + 1;
          duplicateIndexes.set(duplicateKey, duplicateIndex);
          locationParts.push(
            `Window ${duplicateIndex} of ${duplicateCount}`,
          );
        }

        const repeatsAppName =
          normalizeSearchText(label) === normalizeSearchText(appName);
        const actionLabel =
          appName && !repeatsAppName
            ? `Switch to ${appName}`
            : "Switch to open window";
        const subtitle = [actionLabel, ...locationParts].join(" · ");

        return {
          type: "window",
          label,
          subtitle,
          gicon: app?.get_icon?.() ?? null,
          icon: "go-jump-symbolic",
          window,
          appId,
          appIdentity,
          _source: "window",
          _matchScore: Math.max(
            titleScore,
            appScore < 0 ? -1 : appScore - 35,
          ),
          _contextBoost: contextBoost,
        };
      })
      .filter((window) => window && window._matchScore >= 0);
  }

  _searchSystemCommands(text) {
    const query = text.toLowerCase();
    const systemActions = SystemActions.getDefault();
    const commands = [
      {
        label: "Shut Down",
        systemAction: "power-off",
        available: systemActions.canPowerOff,
        icon: "system-shutdown-symbolic",
        keywords: ["poweroff", "power off", "shutdown", "off"],
      },
      {
        label: "Restart",
        systemAction: "restart",
        available: systemActions.canRestart,
        icon: "view-refresh-symbolic",
        keywords: ["reboot", "reload", "restart"],
      },
      {
        label: "Log Out",
        systemAction: "logout",
        available: systemActions.canLogout,
        icon: "system-log-out-symbolic",
        keywords: ["logout", "sign out", "log out"],
      },
      {
        label: "Lock Screen",
        systemAction: "lock-screen",
        available: systemActions.canLockScreen,
        icon: "system-lock-screen-symbolic",
        keywords: ["lock", "screen lock"],
      },
      {
        label: "Sleep",
        systemAction: "suspend",
        available: systemActions.canSuspend,
        icon: "weather-clear-night-symbolic",
        keywords: ["suspend", "sleep"],
      },
      {
        label: "Open Settings",
        argv: ["gnome-control-center"],
        icon: "org.gnome.Settings-symbolic",
        keywords: ["settings", "preferences", "control center"],
      },
      {
        label: "Wi-Fi Settings",
        argv: ["gnome-control-center", "wifi"],
        icon: "network-wireless-signal-excellent-symbolic",
        keywords: ["wifi", "wi-fi", "wireless", "network"],
      },
      {
        label: "Bluetooth Settings",
        argv: ["gnome-control-center", "bluetooth"],
        icon: "bluetooth-active-symbolic",
        keywords: ["bluetooth", "bt"],
      },
      {
        label: "Display Settings",
        argv: ["gnome-control-center", "display"],
        icon: "video-display-symbolic",
        keywords: ["display", "monitor", "screen settings"],
      },
      {
        label: "Sound Settings",
        argv: ["gnome-control-center", "sound"],
        icon: "audio-volume-high-symbolic",
        keywords: ["sound", "audio", "volume settings"],
      },
      {
        label: "Open Downloads",
        uri: Gio.File.new_for_path(
          GLib.build_filenamev([GLib.get_home_dir(), "Downloads"]),
        ).get_uri(),
        icon: "folder-download-symbolic",
        keywords: ["downloads", "download folder"],
      },
      {
        label: "Open Documents",
        uri: Gio.File.new_for_path(
          GLib.build_filenamev([GLib.get_home_dir(), "Documents"]),
        ).get_uri(),
        icon: "folder-documents-symbolic",
        keywords: ["documents", "docs", "document folder"],
      },
      {
        label: "Open Pictures",
        uri: Gio.File.new_for_path(
          GLib.build_filenamev([GLib.get_home_dir(), "Pictures"]),
        ).get_uri(),
        icon: "folder-pictures-symbolic",
        keywords: ["pictures", "photos", "images"],
      },
      {
        label: "Take Screenshot",
        systemAction: "screenshot",
        icon: "applets-screenshooter-symbolic",
        keywords: ["screenshot", "screen capture", "capture"],
      },
    ];
    return commands
      .filter((command) => command.available ?? true)
      .map((c, index) => {
        const labelScore = this._scoreSearchMatch(c.label, query);
        const keywordScore = this._scoreSearchMatch(
          (c.keywords ?? []).join(" "),
          query,
        );
        const result = {
          type: "system",
          label: c.label,
          subtitle: "System action",
          icon: c.icon,
          systemAction: c.systemAction,
          argv: c.argv,
          uri: c.uri,
        };
        return {
          matchScore: Math.max(
            labelScore,
            keywordScore < 0 ? -1 : keywordScore - 60,
          ),
          result,
          index,
        };
      })
      .filter((entry) => entry.matchScore >= 0)
      .map((entry) => ({
        ...entry,
        score:
          entry.matchScore + this._getAdaptiveRankingBoost(entry.result),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ result }) => result);
  }

  _runSystemAction(result) {
    try {
      if (result.systemAction) {
        const systemActions = SystemActions.getDefault();

        switch (result.systemAction) {
          case "power-off":
            systemActions.activatePowerOff();
            break;
          case "restart":
            systemActions.activateRestart();
            break;
          case "logout":
            systemActions.activateLogout();
            break;
          case "lock-screen":
            systemActions.activateLockScreen();
            break;
          case "suspend":
            systemActions.activateSuspend();
            break;
          case "screenshot":
            Screenshot.showScreenshotUI();
            break;
        }
        return;
      }

      if (result.uri) {
        Gio.AppInfo.launch_default_for_uri(result.uri, null);
        return;
      }

      if (result.argv) {
        const executable = GLib.find_program_in_path(result.argv[0]);
        if (!executable) return;

        Gio.Subprocess.new(
          [executable, ...result.argv.slice(1)],
          Gio.SubprocessFlags.NONE,
        );
      }
    } catch (e) {
      console.error(`[Superbar] Action failed (${result.label}): ${e.message}`);
    }
  }

  async _searchFiles(text, cancellable = null) {
    return new Promise((resolve) => {
      try {
        const binary =
          GLib.find_program_in_path("localsearch") ??
          GLib.find_program_in_path("tracker3");
        if (!binary) {
          resolve([]);
          return;
        }

        const proc = new Gio.Subprocess({
          // Each value is a distinct argument; user input is never shell code.
          argv: [binary, "search", "--limit=6", text],
          flags:
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        this._fileSearchProcess = proc;
        proc.init(null);
        proc.communicate_utf8_async(null, cancellable, (proc, res) => {
          try {
            const [, stdout] = proc.communicate_utf8_finish(res);
            if (!stdout) return resolve([]);

            const ansiRegex =
              /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
            const lines = stdout
              .replace(ansiRegex, "")
              .split("\n")
              .filter((l) => l.includes("file://"));

            const fileResults = lines.flatMap((line) => {
              try {
                const uri = line.trim().split(/\s+/)[0];
                const file = Gio.File.new_for_uri(uri);
                const fileInfo = file.query_info(
                  "standard::symbolic-icon,standard::type",
                  Gio.FileQueryInfoFlags.NONE,
                  null,
                );
                const parentPath = file.get_parent()?.get_path() ?? "";
                const homePath = GLib.get_home_dir();
                const displayParent = parentPath.startsWith(homePath)
                  ? `~${parentPath.slice(homePath.length)}`
                  : parentPath;
                const kind =
                  fileInfo.get_file_type() === Gio.FileType.DIRECTORY
                    ? "Folder"
                    : "File";

                return [
                  {
                    type: "file",
                    label: file.get_basename() ?? uri,
                    subtitle: displayParent
                      ? `${kind} · ${displayParent}`
                      : kind,
                    gicon: fileInfo.get_symbolic_icon(),
                    uri,
                  },
                ];
              } catch (_e) {
                return [];
              }
            });
            resolve(fileResults);
          } catch (_e) {
            resolve([]);
          } finally {
            if (this._fileSearchProcess === proc)
              this._fileSearchProcess = null;
          }
        });
      } catch (_e) {
        this._fileSearchProcess = null;
        resolve([]);
      }
    });
  }

  // --- Web Fetches ---

  async _fetchWeather(text, generation = null, cancellable = null) {
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
        cancellable,
      );

      if (!this._isCurrentQuery(text, generation)) return;

      const geoData = JSON.parse(new TextDecoder().decode(geoBytes.get_data()));
      if (!geoData.results?.length) {
        this._showNoResults(text);
        return;
      }

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
        cancellable,
      );

      if (!this._isCurrentQuery(text, generation)) return;

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
    } catch (_e) {
      if (
        this._isCurrentQuery(text, generation) &&
        !cancellable?.is_cancelled()
      ) {
        this._showStatus("error", "Weather is unavailable right now");
      }
    }
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

  async _fetchDictionary(text, generation = null, cancellable = null) {
    const match = text.trim().match(/^def(?:ine)?\s+(.+)$/i);
    if (!match) return;
    const word = match[1];

    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const bytes = await this._session.send_and_read_async(
        Soup.Message.new("GET", url),
        GLib.PRIORITY_DEFAULT,
        cancellable,
      );

      if (!this._isCurrentQuery(text, generation)) return;

      const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
      if (data?.length > 0) {
        const meaning = data[0].meanings[0].definitions[0].definition;
        this._showResults([
          {
            type: "web",
            label: `${word}: ${meaning}`,
            subtitle: "Dictionary definition",
            icon: "accessories-dictionary-symbolic",
            query: word,
            metadata: "Definition",
          },
        ]);
      } else {
        this._showNoResults(text);
      }
    } catch (_e) {
      if (
        this._isCurrentQuery(text, generation) &&
        !cancellable?.is_cancelled()
      ) {
        this._showStatus("error", "Dictionary is unavailable right now");
      }
    }
  }

  _isCurrencyExpression(text) {
    return /^\d+(\.\d+)?\s*[a-zA-Z]+\s+to\s+[a-zA-Z]+$/i.test(text.trim());
  }

  async _fetchCurrency(text, generation = null, cancellable = null) {
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

    if (from.length !== 3 || to.length !== 3) {
      if (this._isCurrentQuery(text, generation)) this._showNoResults(text);
      return;
    }

    try {
      const url = `https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`;
      const bytes = await this._session.send_and_read_async(
        Soup.Message.new("GET", url),
        GLib.PRIORITY_DEFAULT,
        cancellable,
      );

      if (!this._isCurrentQuery(text, generation)) return;

      const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
      if (data.rates?.[to] !== undefined) {
        this._showResults([
          {
            type: "calc",
            label: `${data.rates[to]} ${to}`,
            subtitle: "Press Enter to copy",
            icon: "view-refresh-symbolic",
            value: String(data.rates[to]),
            answerContext: text,
          },
        ]);
      } else {
        this._showNoResults(text);
      }
    } catch (_e) {
      if (
        this._isCurrentQuery(text, generation) &&
        !cancellable?.is_cancelled()
      ) {
        this._showStatus("error", "Currency conversion is unavailable");
      }
    }
  }

  // --- Math ---

  _isMathExpression(text) {
    return (
      /^[\d\s\+\-\*\/\(\)\.\%\^]+$/.test(text) && /[\+\-\*\/\%\^]/.test(text)
    );
  }

  _evaluate(expr) {
    return evaluateMathExpression(expr);
  }

  // --- Results ---

  _resultsMatch(first, second) {
    if (!first || !second || first.type !== second.type) return false;

    switch (first.type) {
      case "app":
        return (
          (first.appIdentity ?? first.appId) ===
            (second.appIdentity ?? second.appId) &&
          (first.appAction ?? "launch") ===
            (second.appAction ?? "launch")
        );
      case "window":
        return first.window === second.window;
      case "file":
      case "weather":
        return first.uri === second.uri;
      case "web":
        return first.query === second.query && first.label === second.label;
      case "clipboard":
      case "calc":
        return first.value === second.value;
      case "system":
        return (
          first.systemAction === second.systemAction &&
          first.label === second.label
        );
      default:
        return first.label === second.label;
    }
  }

  _showResults(results, preserveSelection = false) {
    const selectedResult =
      preserveSelection && this._selectedIndex >= 0
        ? this._results[this._selectedIndex]
        : null;

    if (results.length === 0) {
      this._showNoResults(this._entry?.get_text().trim() ?? "");
      return;
    }

    this._resultsState = "rows";
    this._footerDivider.show();
    this._results = results;
    this._selectedIndex = selectedResult
      ? results.findIndex((result) =>
          this._resultsMatch(result, selectedResult),
        )
      : -1;

    if (this._consumePendingActivation()) {
      this._activateResult(0);
      return;
    }

    this._prepareResultRows(results.length);

    results.forEach((result, index) => {
      const row = this._resultRows[index];
      row._superbarIndex = index;
      row._superbarType = result.type;
      row.add_style_class_name(`result-${result.type}`);

      if (result.type === "weather") {
        row.add_style_class_name("weather-card");

        const infoBox = new St.BoxLayout({
          vertical: true,
          x_expand: true,
          y_align: Clutter.ActorAlign.CENTER,
        });
        const cityLabel = new St.Label({
          text: result.city,
          style_class: "weather-city",
          x_expand: true,
        });
        cityLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        cityLabel.clutter_text.set_single_line_mode(true);
        const descriptionLabel = new St.Label({
          text: result.description,
          style_class: "weather-desc",
          x_expand: true,
        });
        descriptionLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        descriptionLabel.clutter_text.set_single_line_mode(true);
        const detailsLabel = new St.Label({
          text: result.details,
          style_class: "weather-details",
          x_expand: true,
        });
        detailsLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        detailsLabel.clutter_text.set_single_line_mode(true);
        infoBox.add_child(cityLabel);
        infoBox.add_child(descriptionLabel);
        infoBox.add_child(detailsLabel);

        const card = new St.BoxLayout({
          style_class: "spotlight-weather-content",
          vertical: false,
          x_expand: true,
        });
        const weatherIconTile = this._createResultIcon(result);
        weatherIconTile.add_style_class_name("weather-icon-tile");
        card.add_child(weatherIconTile);
        card.add_child(infoBox);
        card.add_child(
          new St.Label({
            text: result.temp,
            style_class: "weather-temp",
            y_align: Clutter.ActorAlign.CENTER,
          }),
        );
        row.set_child(card);
      } else if (result.type === "calc") {
        row.add_style_class_name("answer");

        const answerBox = new St.BoxLayout({
          style_class: "spotlight-answer-content",
          vertical: false,
          x_expand: true,
        });
        answerBox.add_child(this._createResultIcon(result));

        const answerText = new St.BoxLayout({
          vertical: true,
          x_expand: true,
          y_align: Clutter.ActorAlign.CENTER,
          style_class: "spotlight-result-text",
        });
        if (result.answerContext) {
          const contextLabel = new St.Label({
            text: result.answerContext,
            style_class: "spotlight-answer-context",
            x_expand: true,
          });
          contextLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
          contextLabel.clutter_text.set_single_line_mode(true);
          answerText.add_child(contextLabel);
        }
        const answerValueLabel = new St.Label({
          text: result.label,
          style_class: "spotlight-result-label",
          x_expand: true,
        });
        answerValueLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        answerValueLabel.clutter_text.set_single_line_mode(true);
        answerText.add_child(answerValueLabel);
        if (result.subtitle) {
          const answerSubtitleLabel = new St.Label({
            text: result.subtitle,
            style_class: "spotlight-result-subtitle",
            x_expand: true,
          });
          answerSubtitleLabel.clutter_text.set_ellipsize(
            Pango.EllipsizeMode.END,
          );
          answerSubtitleLabel.clutter_text.set_single_line_mode(true);
          answerText.add_child(answerSubtitleLabel);
        }
        answerBox.add_child(answerText);
        row.set_child(answerBox);
      } else {
        const rowBox = new St.BoxLayout({
          style_class: "spotlight-result-row-content",
          vertical: false,
          x_expand: true,
        });
        rowBox.add_child(this._createResultIcon(result));

        const textBox = new St.BoxLayout({
          vertical: true,
          x_expand: true,
          y_align: Clutter.ActorAlign.CENTER,
          style_class: "spotlight-result-text",
        });
        const titleLabel = new St.Label({
          text: result.label,
          style_class: "spotlight-result-label",
          x_expand: true,
        });
        titleLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        titleLabel.clutter_text.set_single_line_mode(true);
        textBox.add_child(titleLabel);

        if (result.subtitle) {
          const subtitleLabel = new St.Label({
            text: result.subtitle,
            style_class: "spotlight-result-subtitle",
            x_expand: true,
          });
          subtitleLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
          subtitleLabel.clutter_text.set_single_line_mode(true);
          textBox.add_child(subtitleLabel);
        }

        rowBox.add_child(textBox);

        const metadata = this._getResultMetadata(result);
        if (metadata) {
          const metadataLabel = new St.Label({
            text: metadata,
            style_class: "spotlight-result-metadata",
            y_align: Clutter.ActorAlign.CENTER,
          });
          metadataLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
          metadataLabel.clutter_text.set_single_line_mode(true);
          this._resultMetadataActors.push(metadataLabel);
          rowBox.add_child(metadataLabel);
        }

        row.set_child(rowBox);
      }
    });

    this._applyResponsiveVisibility();
    this._updateSelection();
    this._updateResultsHeight();
  }

  _prepareResultRows(count) {
    this._removeSource("_selectionScrollTimeoutId");
    this._statusSpinner.stop();
    this._statusBox.hide();
    this._resultMetadataActors = [];

    while (this._resultRows.length > count) {
      const row = this._resultRows.pop();
      row.disconnectObject(this);
      row.destroy();
    }

    while (this._resultRows.length < count) {
      const row = new St.Button({
        style_class: "spotlight-result-row",
        x_expand: true,
        can_focus: false,
      });
      row._superbarIndex = this._resultRows.length;
      row.connectObject(
        "clicked",
        () => this._activateResult(row._superbarIndex),
        this,
      );
      this._resultRows.push(row);
      this._resultsBox.add_child(row);
    }

    this._resultRows.forEach((row) => {
      row.remove_style_class_name("answer");
      row.remove_style_class_name("weather-card");
      row.remove_style_class_name("selected");
      row.remove_style_class_name("inactive-selection");
      if (row._superbarType) {
        row.remove_style_class_name(`result-${row._superbarType}`);
      }

      row.get_child()?.destroy();
      row._superbarType = null;
    });
  }

  _createResultIcon(result) {
    const tile = new St.Widget({
      style_class: "spotlight-result-icon-tile",
      layout_manager: new Clutter.BinLayout(),
      y_align: Clutter.ActorAlign.CENTER,
    });
    const icon = result.gicon
      ? new St.Icon({
          gicon: result.gicon,
          icon_size: 24,
          style_class: "spotlight-result-icon",
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.CENTER,
        })
      : new St.Icon({
          icon_name: result.icon || "system-search-symbolic",
          icon_size: 24,
          style_class: "spotlight-result-icon",
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.CENTER,
        });
    tile.add_child(icon);
    return tile;
  }

  _getResultMetadata(result) {
    if (result.metadata) return result.metadata;

    const labels = {
      app: "App",
      window: "Window",
      file: result.subtitle?.startsWith("Folder") ? "Folder" : "File",
      web: "Web",
      clipboard: "Clipboard",
      system: "Action",
    };
    return labels[result.type] ?? "";
  }

  _showNoResults(query) {
    this._showStatus("empty", `No Results for ‘${query}’`);
  }

  _showStatus(kind, message) {
    this._clearResults();
    this._resultsState = kind;
    this._footerDivider.show();
    this._statusBox.remove_style_class_name("empty");
    this._statusBox.remove_style_class_name("loading");
    this._statusBox.remove_style_class_name("error");
    this._statusBox.add_style_class_name(kind);
    this._statusLabel.text = message;
    this._statusBox.show();
    if (kind === "loading") this._statusSpinner.play();
    else this._statusSpinner.stop();
    this._updateResultsHeight();
  }

  _hideResults() {
    this._clearResults();
    this._resultsState = "hidden";
    this._footerDivider.hide();
    this._setResultsHeight(0);
  }

  _clearResults() {
    this._resultsState = "clearing";
    this._results = [];
    this._selectedIndex = -1;
    this._removeSource("_selectionScrollTimeoutId");
    this._resultRows.forEach((row) => {
      row.disconnectObject(this);
      row.destroy();
    });
    this._resultRows = [];
    this._resultMetadataActors = [];
    this._statusSpinner?.stop();
    this._statusBox?.hide();
  }

  _activateResult(index) {
    const result = this._results[index];
    if (!result) return;

    // Clear the search before focus leaves Superbar. Some actions switch
    // windows or sessions immediately, so cleanup must happen first.
    this._closeSearch({ preserveSession: false });
    this._recordResultUsage(result);

    if (result.type === "app") {
      try {
        const shellApp =
          result.shellApp ??
          Shell.AppSystem.get_default().lookup_app(result.appId);
        if (result.appAction === "new-window") {
          if (!shellApp?.open_new_window) {
            throw new Error("Application cannot open a new window");
          }
          shellApp.open_new_window(-1);
        } else if (result.appAction === "activate" && result.activateWindow) {
          // Raise the matched window directly. shellApp.activate() would open a
          // new instance for apps GNOME hasn't associated with their windows.
          const window = result.activateWindow;
          const timestamp = global.get_current_time();
          const windowApp = this._windowTracker.get_window_app(window);
          if (windowApp?.activate_window) {
            windowApp.activate_window(window, timestamp);
          } else {
            window.get_workspace()?.activate(timestamp);
            window.activate(timestamp);
          }
        } else if (shellApp) {
          shellApp.activate();
        } else {
          const appInfo = GioUnix.DesktopAppInfo.new(result.appId);
          if (appInfo) appInfo.launch([], null);
        }
      } catch (e) {
        console.error(`[Superbar] Failed to launch app: ${e}`);
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
      const timestamp = global.get_current_time();
      const shellApp = this._windowTracker.get_window_app(result.window);

      if (shellApp?.activate_window) {
        shellApp.activate_window(result.window, timestamp);
      } else {
        result.window.get_workspace()?.activate(timestamp);
        result.window.activate(timestamp);
      }
    } else if (result.type === "file") {
      Gio.AppInfo.launch_default_for_uri(result.uri, null);
    }
  }

  _setSelected(index) {
    this._selectedIndex = index;
    this._updateSelection();
  }

  _updateSelection() {
    const rows = this._resultRows;
    rows.forEach((row, i) => {
      row.remove_style_class_name("selected");
      row.remove_style_class_name("inactive-selection");

      if (i === this._selectedIndex) {
        row.add_style_class_name("selected");
      } else if (this._selectedIndex === -1 && i === 0) {
        row.add_style_class_name("inactive-selection");
      }
    });

    if (this._selectedIndex >= 0) {
      this._queueScrollToSelection();
    } else {
      this._removeSource("_selectionScrollTimeoutId");
    }
  }

  _queueScrollToSelection() {
    this._removeSource("_selectionScrollTimeoutId");

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

    const row = this._resultRows[this._selectedIndex];
    if (!row) return;

    ensureActorVisibleInScrollView(this._resultsScroll, row);
  }

  _getResultsMaxHeight() {
    const monitors = Main.layoutManager.monitors ?? [];
    let monitorIndex = this._activeMonitorIndex;
    if (
      !Number.isInteger(monitorIndex) ||
      monitorIndex < 0 ||
      monitorIndex >= monitors.length
    ) {
      monitorIndex = this._getTargetMonitorIndex();
    }

    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    if (!workArea) return 450;

    return Math.max(
      RESULTS_MIN_HEIGHT,
      Math.floor(workArea.height * RESULTS_MAX_HEIGHT_FRACTION),
    );
  }

  _updateResultsHeight(animate = true) {
    if (!this._resultsBox || this._resultsState === "hidden") return;

    this._resultsBox.queue_relayout();
    const preferredWidth = Math.max(
      1,
      this._resultsBox.width,
      this._resultsClip.width,
      this._container.width,
    );
    const [, naturalHeight] =
      this._resultsBox.get_preferred_height(preferredWidth);
    const height = Math.min(
      Math.max(RESULTS_MIN_HEIGHT, naturalHeight),
      this._getResultsMaxHeight(),
    );
    this._setResultsHeight(height, animate);
  }

  _queueResultsHeightUpdate() {
    this._removeSource("_resultsHeightTimeoutId");
    if (this._resultsState === "hidden") return;

    this._resultsHeightTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      0,
      () => {
        this._resultsHeightTimeoutId = null;
        if (this._enabled) this._updateResultsHeight(false);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _setResultsHeight(targetHeight, animate = true) {
    const height = Math.max(0, targetHeight);
    const currentHeight = Math.max(0, this._resultsClip.height);
    const isShrinking = height < currentHeight;
    const shouldAnimate =
      animate &&
      this._searchOpen &&
      currentHeight !== height &&
      (currentHeight === 0 || isShrinking);

    this._resultsClip.remove_all_transitions();
    this._resultsScroll.set_height(height);

    if (!shouldAnimate) {
      this._resultsClip.set_height(height);
      this._repositionContainer();
      return;
    }

    this._resultsClip.ease({
      height,
      duration: isShrinking
        ? RESULTS_COLLAPSE_ANIMATION_MS
        : RESULTS_REVEAL_ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
      onComplete: () => this._repositionContainer(),
    });
  }

  // --- Layout ---

  _getTargetMonitorIndex() {
    const monitors = Main.layoutManager.monitors ?? [];
    if (monitors.length === 0) return 0;

    const candidateIndices = [
      Main.layoutManager.focusIndex,
      global.display.focus_window?.get_monitor(),
      global.display.get_current_monitor(),
      Main.layoutManager.primaryIndex,
    ];

    return (
      candidateIndices.find(
        (index) =>
          Number.isInteger(index) && index >= 0 && index < monitors.length,
      ) ?? 0
    );
  }

  _onMonitorConfigurationChanged() {
    this._activeMonitorIndex = this._searchOpen
      ? this._getTargetMonitorIndex()
      : null;
    this._resizeClickShield();
    this._repositionContainer();
    this._queueResultsHeightUpdate();
  }

  _resizeClickShield() {
    if (!this._clickShield) return;

    this._clickShield.set_position(0, 0);
    this._clickShield.set_size(global.stage.width, global.stage.height);
  }

  _repositionContainer() {
    if (!this._container || !this._settings) return;

    const monitors = Main.layoutManager.monitors ?? [];
    if (monitors.length === 0) return;

    let monitorIndex = this._activeMonitorIndex;
    if (
      !Number.isInteger(monitorIndex) ||
      monitorIndex < 0 ||
      monitorIndex >= monitors.length
    ) {
      monitorIndex = this._getTargetMonitorIndex();
    }
    this._activeMonitorIndex = monitorIndex;

    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    if (!workArea) return;

    const configuredWidth = this._settings.get_int("bar-width");
    const availableWidth = Math.max(
      1,
      workArea.width - MONITOR_EDGE_MARGIN * 2,
    );
    const containerWidth = Math.min(configuredWidth, availableWidth);
    const positionKey = this._settings.get_string("bar-position");
    const fractionMap = { top: 0.12, center: 0.22, bottom: 0.58 };
    const fraction = fractionMap[positionKey] ?? fractionMap.center;

    this._container.set_size(containerWidth, -1);
    this._applyResponsiveVisibility(containerWidth);
    const [, naturalHeight] =
      this._container.get_preferred_height(containerWidth);
    const containerHeight = Math.max(1, naturalHeight);
    const minimumY = workArea.y + MONITOR_EDGE_MARGIN;
    const maximumY = Math.max(
      minimumY,
      workArea.y +
        workArea.height -
        containerHeight -
        MONITOR_EDGE_MARGIN,
    );
    const preferredY = workArea.y + Math.floor(workArea.height * fraction);
    const y = Math.max(minimumY, Math.min(maximumY, preferredY));
    const x =
      workArea.x + Math.floor((workArea.width - containerWidth) / 2);

    this._container.set_position(x, y);
  }

  _applyResponsiveVisibility(width = null) {
    const availableWidth = width ?? this._container?.width ?? 0;
    if (availableWidth <= 0) return;

    if (this._modeIndicator) {
      this._modeIndicator.visible = availableWidth >= 560;
    }
    if (this._navigateHint) {
      this._navigateHint.visible = availableWidth >= 680;
    }
    if (this._openHint) this._openHint.visible = availableWidth >= 440;
    if (this._closeHint) this._closeHint.visible = availableWidth >= 400;

    const showMetadata = availableWidth >= 620;
    this._resultMetadataActors?.forEach((actor) => {
      actor.visible = showMetadata;
    });
  }

  // --- Theme ---

  _updateTheme() {
    const configuredMode = this._settings?.get_string("theme-mode");
    let styleVariant;
    if (configuredMode === "light" || configuredMode === "dark") {
      styleVariant = configuredMode;
    } else {
      // "system" (the default): follow the OS Appearance setting directly.
      // Main.getStyleVariant() reflects the shell chrome, not the system
      // color-scheme, so it can't be trusted for this decision.
      styleVariant =
        St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK
          ? "dark"
          : "light";
    }

    if (styleVariant === "dark") {
      this._container.add_style_class_name("dark-mode");
    } else {
      this._container.remove_style_class_name("dark-mode");
    }

    if (this._blurEffect) {
      this._blurEffect.brightness = styleVariant === "dark" ? 0.78 : 1.0;
      this._blurEffect.radius =
        BACKGROUND_BLUR_RADIUS *
        St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    this._applySystemTextColor(styleVariant);
  }

  _applySystemTextColor(styleVariant) {
    // The shell loads only one stylesheet variant at a time, so its foreground
    // color is only meaningful when that variant matches the bar's. When they
    // differ, fall back to the fixed colors in stylesheet.css.
    if (Main.getStyleVariant() !== styleVariant) {
      this._container.set_style(null);
      this._entry?.set_style(null);
      return;
    }

    const color = Main.uiGroup
      .get_theme_node()
      .get_foreground_color()
      .to_string();

    // Result labels inherit the container's inline color, but the entry's text
    // does not pick up an ancestor's inline color, so it must be set directly.
    this._container.set_style(`color: ${color};`);
    this._entry?.set_style(`color: ${color};`);
  }
}
