// GitHub Pages serves project repos from https://<user>.github.io/<repo>/, so
// the build needs a matching basePath there. Other static hosts (Hostinger,
// Netlify, a custom domain, local preview) serve from the root, so this only
// applies when the GitHub Pages workflow sets GITHUB_PAGES=true.
const basePath = process.env.GITHUB_PAGES === "true" ? "/cibc-ynab-sync" : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath,
};

export default nextConfig;
