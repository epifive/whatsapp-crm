import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(200, "Password is too long.");

export const nameSchema = z.string().trim().min(1, "Name is required.").max(100);
