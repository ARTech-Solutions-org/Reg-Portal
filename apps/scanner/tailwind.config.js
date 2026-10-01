/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { background: "hsl(var(--background))", foreground: "hsl(var(--foreground))", primary: "hsl(var(--primary))", muted: "hsl(var(--muted))", "muted-foreground": "hsl(var(--muted-foreground))", border: "hsl(var(--border))", success: "hsl(var(--success))", danger: "hsl(var(--danger))" }, fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"], mono: ["IBM Plex Mono", "ui-monospace", "monospace"] } } },
  plugins: [],
};
