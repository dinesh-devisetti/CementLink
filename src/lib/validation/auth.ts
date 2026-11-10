import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const registerSchema = z
  .object({
    name: text(100),
    email: emailSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    role: z.enum(["CUSTOMER", "DISTRIBUTOR", "PROVIDER"]),
    phone: z.string().trim().regex(/^\+?\d{10,13}$/, "Enter a valid phone number"),
    businessName: z.string().trim().max(150).optional(),
    city: z.string().trim().max(80).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role !== "CUSTOMER") {
      if (!v.businessName) ctx.addIssue({ code: "custom", path: ["businessName"], message: "Business name is required" });
      if (!v.city) ctx.addIssue({ code: "custom", path: ["city"], message: "City is required" });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
