import Link from "next/link";
import { AlertTriangle, Youtube, Instagram } from "lucide-react";

type Props = {
  ytConfigured: boolean;
  ytStatus: "live" | "dead" | null;
  igConfigured: boolean;
  igStatus: "live" | "dead" | null;
};

function Banner({ icon, message, href, variant }: { icon: React.ReactNode; message: string; href: string; variant: "red" | "amber" }) {
  const colors = variant === "red"
    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${colors}`}>
      <span className="shrink-0">{icon}</span>
      <span>
        {message}{" "}
        <Link href={href} className="font-medium underline underline-offset-2">Fix in Settings</Link>
      </span>
    </div>
  );
}

export function CookieStatusBanners({ ytConfigured, ytStatus, igConfigured, igStatus }: Props) {
  const banners: React.ReactNode[] = [];

  if (!igConfigured) {
    banners.push(
      <Banner key="ig-missing" icon={<Instagram className="h-4 w-4" />} variant="amber"
        message="No Instagram cookie configured — profile scraping is disabled."
        href="/settings#instagram" />
    );
  } else if (igStatus === "dead") {
    banners.push(
      <Banner key="ig-dead" icon={<AlertTriangle className="h-4 w-4" />} variant="red"
        message="Instagram cookie is expired — scraping will fail."
        href="/settings#instagram" />
    );
  }

  if (!ytConfigured) {
    banners.push(
      <Banner key="yt-missing" icon={<Youtube className="h-4 w-4" />} variant="amber"
        message="No YouTube cookie configured — email reveals from YouTube About pages are disabled."
        href="/settings#youtube" />
    );
  } else if (ytStatus === "dead") {
    banners.push(
      <Banner key="yt-dead" icon={<AlertTriangle className="h-4 w-4" />} variant="red"
        message="YouTube cookie is expired — email reveals from YouTube About pages are failing."
        href="/settings#youtube" />
    );
  }

  if (banners.length === 0) return null;
  return <div className="space-y-2">{banners}</div>;
}
