/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Egen package-lock i /trainer – peka ut root så Next inte gissar.
  outputFileTracingRoot: import.meta.dirname,
  // PWA/offline-polish kopplas på i ett senare steg (build order #6).
};

export default nextConfig;
