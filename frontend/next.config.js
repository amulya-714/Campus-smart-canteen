/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // mongodb/pg must stay as real Node packages (not bundled) in API routes
  experimental: { serverComponentsExternalPackages: ['mongodb', 'pg'] },
};
