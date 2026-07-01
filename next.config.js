/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14.2: file-tracing includes live under `experimental`. Ensure the
  // classifier prompt + email signature are bundled into the serverless
  // functions that read them at runtime.
  experimental: {
    outputFileTracingIncludes: {
      '/api/sweep': ['./lib/prompts/**', './lib/signature.html'],
      '/api/onboarding': ['./lib/signature.html'],
      '/api/outbox': ['./lib/signature.html'],
    },
  },
};

module.exports = nextConfig;
