import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import AppChrome from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "SportSpot",
  description: "Find courts, join games, and challenge teams in Nepal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
