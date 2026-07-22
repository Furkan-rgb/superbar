// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import assert from "node:assert/strict";
import test from "node:test";

import {
  flattenProviderResultGroups,
  isSubsearchQuery,
  isSearchProviderEnabled,
  sortSearchProviders,
  tokenizeSearchQuery,
} from "../search-provider-config.js";

test("search queries are split into logical AND terms", () => {
  assert.deepEqual(tokenizeSearchQuery("  color   management "), [
    "color",
    "management",
  ]);
  assert.deepEqual(tokenizeSearchQuery(""), []);
});

test("a query refinement is recognized as a provider subsearch", () => {
  assert.equal(isSubsearchQuery(["disp"], ["display"]), true);
  assert.equal(isSubsearchQuery(["color"], ["color", "profile"]), true);
  assert.equal(isSubsearchQuery(["display"], ["color"]), false);
  assert.equal(isSubsearchQuery([], ["display"]), false);
});

test("provider enablement follows GNOME default and override semantics", () => {
  const regular = { desktopId: "files.desktop", defaultDisabled: false };
  const optIn = { desktopId: "weather.desktop", defaultDisabled: true };

  assert.equal(isSearchProviderEnabled(regular), true);
  assert.equal(
    isSearchProviderEnabled(regular, { disabled: ["files.desktop"] }),
    false,
  );
  assert.equal(isSearchProviderEnabled(optIn), false);
  assert.equal(
    isSearchProviderEnabled(optIn, { enabled: ["weather.desktop"] }),
    true,
  );
  assert.equal(
    isSearchProviderEnabled(regular, { disableExternal: true }),
    false,
  );
});

test("providers honor configured order then sort remaining labels", () => {
  const providers = [
    { desktopId: "weather.desktop", label: "Weather" },
    { desktopId: "files.desktop", label: "Files" },
    { desktopId: "calendar.desktop", label: "Calendar" },
  ];

  assert.deepEqual(
    sortSearchProviders(providers, ["files.desktop"]).map(
      (provider) => provider.desktopId,
    ),
    ["files.desktop", "calendar.desktop", "weather.desktop"],
  );
});

test("provider result groups flatten in provider order", () => {
  const providers = [
    { desktopId: "settings.desktop" },
    { desktopId: "files.desktop" },
  ];
  const groups = new Map([
    ["files.desktop", [{ label: "File" }]],
    ["settings.desktop", [{ label: "Displays" }]],
  ]);

  assert.deepEqual(
    flattenProviderResultGroups(providers, groups).map((result) => result.label),
    ["Displays", "File"],
  );
});
