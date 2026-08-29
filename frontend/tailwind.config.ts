import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
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
