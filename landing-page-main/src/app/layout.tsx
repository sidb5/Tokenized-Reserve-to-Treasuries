import '@/styles/tailwind.css';
import { Inter } from "next/font/google";
import React from 'react';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata = {
  title: "Local Settlement Demo",
  description: "Local settlement prototype dashboard",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`min-h-screen bg-neutral-50 font-sans ${inter.variable}`}>{children}</body>
    </html>
  );
}
