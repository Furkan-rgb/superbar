# Superbar

A launcher and command bar for GNOME Shell, inspired by macOS Spotlight. Press
**Alt+Space** and start typing.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-49%20%7C%2050-blue)
![License](https://img.shields.io/badge/license-GPL--2.0--or--later-green)

---

## Screenshots

|                                                                    |                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| ![Dark empty state](renders/dark-empty.png)                        | ![Light search results](renders/light-search.png)                         |
| ![Dark search results](renders/dark-search.png)                    | ![Dark bottom-positioned results](renders/dark-bottom-search.png)         |
| ![Light clipboard results](renders/light-clipboard.png)            | ![Dark clipboard copied state](renders/dark-clipboard-copied.png)         |
| ![Light calculator result](renders/light-calculator.png)           | ![Dark weather result](renders/dark-weather.png)                          |

---

## Features

| Feature                   | How to use                                                             |
| ------------------------- | ---------------------------------------------------------------------- |
| **App Launcher**          | Type an app name to launch it or focus it if it is already open        |
| **Window Switcher**       | Search window titles, including windows on other workspaces            |
| **File Search**           | Find files in your home directory and common folders                   |
| **Clipboard History**     | Start with `clip`, `clipboard`, or `history`                            |
| **Weather**               | Try `weather Amsterdam`                                                 |
| **Calculator**            | Type an expression such as `2 * (3 + 4)`                               |
| **Currency Converter**    | `100 USD to EUR`                                                       |
| **Dictionary**            | `define word`                                                          |
| **Web Search**            | Unmatched searches can be opened in your browser                       |
| **System Actions**        | Start with `>`, `cmd`, `command`, or `action`                          |
| **Resumable Searches**    | Close and reopen the bar without immediately losing your search        |
| **Adaptive Ranking**      | Apps and actions you choose can move higher in later searches          |
| **Multi-monitor Support** | Opens on the monitor you are currently using                           |
| **Appearance Settings**   | Pick the theme, colors, opacity, width, and screen position             |

---

## Installation

### GNOME Extensions

Superbar has been submitted to extensions.gnome.org and is currently waiting
for review. Until it is approved, it can be installed manually.

[Superbar on extensions.gnome.org](https://extensions.gnome.org/extension/9778/superbar/)

### Manual

```bash
git clone https://github.com/Furkan-rgb/superbar.git \
  ~/.local/share/gnome-shell/extensions/superbar@Furkan-rgb.github.io

glib-compile-schemas ~/.local/share/gnome-shell/extensions/superbar@Furkan-rgb.github.io/schemas/

gnome-extensions enable superbar@Furkan-rgb.github.io
```

Log out and back in if this is the first time installing.

---

## Requirements

- GNOME Shell 49 or 50
- An internet connection for weather, dictionary, and currency features

## Makefile commands

```bash
make help
make test       # validate, build, and verify the ZIP
make unit       # test theme and background selection
make install    # install the latest local build
make nested     # install and start a fresh nested GNOME Shell
make renders    # rebuild the README images
make export     # export the upload-ready ZIP to build/; does not install
```

The generated archive is always named
`superbar@Furkan-rgb.github.io.shell-extension.zip`. `make export` writes it to
the repository's `build/` directory but does not update the installed extension.

## A few UI details

The default light color is a neutral off-white and the dark color is charcoal.
There are a handful of alternatives for both, and the background opacity can be
set from 65% to 100%. It defaults to 90%.

The bar can sit at the top, center, or bottom of the screen. At the bottom, the
results open upward and the footer remains below them. Center is the default.

Search results stay in one list rather than being split into tabs. The small
label beside the search field shows when Superbar has recognized something like
a clipboard, calculator, weather, dictionary, currency, or system-action query.

When working on the Shell UI, use a fresh nested session so an older cached copy
of the extension does not get in the way:

```bash
make nested

# Run this from the repository in the nested desktop:
make enable

# Then press Alt+Space.
```

`make status` shows whether the extension is enabled. Use `make prefs` to open
its settings.

---

## License and credits

Copyright © 2026 Furkan.

Superbar is licensed under GPL-2.0-or-later — see [LICENSE](LICENSE).

Superbar uses GNOME Shell APIs, including clipboard access. Weather data comes
from Open-Meteo (`open-meteo.com`), definitions from Free Dictionary API
(`dictionaryapi.dev`), and exchange rates from Frankfurter
(`frankfurter.app`). These services and clipboard access are also declared in
`metadata.json`.
