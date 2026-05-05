/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: '/admin', destination: '/dashboard/admin', permanent: false },
      { source: '/admin/:path*', destination: '/dashboard/admin/:path*', permanent: false },
    ]
  },
}

export default nextConfig
