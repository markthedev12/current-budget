import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Current — Budget together",
  description: "A clear plan from today to payday.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
