import Link from "next/link";
import { Brand } from "@/components/brand";
import { getBranding } from "@/lib/settings";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBranding();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Link href="/" className="mb-8">
        <Brand appName={brand.appName} logoUrl={brand.logoUrl} className="text-lg" />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
