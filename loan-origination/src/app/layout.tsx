import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loan Origination",
  description: "Chat-driven private loan origination",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
