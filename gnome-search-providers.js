// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Furkan

import Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import GLib from "gi://GLib";

import {
  flattenProviderResultGroups,
  isSubsearchQuery,
  isSearchProviderEnabled,
  sortSearchProviders,
  tokenizeSearchQuery,
} from "./search-provider-config.js";

const SEARCH_PROVIDER_GROUP = "Shell Search Provider";
const SEARCH_PROVIDER_INTERFACE = "org.gnome.Shell.SearchProvider2";
const SEARCH_PROVIDER_DIRECTORY = "gnome-shell/search-providers";
const PROVIDER_CALL_TIMEOUT_MS = 3000;
const RESULTS_PER_PROVIDER = 3;

function getOptionalKeyFileString(keyFile, key, fallback = "") {
  try {
    return keyFile.get_string(SEARCH_PROVIDER_GROUP, key);
  } catch (_e) {
    return fallback;
  }
}

function getOptionalKeyFileBoolean(keyFile, key, fallback) {
  try {
    return keyFile.get_boolean(SEARCH_PROVIDER_GROUP, key);
  } catch (_e) {
    return fallback;
  }
}

function unpackVariantValue(value) {
  let unpacked = value;
  while (unpacked instanceof GLib.Variant) {
    if (unpacked.get_type_string() === "v") {
      unpacked = unpacked.get_variant();
    } else {
      return unpacked.deepUnpack();
    }
  }
  return unpacked;
}

function deserializeResultIcon(meta, fallbackIcon) {
  try {
    let serializedIcon = meta.icon;
    while (
      serializedIcon instanceof GLib.Variant &&
      serializedIcon.get_type_string() === "v"
    ) {
      serializedIcon = serializedIcon.get_variant();
    }
    if (serializedIcon instanceof GLib.Variant) {
      const icon = Gio.icon_deserialize(serializedIcon);
      if (icon) return icon;
    }
  } catch (_e) {
    // Providers may still return one of the deprecated icon formats.
  }

  try {
    const serializedGicon = unpackVariantValue(meta.gicon);
    if (typeof serializedGicon === "string" && serializedGicon) {
      return Gio.icon_new_for_string(serializedGicon);
    }
  } catch (_e) {
    // The provider application's icon remains a useful fallback.
  }

  return fallbackIcon ?? null;
}

function loadProviderFile(path) {
  const keyFile = new GLib.KeyFile();
  keyFile.load_from_file(path, GLib.KeyFileFlags.NONE);

  const desktopId = getOptionalKeyFileString(keyFile, "DesktopId");
  const busName = getOptionalKeyFileString(keyFile, "BusName");
  const objectPath = getOptionalKeyFileString(keyFile, "ObjectPath");
  const version = Number(getOptionalKeyFileString(keyFile, "Version", "1"));

  if (!desktopId || !busName || !objectPath || version !== 2) return null;

  const appInfo = GioUnix.DesktopAppInfo.new(desktopId);
  if (!appInfo) return null;

  return {
    id: desktopId,
    desktopId,
    busName,
    objectPath,
    appInfo,
    label: appInfo.get_display_name?.() ?? appInfo.get_name() ?? desktopId,
    gicon: appInfo.get_icon?.() ?? null,
    defaultDisabled: getOptionalKeyFileBoolean(
      keyFile,
      "DefaultDisabled",
      false,
    ),
    autoStart: getOptionalKeyFileBoolean(keyFile, "AutoStart", true),
  };
}

export class GnomeSearchProviderManager {
  constructor(searchSettings = null) {
    this._searchSettings = searchSettings;
    this._providers = [];
    this._previousResults = new Map();
    this.discover();
  }

  discover() {
    const dataDirectories = [
      GLib.get_user_data_dir(),
      ...GLib.get_system_data_dirs(),
    ];
    const providers = [];
    const seenDesktopIds = new Set();

    for (const dataDirectory of dataDirectories) {
      const directoryPath = GLib.build_filenamev([
        dataDirectory,
        SEARCH_PROVIDER_DIRECTORY,
      ]);
      const directory = Gio.File.new_for_path(directoryPath);
      let enumerator = null;

      try {
        enumerator = directory.enumerate_children(
          "standard::name",
          Gio.FileQueryInfoFlags.NONE,
          null,
        );
        const filenames = [];
        let fileInfo = null;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
          const filename = fileInfo.get_name();
          if (filename.endsWith(".ini")) {
            filenames.push(filename);
          }
        }

        for (const filename of filenames.sort()) {
          try {
            const provider = loadProviderFile(
              GLib.build_filenamev([directoryPath, filename]),
            );
            if (!provider || seenDesktopIds.has(provider.desktopId)) continue;

            seenDesktopIds.add(provider.desktopId);
            providers.push(provider);
          } catch (_e) {
            // A malformed third-party provider must not break all search.
          }
        }
      } catch (_e) {
        // Missing provider directories are normal on minimal installations.
      } finally {
        try {
          enumerator?.close(null);
        } catch (_e) {
          // The enumerator may already be closed after an I/O failure.
        }
      }
    }

