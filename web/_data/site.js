// Standalone Thingy site config.
//
// The front-end is a thin client of the Librarian API (see THINGY_ROADMAP.md /
// STANDALONE_BUILD.md). The two URLs below are the only runtime coupling to the
// backend. Defaults point at the live Lambdas; override per-environment with
// LIBRARIAN_API_URL / LIBRARIAN_STREAM_URL for local dev or staging.

function env(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

module.exports = {
  title: "Thingy",
  description:
    "Ask Thingy to find and synthesize writing from across Jamie Thingelstad's archive.",
  url: "https://thingy.thingelstad.com",
  author: "Jamie Thingelstad",

  // Librarian API endpoints (same backend as weekly.thingelstad.com/thingy/).
  librarianApiUrl: env(
    "LIBRARIAN_API_URL",
    "https://k0yklt9vg3.execute-api.us-east-1.amazonaws.com"
  ),
  librarianStreamUrl: env(
    "LIBRARIAN_STREAM_URL",
    "https://jcvud66qqpq53frvno5stoqntm0zqntw.lambda-url.us-east-1.on.aws/"
  ),

  // Tinylytics site profile for standalone Thingy. Override with TINYLYTICS_SITE_UID;
  // the client's event hooks no-op when empty. The embed loader (base.njk)
  // adds ?events&beacon so the data-tinylytics-event hooks record.
  tinylyticsId: env("TINYLYTICS_SITE_UID", "u5bRAyyJvMXUrz6zbTz5"),
};
