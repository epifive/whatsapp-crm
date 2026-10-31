import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** App logo: the uploaded logo from branding settings, or a default mark + name */
export function Brand({ appName, logoUrl, className }: { appName: string; logoUrl?: string | null; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold", className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- buyer-uploaded logo of unknown size/host
        <img src={logoUrl} alt={appName} className="h-8 w-auto" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <MessageCircle className="size-5" />
        </span>
      )}
      <span className="truncate">{appName}</span>
    </span>
  );
}
