/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))", "card-foreground": "hsl(var(--card-foreground))",
        primary: "hsl(var(--primary))", "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))", "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))", "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))", "accent-foreground": "hsl(var(--accent-foreground))",
        destructive: "hsl(var(--destructive))", border: "hsl(var(--border))",
        input: "hsl(var(--input))", ring: "hsl(var(--ring))", sidebar: "hsl(var(--sidebar))",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"], display: ["DM Sans", "ui-sans-serif", "system-ui"], mono: ["IBM Plex Mono", "ui-monospace", "monospace"] },
      boxShadow: { lift: "0 12px 32px -16px rgb(22 35 57 / 18%)" },
    },
  },
  plugins: [],
};
