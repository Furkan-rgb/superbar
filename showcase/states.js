/* Keep this file dependency-free: it is loaded by both the browser showcase
 * and the Node screenshot driver. */
globalThis.SUPERBAR_SHOWCASE_STATES = {
  "dark-empty": {
    theme: "dark",
    label: "Empty search",
    query: "",
    placeholder: "Search apps, files, and more…",
    mode: "All results",
    rows: [],
  },
  "light-search": {
    theme: "light",
    label: "Search results",
    query: "terminal",
    mode: "All results",
    rows: [
      {
        type: "app",
        icon: "terminal",
        title: "Terminal",
        subtitle: "Console application",
        metadata: "Application",
        selected: true,
      },
      {
        type: "window",
        icon: "window",
        title: "Terminal — superbar",
        subtitle: "Workspace 1",
        metadata: "Window",
      },
      {
        type: "web",
        icon: "globe",
        title: "Search the web for “terminal”",
        subtitle: "Open in your default browser",
        metadata: "Web",
      },
    ],
  },
  "dark-search": {
    theme: "dark",
    label: "Search results",
    query: "files",
    mode: "All results",
    rows: [
      {
        type: "app",
        icon: "folder",
        title: "Files",
        subtitle: "Access and organize files",
        metadata: "Application",
        selected: true,
      },
      {
        type: "file",
        icon: "download",
        title: "Downloads",
        subtitle: "Folder",
        metadata: "File",
      },
      {
        type: "web",
        icon: "globe",
        title: "Search the web for “files”",
        subtitle: "Open in your default browser",
        metadata: "Web",
      },
    ],
  },
  "dark-bottom-search": {
    theme: "dark",
    position: "bottom",
    label: "Bottom-positioned results",
    query: "files",
    mode: "All results",
    rows: [
      {
        type: "app",
        icon: "folder",
        title: "Files",
        subtitle: "Access and organize files",
        metadata: "Application",
        selected: true,
      },
      {
        type: "file",
        icon: "download",
        title: "Downloads",
        subtitle: "Folder",
        metadata: "File",
      },
      {
        type: "web",
        icon: "globe",
        title: "Search the web for “files”",
        subtitle: "Open in your default browser",
        metadata: "Web",
      },
    ],
  },
  "light-clipboard": {
    theme: "light",
    label: "Clipboard history",
    query: "clip",
    mode: "Clipboard",
    rows: [
      {
        type: "clipboard",
        icon: "clipboard",
        title: "https://extensions.gnome.org",
        subtitle: "Copied 2 minutes ago",
        action: "copy",
        selected: true,
      },
      {
        type: "clipboard",
        icon: "clipboard",
        title: "Superbar makes search feel immediate.",
        subtitle: "Copied 18 minutes ago",
        action: "copy",
      },
      {
        type: "clipboard",
        icon: "clipboard",
        title: "make test",
        subtitle: "Copied yesterday",
        action: "copy",
      },
    ],
  },
  "dark-clipboard-copied": {
    theme: "dark",
    label: "Clipboard copied state",
    query: "clipboard",
    mode: "Clipboard",
    rows: [
      {
        type: "clipboard",
        icon: "clipboard",
        title: "https://extensions.gnome.org",
        subtitle: "Copied 2 minutes ago",
        action: "copied",
        selected: true,
      },
      {
        type: "clipboard",
        icon: "clipboard",
        title: "Superbar makes search feel immediate.",
        subtitle: "Copied 18 minutes ago",
        action: "copy",
      },
      {
        type: "clipboard",
        icon: "clipboard",
        title: "make test",
        subtitle: "Copied yesterday",
        action: "copy",
      },
    ],
  },
  "light-calculator": {
    theme: "light",
    label: "Calculator answer",
    query: "128 * 4.5",
    mode: "Calculator",
    rows: [
      {
        type: "calc",
        icon: "calculator",
        context: "128 × 4.5",
        title: "576",
        subtitle: "Press Enter to copy",
        selected: true,
      },
    ],
  },
  "dark-weather": {
    theme: "dark",
    label: "Weather result",
    query: "weather Amsterdam",
    mode: "Weather",
    rows: [
      {
        type: "weather",
        icon: "weather",
        title: "Amsterdam",
        description: "Partly cloudy",
        details: "Humidity 68%  ·  Wind 14 km/h",
        temperature: "21°",
        selected: true,
      },
    ],
  },
};

if (typeof module !== "undefined") {
  module.exports = globalThis.SUPERBAR_SHOWCASE_STATES;
}
