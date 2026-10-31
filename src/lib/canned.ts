import { z } from "zod";

export const cannedSchema = z.object({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,30}$/, "Shortcut: letters, numbers, - or _ (used as /shortcut)."),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4096),
});
