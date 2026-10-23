import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OpenShrooly · Shroom Labs',
  description: 'On-device chamber dashboard for OpenShrooly',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
