(() => {
  "use strict";

  const states = globalThis.SUPERBAR_SHOWCASE_STATES;
  const params = new URLSearchParams(window.location.search);
  const stateName = params.get("state") || "dark-search";
  const state = states[stateName] || states["dark-search"];

  const iconPaths = {
    search:
      '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    terminal:
      '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="m7 9 3 3-3 3M13 15h4"></path>',
    window:
      '<rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M3 9h18M7 6.5h.01M10 6.5h.01"></path>',
    globe:
      '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"></path>',
    folder:
      '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path>',
    download:
      '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"></path>',
    clipboard:
      '<rect x="5" y="5" width="14" height="16" rx="2"></rect><path d="M9 5V3h6v2M9 10h6M9 14h6"></path>',
    calculator:
      '<rect x="5" y="2.5" width="14" height="19" rx="2"></rect><path d="M8 6h8M9 11h.01M15 11h.01M9 15h.01M15 15h.01M9 19h.01M15 19h.01"></path>',
    weather:
      '<path d="M7 17.5h10a4 4 0 0 0 .3-8 6 6 0 0 0-11.4 1.3A3.5 3.5 0 0 0 7 17.5Z"></path><path d="M8 21h8"></path>',
  };

  function icon(name, className = "") {
    const paths = iconPaths[name] || iconPaths.globe;
    return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  function renderStandardRow(row) {
    const action = row.action
      ? `<span class="copy-action${row.action === "copied" ? " copied" : ""}">${row.action}</span>`
      : row.metadata
        ? `<span class="metadata">${row.metadata}</span>`
        : "";

    return `
      <article class="result-row result-${row.type}${row.selected ? " selected" : ""}">
        <span class="icon-tile">${icon(row.icon)}</span>
        <span class="result-text">
          <span class="result-title">${row.title}</span>
          ${row.subtitle ? `<span class="result-subtitle">${row.subtitle}</span>` : ""}
        </span>
        ${action}
      </article>`;
  }

  function renderCalculator(row) {
    return `
      <article class="result-row answer${row.selected ? " selected" : ""}">
        <span class="icon-tile">${icon(row.icon)}</span>
        <span class="result-text">
          <span class="answer-context">${row.context}</span>
          <span class="answer-value">${row.title}</span>
          <span class="result-subtitle">${row.subtitle}</span>
        </span>
      </article>`;
  }

  function renderWeather(row) {
    return `
      <article class="result-row weather-card${row.selected ? " selected" : ""}">
        <span class="icon-tile weather-tile">${icon(row.icon)}</span>
        <span class="weather-copy">
          <span class="weather-city">${row.title}</span>
          <span class="result-subtitle">${row.description}</span>
          <span class="weather-details">${row.details}</span>
        </span>
        <span class="temperature">${row.temperature}</span>
      </article>`;
  }

  function renderRow(row) {
    if (row.type === "calc") return renderCalculator(row);
    if (row.type === "weather") return renderWeather(row);
    return renderStandardRow(row);
  }

  document.body.dataset.theme = state.theme;
  document.body.dataset.state = stateName;
  document.querySelector("[data-icon='search']").innerHTML = icon("search");
  document.querySelector(".query").innerHTML = state.query
    ? `<span>${state.query}</span><i class="caret"></i>`
    : `<span class="placeholder">${state.placeholder}</span><i class="caret"></i>`;
  document.querySelector(".mode-label").textContent = state.mode;
  document.querySelector(".results").innerHTML = state.rows
    .map(renderRow)
    .join("");
  document.querySelector(".render-label").textContent = `Superbar · ${state.label}`;

  if (state.position === "bottom") {
    const superbar = document.querySelector(".superbar");
    const searchRow = document.querySelector(".search-row");
    const resultsDivider = document.querySelector(".results-divider");
    const results = document.querySelector(".results");
    const footerDivider = document.querySelector(".footer-divider");
    const footer = document.querySelector(".footer");
    superbar.classList.add("bottom-position");
    superbar.append(
      results,
      resultsDivider,
      searchRow,
      footerDivider,
      footer,
    );
  }

  const hasResults = state.rows.length > 0;
  document.querySelector(".results-divider").hidden =
    !hasResults && state.position === "bottom";
  document.querySelector(".results").hidden = !hasResults;
  document.querySelector(".footer-divider").hidden =
    !hasResults && state.position !== "bottom";
  document.querySelector(".footer").hidden = !hasResults;

  document.fonts.ready.then(() => {
    document.documentElement.dataset.renderReady = "true";
  });
})();
