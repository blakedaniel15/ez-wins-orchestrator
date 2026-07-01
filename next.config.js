/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure the classifier prompt + email signature are bundled into the
  // serverless functions that read them at runtime (Vercel file tracing).
  outputFileTracingIncludes: {
    '/api/sweep': ['./lib/prompts/**', './lib/signature.html'],
    '/api/onboarding': ['./lib/signature.html'],
    '/api/outbox': ['./lib/signature.html'],
  },
};

module.exports = nextConfig;
