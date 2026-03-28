import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth'
import { PageLoaderProvider } from '@/components/page-loader'
import { SWRProvider } from '@/lib/swr-config'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MarineXchange Africa | B2B Maritime & Industrial Asset Marketplace',
  description: 'Africa\'s premier B2B digital marketplace for high-value maritime and industrial assets. Buy and sell vessels, offshore equipment, and industrial machinery with confidence.',
  generator: 'MarineXchange',
  keywords: ['maritime', 'industrial assets', 'B2B marketplace', 'Africa', 'vessels', 'offshore equipment'],
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#0F2A44',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <SWRProvider>
          <AuthProvider>
            <PageLoaderProvider>
              {children}
            </PageLoaderProvider>
          </AuthProvider>
        </SWRProvider>
      </body>
    </html>
  )
}
