import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Shroom Labs chamber',
  description: 'Your chamber dashboard. Works with Shrooly devices running OpenShrooly.',
}

// Fonts ship inside the chamber firmware, so the page looks right with no internet.
// The preload links also tell the firmware build which font files to embed.
const FONTS = ['/fonts/fraunces-600.woff2', '/fonts/atkinson-400.woff2', '/fonts/atkinson-700.woff2']

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {FONTS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  )
}
