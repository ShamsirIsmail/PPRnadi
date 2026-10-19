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
  title: 'PPR NADI | Infrastruktur & Kesinambungan Komuniti',
  description: 'Platform komuniti perumahan awam PPR untuk pelaporan kerosakan dan notis rasmi pengurusan.',
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
