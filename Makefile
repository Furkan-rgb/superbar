# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Furkan

SHELL := /bin/bash
.DEFAULT_GOAL := help

UUID := superbar@Furkan-rgb.github.io
ARCHIVE := $(UUID).shell-extension.zip
BUILD_DIR ?= build
RENDER_SCALE ?= 2
BUILD_ARCHIVE := $(BUILD_DIR)/$(ARCHIVE)

.PHONY: help check syntax schema lint unit pack verify test install enable disable \
	prefs status nested renders renders-light renders-dark export release clean

help:
	@printf "%-12s %s\n" \
		"make check" "Validate JavaScript and the GSettings schema" \
		"make lint" "Run ESLint when it is installed" \
		"make unit" "Run the appearance logic unit tests" \
		"make pack" "Build the extension ZIP in $(BUILD_DIR)/" \
		"make test" "Run checks, build, and verify the ZIP archive" \
		"make install" "Install the latest local build" \
		"make enable" "Enable Superbar in the current Shell session" \
		"make disable" "Disable Superbar in the current Shell session" \
		"make prefs" "Open Superbar preferences" \
		"make status" "Show the installed extension state" \
		"make nested" "Build, install, and start a fresh nested GNOME Shell" \
		"make renders" "Generate all showcase PNGs" \
		"make renders-light" "Generate light-theme showcase PNGs" \
		"make renders-dark" "Generate dark-theme showcase PNGs" \
		"make export" "Build the release ZIP in $(BUILD_DIR)/; does not install it" \
		"make release" "Alias for make export" \
		"make clean" "Remove generated build files"

check: syntax schema

syntax:
	@node --input-type=module --check < extension.js
	@node --input-type=module --check < prefs.js
	@node --input-type=module --check < appearance.js
	@node --input-type=module --check < app-search.js
	@node --input-type=module --check < search-provider-config.js
	@node --input-type=module --check < keybinding-conflicts.js
	@node --input-type=module --check < gnome-search-providers.js
	@node --input-type=module --check < scripts/smoke-search-providers.js
	@printf "JavaScript syntax is valid.\n"

schema:
	@glib-compile-schemas --strict --dry-run schemas
	@printf "GSettings schema is valid.\n"

lint:
	@if command -v eslint >/dev/null 2>&1; then \
		eslint --no-eslintrc \
			--env es6 \
			--parser-options '{"ecmaVersion":2020,"sourceType":"module"}' \
			--global global:readonly \
			--global console:readonly \
			--global TextDecoder:readonly \
			--rule 'no-undef:error' \
			--rule 'no-unused-vars:error' \
			--rule 'no-dupe-keys:error' \
			--rule 'no-unreachable:error' \
			extension.js prefs.js appearance.js app-search.js \
			search-provider-config.js gnome-search-providers.js \
			keybinding-conflicts.js tests/*.test.js; \
		printf "ESLint checks passed.\n"; \
	else \
		printf "ESLint is not installed; skipping optional lint checks.\n"; \
	fi

unit:
	@node --test tests/*.test.js

pack: check
	@mkdir -p "$(BUILD_DIR)"
	@gnome-extensions pack --force --out-dir="$(BUILD_DIR)" \
		--extra-source=LICENSE --extra-source=appearance.js \
		--extra-source=app-search.js \
		--extra-source=search-provider-config.js \
		--extra-source=gnome-search-providers.js \
		--extra-source=search-engines.js --extra-source=result-selection.js \
		--extra-source=keybinding-conflicts.js .
	@printf "Built %s\n" "$(BUILD_ARCHIVE)"

verify: pack
	@unzip -t "$(BUILD_ARCHIVE)"
	@sha256sum "$(BUILD_ARCHIVE)"

test: lint unit verify

install: verify
	@gnome-extensions install --force "$(BUILD_ARCHIVE)"
	@printf "Installed %s\n" "$(UUID)"

enable:
	@gnome-extensions enable "$(UUID)"

disable:
	@gnome-extensions disable "$(UUID)"

prefs:
	@gnome-extensions prefs "$(UUID)"

status:
	@gnome-extensions info "$(UUID)"

nested: install
	@dbus-run-session gnome-shell --devkit --wayland

renders:
	@node scripts/render-showcase.mjs --scale "$(RENDER_SCALE)"

renders-light:
	@node scripts/render-showcase.mjs --theme light --scale "$(RENDER_SCALE)"

renders-dark:
	@node scripts/render-showcase.mjs --theme dark --scale "$(RENDER_SCALE)"

export: lint verify
	@printf "Exported %s\n" "$(BUILD_ARCHIVE)"

release: export

clean:
	@test -n "$(BUILD_DIR)" && test "$(BUILD_DIR)" != "/"
	@$(RM) -r -- "$(BUILD_DIR)"
	@printf "Removed %s\n" "$(BUILD_DIR)"
