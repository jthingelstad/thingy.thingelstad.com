// Minimal 11ty config for the standalone Thingy site.
// The site is a single njk page (a thin Librarian-API client) plus static
// assets — no collections, filters, or markdown pipeline needed.
module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("img");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("favicon.svg");
  eleventyConfig.addPassthroughCopy("CNAME");
  // Prevent GitHub Pages from running Jekyll.
  eleventyConfig.addPassthroughCopy({ "_nojekyll": ".nojekyll" });

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
  };
};
