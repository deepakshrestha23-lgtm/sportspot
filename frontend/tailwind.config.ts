import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontWeight: {
        // SportSpot uses headings and actions frequently. Keeping the heaviest
        // utility at 700 preserves emphasis without turning every label into
        // a display headline.
        black: "700",
      },
      colors: {
        sportNavy: "#0B1220",
        sportGreen: "#087A3E",
        sportOrange: "#F97316",
      },
    },
  },
  plugins: [],
};

export default config;
