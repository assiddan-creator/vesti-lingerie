import type { Metadata } from "next";
import { Geist_Mono, Manrope, Noto_Serif } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const notoSerif = Noto_Serif({
  subsets: ["latin"],
  variable: "--font-noto-serif",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Vesti Lingerie",
  description: "Private AI try-on for Victoria's Secret–inspired lingerie.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${manrope.variable} ${notoSerif.variable} ${geistMono.variable} font-body antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
