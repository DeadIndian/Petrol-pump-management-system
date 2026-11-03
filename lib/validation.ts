import { z } from "zod";

// Authentication schemas
export const SignupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2, "Full name is required"),
  phone: z
    .string()
    .regex(/^\d{10}$/, "Phone number must be 10 digits")
    .optional(),
  role: z.literal("CUSTOMER").default("CUSTOMER"),
});

export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string(),
});

// Order schemas
export const CreateOrderSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    vehicleNumber: z.string().min(1, "Vehicle number is required"),
    fuelType: z.enum(["PETROL", "DIESEL"]),
    amountRequested: z.number().positive("Amount must be positive").optional(),
    quantityRequested: z
      .number()
      .positive("Quantity must be positive")
      .optional(),
    cash: z
      .number()
      .int("Cash must be a whole number")
      .min(0, "Cash cannot be negative")
      .default(0),
  })
  .refine((data) => data.amountRequested || data.quantityRequested, {
    message: "Either amount or quantity must be specified",
    path: ["amountRequested"],
  })
  .refine((data) => !(data.amountRequested && data.quantityRequested), {
    message: "Cannot specify both amount and quantity",
    path: ["amountRequested"],
  });

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(["PENDING", "DELIVERED", "COMPLETED"]),
  deliveredAt: z.date().optional(),
});

export const MarkOrderDeliveredSchema = z.object({
  quantityDelivered: z.number().positive("Quantity delivered must be positive"),
});

// Price schemas
export const SetFuelPriceSchema = z.object({
  fuelType: z.enum(["PETROL", "DIESEL"]),
  pricePerLiter: z.number().positive("Price must be positive"),
  date: z.date().optional(), // Defaults to today
});

// Admin schemas
export const SetIndentSchema = z
  .object({
    indentStart: z.number().int().min(1, "Starting indent must be at least 1"),
    indentEnd: z.number().int().min(1, "Ending indent must be at least 1"),
  })
  .refine((data) => data.indentEnd >= data.indentStart, {
    message: "Ending indent must be greater than or equal to starting indent",
    path: ["indentEnd"],
  });

// Payment schemas (replaces old bill/cash-advance schemas)
export const CreatePaymentSchema = z.object({
  customerProfileId: z.string().min(1, "Customer profile ID is required"),
  amount: z.number().positive("Amount must be positive"),
  paymentMethod: z
    .enum(["CASH", "BANK_TRANSFER", "CHEQUE", "UPI", "OTHER"])
    .optional(),
  paymentMethodNote: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  paymentDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid payment date").optional(),
});

export const PaymentFilterSchema = z.object({
  customerProfileId: z.string().optional(),
  paymentMethod: z
    .enum(["CASH", "BANK_TRANSFER", "CHEQUE", "UPI", "OTHER"])
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// Pagination schema
export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// Filter schemas
export const OrderFilterSchema = z.object({
  status: z.enum(["PENDING", "DELIVERED", "COMPLETED"]).optional(),
  fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
  customerId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// Type exports for use in API routes
export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
export type MarkOrderDeliveredInput = z.infer<typeof MarkOrderDeliveredSchema>;
export type SetFuelPriceInput = z.infer<typeof SetFuelPriceSchema>;
export type SetIndentInput = z.infer<typeof SetIndentSchema>;
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
export type PaymentFilterInput = z.infer<typeof PaymentFilterSchema>;
export type OrderFilterInput = z.infer<typeof OrderFilterSchema>;