    this._providers = providers;
    this._previousResults.clear();
  }

  _getConfiguration() {
    if (!this._searchSettings) {
      return {
        disableExternal: false,
        disabled: [],
        enabled: [],
        sortOrder: [],
      };
    }

    return {
      disableExternal: this._searchSettings.get_boolean("disable-external"),
      disabled: this._searchSettings.get_strv("disabled"),
      enabled: this._searchSettings.get_strv("enabled"),
      sortOrder: this._searchSettings.get_strv("sort-order"),
    };
  }

  getEnabledProviders() {
    const configuration = this._getConfiguration();
    return sortSearchProviders(
      this._providers.filter((provider) =>
        isSearchProviderEnabled(provider, configuration),
      ),
      configuration.sortOrder,
    );
  }

  hasProvider(desktopId) {
    return this._providers.some((provider) => provider.desktopId === desktopId);
  }

  isProviderEnabled(desktopId) {
    return this.getEnabledProviders().some(
      (provider) => provider.desktopId === desktopId,
    );
  }

  _call(provider, method, parameters, replyType, cancellable = null) {
    return new Promise((resolve, reject) => {
      Gio.DBus.session.call(
        provider.busName,
        provider.objectPath,
        SEARCH_PROVIDER_INTERFACE,
        method,
        parameters,
        replyType,
        provider.autoStart
          ? Gio.DBusCallFlags.NONE
          : Gio.DBusCallFlags.NO_AUTO_START,
        PROVIDER_CALL_TIMEOUT_MS,
        cancellable,
        (connection, result) => {
          try {
            resolve(connection.call_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }

  async _searchProvider(provider, terms, cancellable) {
    const previousSearch = this._previousResults.get(provider.desktopId);
    const useSubsearch = isSubsearchQuery(previousSearch?.terms, terms);
    const resultSetReply = await this._call(
      provider,
      useSubsearch ? "GetSubsearchResultSet" : "GetInitialResultSet",
      useSubsearch
        ? new GLib.Variant("(asas)", [previousSearch.resultIds, terms])
        : new GLib.Variant("(as)", [terms]),
      new GLib.VariantType("(as)"),
      cancellable,
    );
    const [allResultIds] = resultSetReply.deepUnpack();
    if (!cancellable?.is_cancelled()) {
      this._previousResults.set(provider.desktopId, {
        terms,
        resultIds: allResultIds,
      });
    }
    const resultIds = [...new Set(allResultIds)].slice(
      0,
      RESULTS_PER_PROVIDER,
    );
    if (resultIds.length === 0) return [];

    const metadataReply = await this._call(
      provider,
      "GetResultMetas",
      new GLib.Variant("(as)", [resultIds]),
      new GLib.VariantType("(aa{sv})"),
      cancellable,
    );
    const [metadata] = metadataReply.deepUnpack();

    return metadata.flatMap((meta, index) => {
      const id = unpackVariantValue(meta.id) ?? resultIds[index];
      const label = unpackVariantValue(meta.name);
      if (typeof id !== "string" || typeof label !== "string" || !label) {
        return [];
      }

      const description = unpackVariantValue(meta.description);
      const clipboardText = unpackVariantValue(meta.clipboardText);

      return [
        {
          type: "provider",
          label,
          subtitle:
            typeof description === "string" && description
              ? description
              : `Result from ${provider.label}`,
          metadata: provider.label,
          gicon: deserializeResultIcon(meta, provider.gicon),
          uri: id.startsWith("file://") ? id : null,
          provider,
          providerResultId: id,
          providerTerms: terms,
          clipboardText:
            typeof clipboardText === "string" ? clipboardText : null,
        },
      ];
    });
  }

  async search(query, cancellable = null, onUpdate = null) {
    const terms = tokenizeSearchQuery(query);
    if (terms.length === 0) return [];

    const providers = this.getEnabledProviders();
    const resultGroups = new Map();
    const tasks = providers.map(async (provider) => {
      try {
        const results = await this._searchProvider(
          provider,
          terms,
          cancellable,
        );
        if (cancellable?.is_cancelled()) return;

        resultGroups.set(provider.desktopId, results);
        onUpdate?.(flattenProviderResultGroups(providers, resultGroups));
      } catch (_e) {
        // Unavailable, disabled, slow, and faulty providers are isolated.
      }
    });

    await Promise.all(tasks);
    return flattenProviderResultGroups(providers, resultGroups);
  }

  async activate(result, timestamp) {
    const provider = result?.provider;
    const resultId = result?.providerResultId;
    if (!provider || !resultId) return;

    await this._call(
      provider,
      "ActivateResult",
      new GLib.Variant("(sasu)", [
        resultId,
        result.providerTerms ?? [],
        timestamp >>> 0,
      ]),
      new GLib.VariantType("()"),
    );
  }
}
