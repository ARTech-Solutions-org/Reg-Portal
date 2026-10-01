import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { eventAdminBrandingGetResponseSchema } from "@eventdesk/contracts";
import { apiContract } from "@/lib/api";

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function getForegroundHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * (r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4) +
                    0.7152 * (g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4) +
                    0.0722 * (b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4);
  return luminance > 0.179 ? "0 0% 0%" : "0 0% 100%"; // Black if light background, White if dark
}

export function useEventBranding() {
  const { eventId } = useParams();

  const brandingQuery = useQuery({
    queryKey: ["event-admin-branding", eventId],
    queryFn: () => apiContract(`/events/${eventId}/event-admin-branding`, eventAdminBrandingGetResponseSchema),
    enabled: Boolean(eventId),
  });

  useEffect(() => {
    const root = document.documentElement;
    if (brandingQuery.data?.branding) {
      const b = brandingQuery.data.branding;
      root.style.setProperty("--primary", hexToHsl(b.accentColor));
      root.style.setProperty("--primary-foreground", getForegroundHsl(b.accentColor));
      root.style.setProperty("--background", hexToHsl(b.backgroundColor));
      root.style.setProperty("--card", hexToHsl(b.panelColor));
      root.style.setProperty("--foreground", hexToHsl(b.textColor));
      root.style.setProperty("--muted-foreground", hexToHsl(b.mutedTextColor));
    } else {
      // Reset to defaults if no branding is active
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--background");
      root.style.removeProperty("--card");
      root.style.removeProperty("--foreground");
      root.style.removeProperty("--muted-foreground");
    }
    return () => {
      // Cleanup on unmount or project change (optional, but good for switching to non-project views)
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--background");
      root.style.removeProperty("--card");
      root.style.removeProperty("--foreground");
      root.style.removeProperty("--muted-foreground");
    };
  }, [brandingQuery.data]);

  return { branding: brandingQuery.data?.branding };
}
