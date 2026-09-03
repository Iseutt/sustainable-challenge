// Small inline-SVG icon set (outline style, stroke=currentColor) replacing
// emoji throughout the UI. Hand-written paths, no external icon-font/CDN
// dependency, consistent with the app's minimal-dependency approach.

const Icons = (() => {
  const PATHS = {
    car: '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    mapPin: '<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    map: '<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z"/><path d="M9 3v16M15 5v16"/>',
    leaf: '<path d="M5 21c0-9 6-15 15-15 0 9-6 15-15 15z"/><path d="M5 21c3-3 6-6 9-11"/>',
    star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 16.9 6.4 20l1.4-6.2L3 9.5l6.4-.6L12 3z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0v13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    switch: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  };

  function icon(name, { size = 18, strokeWidth = 1.75, className = "" } = {}) {
    const inner = PATHS[name];
    if (!inner) return "";
    return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  // Applies icons to any static [data-icon] placeholder in the page
  // (e.g. <span data-icon="car"></span>). Dynamically-created elements
  // (trajet cards, buttons) call icon() directly instead.
  function applyIcons() {
    document.querySelectorAll("[data-icon]").forEach((el) => {
      const size = parseInt(el.dataset.iconSize, 10) || 18;
      el.innerHTML = icon(el.dataset.icon, { size });
    });
  }

  return { icon, applyIcons };
})();
