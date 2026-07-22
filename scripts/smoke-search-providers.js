// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import Gio from "gi://Gio";

import { GnomeSearchProviderManager } from "../gnome-search-providers.js";

const settings = new Gio.Settings({
  schema_id: "org.gnome.desktop.search-providers",
});
const manager = new GnomeSearchProviderManager(settings);
const providers = manager.getEnabledProviders();

print(`Enabled providers: ${providers.map((provider) => provider.label).join(", ")}`);

if (ARGV.length > 0) {
  const queries = ARGV.join(" ")
    .split("::")
    .map((query) => query.trim())
    .filter(Boolean);

  for (const query of queries) {
    print(`Query: ${query}`);
    const results = await manager.search(query);
    results.forEach((result) =>
      print(`${result.metadata}\t${result.label}\t${result.subtitle}`),
    );
  }
}
