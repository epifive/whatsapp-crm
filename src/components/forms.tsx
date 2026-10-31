"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + input + optional hint, wired up for accessibility */
export function Field({
  id,
  label,
  hint,
  className,
  ...input
}: React.ComponentProps<"input"> & { id: string; label: string; hint?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormMessage({ type, children }: { type: "error" | "success"; children: React.ReactNode }) {
  if (!children) return null;
  const Icon = type === "error" ? AlertCircle : CheckCircle2;
  return (
    <Alert variant={type === "error" ? "destructive" : "default"} role={type === "error" ? "alert" : "status"}>
      <Icon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
