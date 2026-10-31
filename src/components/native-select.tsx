import { cn } from "@/lib/utils";

/** Native <select> styled like our inputs: accessible, works with forms and on every phone */
export function NativeSelect({ className, size = "default", ...props }: Omit<React.ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return (
    <select
      className={cn(
        "rounded-md border border-input bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30",
        size === "sm" ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm",
        className,
      )}
      {...props}
    />
  );
}
