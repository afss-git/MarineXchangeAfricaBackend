/** @type {import('next').NextConfig} */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace("/api/v1", "") ||
  process.env.BACKEND_URL ||
  "http://localhost:8000"

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
    ]
  },
}

export default nextConfig
