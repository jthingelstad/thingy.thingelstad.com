// Captured once at module load, BEFORE the Tinylytics loader scrubs
// sensitive params from the URL. Route components read these instead of
// window.location.search (same rule the page-entry-order test enforces).
export const bootParams = new URLSearchParams(window.location.search);
export const bootPath = window.location.pathname;
