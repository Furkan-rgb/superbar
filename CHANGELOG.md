# Changelog

All notable changes to Superbar are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by pushing a `v*` tag, which triggers the packaging workflow.

## [Unreleased]

## [1.2.1] - 2026-08-16

### Changed

- Clipboard monitoring is now event-driven instead of polled. The extension
  connects to Mutter's `MetaSelection::owner-changed` signal rather than reading
  the clipboard on a 1.2 second timer, so a copy shows up in history
  immediately and no work happens while the clipboard is idle. Entries copied
  in quick succession are all captured, where the timer previously collapsed
  everything within a tick down to the last value.

## [1.2.0] - 2026-08-16

### Added

- Showcase images are rendered from the real extension instead of a static
  HTML mock, so the README screenshots track the actual UI.

### Fixed

- The toggle shortcut is registered reliably, and conflicts with existing GNOME
  shortcuts are detected, surfaced, and resolvable from preferences.
- Shortcut capture works in the preferences dialog.
- A failed `enable()` tears itself down and restores the previous shortcuts
  exactly, instead of leaving the extension half-initialized.

### Documentation

- README clarifies shortcut usage and expands the feature descriptions.
- Recorded why `shexli` cannot gate the build yet.

## [1.1.1] - 2026-07-22

### Changed

- Simplified icon handling in search results and made the surrounding styles
  consistent.
- The GitHub release step specifies the repository explicitly.

## [1.1.0] - 2026-07-22

### Added

- Results from GNOME application search providers are shown inline.
- Calculator results can be copied straight from the result row.
- Color source settings with GNOME app palette integration.
- A GitHub Actions workflow that packages and releases the extension.

### Fixed

- Result navigation now aligns with the initially highlighted row.

## [1.0.0] - 2026-07-22

Initial public release.

### Added

- Keyboard-driven, system-wide launcher and command bar for GNOME Shell.
- Clipboard history with search, and clipboard search history management.
- Web search with a selectable default search engine.
- Adaptive result ranking and search preferences.
- Weather, dictionary, and currency conversion lookups.
- Appearance settings: light/dark theme mode, adjustable color presets, color
  swatches in preferences, adjustable background opacity, and a liquid-glass
  spotlight style.
- Bottom-positioned results layout and configurable divider visibility.
- Showcase rendering script with a high-resolution render scale option.

[Unreleased]: https://github.com/Furkan-rgb/superbar/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/Furkan-rgb/superbar/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Furkan-rgb/superbar/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Furkan-rgb/superbar/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Furkan-rgb/superbar/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Furkan-rgb/superbar/releases/tag/v1.0.0
