import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'S&P 500 dashboard',
  description: 'Daily and live S&P 500 prices, with notes and AI queries.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[var(--page)] text-[var(--text-primary)]">
        <header className="border-b border-[var(--hairline)] px-6 py-3">
          <h1 className="text-base font-semibold">S&amp;P 500</h1>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </body>
    </html>
  )
}
