import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeScript } from "@/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Kapigyan — Assessment & Insight for Indian Schools",
    template: "%s · Kapigyan",
  },
  description:
    "Upload a test, mark it automatically, and see exactly which maths topics a child has not understood — in Classes 1 to 5, in English and Hindi.",
  applicationName: "Kapigyan",
  keywords: [
    "Indian school assessment", "NCERT maths", "Classes 1-5", "formative assessment",
    "question bank", "homeschooling India", "FLN", "CBSE primary",
  ],
  authors: [{ name: "Kapigyan" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kapigyan", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // One light value on purpose: the app opens in light for everyone, so the
  // browser chrome starts light too. The pre-paint script and applyTheme()
  // repaint it dark only once a dark preference has actually been chosen.
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/*
          Applies the stored theme before the first paint. Inline and
          synchronous on purpose — see the note in theme-toggle.tsx. `suppressHydrationWarning`
          is required because this script mutates <html> before React hydrates,
          and React would otherwise report the attribute as a mismatch.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} suppressHydrationWarning />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
