import type { Metadata, Viewport } from 'next'
import { Archivo, Hanken_Grotesk } from 'next/font/google'
import './globals.css'
import AppShell from './AppShell'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'

// Charge/Blaze type system — Archivo (display/numerals) + Hanken Grotesk (body/UI). next/font
// self-hosts both (no runtime network), so the no-flash script + offline PWA behavior are unaffected;
// the CSS --font-display/--font-body tokens reference these variables.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
})
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-hanken',
  display: 'swap',
})

// Canonical site URL for absolute OG/metadata URLs — set NEXT_PUBLIC_SITE_URL per environment.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://daily-rep.app'
const description = 'Personalized strength training that adapts to how recovered your muscles are.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: 'Daily Rep',
  title: 'Daily Rep — Personalized Training',
  description,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Daily Rep' },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Daily Rep',
    title: 'Daily Rep — Personalized Training',
    description,
    url: siteUrl,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Daily Rep' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Daily Rep — Personalized Training',
    description,
    images: ['/og.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0c10',
  width: 'device-width',
  initialScale: 1,
  // pinch-zoom left enabled for accessibility (WCAG 1.4.4) — do not set maximumScale/userScalable
  viewportFit: 'cover',
}

// Applies the saved theme + accent before first paint so there's no light/dark flash.
const noFlashTheme = `(function(){try{
var A={lime:['190 242 100','77 124 15'],blue:['96 165 250','37 99 235'],violet:['167 139 250','124 58 237'],cyan:['34 211 238','14 116 144'],orange:['251 146 60','194 65 12'],rose:['251 113 133','225 29 72']};
var p={};try{p=(JSON.parse(localStorage.getItem('daily-rep-v1'))||{}).state.profile||{}}catch(e){}
var t=p.theme||'system';var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var r=document.documentElement;r.classList.add(d?'dark':'light');var a=A[p.accent]||A.lime;r.style.setProperty('--accent',d?a[0]:a[1]);
}catch(e){document.documentElement.classList.add('dark')}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on <html>: the no-flash script adds the dark/light class before hydration,
  // which would otherwise mismatch the server-rendered className (font variables only).
  return (
    <html lang="en" className={`${archivo.variable} ${hanken.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className="font-sans">
        <ServiceWorkerRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
