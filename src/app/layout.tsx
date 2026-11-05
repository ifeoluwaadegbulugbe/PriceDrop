import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const text = Instrument_Sans({ subsets: ["latin"], variable: "--font-text", display: "swap" });

export const metadata: Metadata = {
  title: "PriceDrop: the shopping agent that knows when to buy",
  description: "Tell PriceDrop what you want and what you're willing to pay. It watches prices and helps you act when the right deal appears.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
