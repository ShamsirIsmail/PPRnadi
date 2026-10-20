import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ppr-nadi-staging.vercel.app'),
  title: 'PPR NADI | Suara Komuniti. Nadi Perubahan.',
  description: 'Platform komuniti perumahan awam PPR untuk pelaporan kerosakan fasiliti dan penyampaian notis rasmi pengurusan.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.png', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png' },
    ],
  },
  openGraph: {
    title: 'PPR NADI | Suara Komuniti. Nadi Perubahan.',
    description: 'Platform komuniti perumahan awam PPR untuk pelaporan kerosakan fasiliti dan penyampaian notis rasmi pengurusan.',
    url: 'https://ppr-nadi-staging.vercel.app',
    siteName: 'PPR NADI',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PPR NADI — Suara Komuniti. Nadi Perubahan.',
      },
    ],
    locale: 'ms_MY',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PPR NADI | Suara Komuniti. Nadi Perubahan.',
    description: 'Platform komuniti perumahan awam PPR untuk pelaporan kerosakan fasiliti dan penyampaian notis rasmi pengurusan.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ms"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-[#17212F]">
        <LanguageProvider initialLocale="ms">
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
