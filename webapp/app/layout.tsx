import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OpenShrooly · Shroom Labs',
  description: 'On-device chamber dashboard. Works with Shrooly devices running OpenShrooly.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <strong>OpenShrooly</strong>
          <small>Works with Shrooly devices running OpenShrooly</small>
        </header>
        {children}
      </body>
    </html>
  )
}
