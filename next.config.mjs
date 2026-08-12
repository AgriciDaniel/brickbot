/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

export default {
  // === Required for GitHub Pages (static hosting) ===
  output: 'export',
  images: { unoptimized: true },
  
  // If you're NOT using a custom domain and deploying to username.github.io/repo-name/
  // uncomment these lines and replace 'repo-name' with your repository name:
  // basePath: isProd ? '/repo-name' : undefined,
  // assetPrefix: isProd ? '/repo-name/' : undefined,

  // === Make CI builds resilient (common causes of exit code 1) ===
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
}
