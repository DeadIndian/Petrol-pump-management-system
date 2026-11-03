export type UserRole = "ADMIN" | "EMPLOYEE" | "CUSTOMER";
export interface WebUser { id: string; fullName: string; email: string; phone: string | null; role: UserRole; }
export interface WebOrder {
  id: string; customerId: string; vehicleNumber: string; indentNumber: number | null;
  fuelType: "PETROL" | "DIESEL"; quantityRequested: number | null; amountRequested: number | null;
  cash: number; quantityDelivered: number | null; pricePerLiter: number | null; totalAmount: number | null;
  status: "PENDING" | "DELIVERED" | "COMPLETED"; createdAt: string; deliveredAt: string | null;
  customer: { id: string; fullName: string; email: string; phone?: string | null };
  fulfilledBy?: { fullName: string } | null;
}
export interface WebPrice { id: string; fuelType: "PETROL" | "DIESEL"; pricePerLiter: number; date: string; }
export function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value); }
