import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrainDump API",
  description: "Private API for the BrainDump mobile app.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
