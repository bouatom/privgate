import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PrivGate",
  description: "Admin-controlled elevation for Active Directory users",
};

const appearanceScript = `(function(){try{var t=localStorage.getItem("privgate-theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");if(localStorage.getItem("privgate-rail")==="hidden")document.documentElement.setAttribute("data-rail","hidden");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className={`${sans.className} ${mono.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
        {children}
      </body>
    </html>
  );
}
