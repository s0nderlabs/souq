import type { Metadata } from "next";
import { Instrument_Serif, Source_Serif_4 } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "@/providers";
import { Nav } from "@/components/nav";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const sourceSerif4 = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const ioskeleyMono = localFont({
  src: [
    { path: "../fonts/IoskeleyMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/IoskeleyMono-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/IoskeleyMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Souq",
  description: "Decentralized agent-to-agent commerce protocol",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${sourceSerif4.variable} ${ioskeleyMono.variable}`}>
      <body>
        <Providers>
          <Nav />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
