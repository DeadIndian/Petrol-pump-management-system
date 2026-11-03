// Fuel prices are calendar dates in the petrol pump's Indian operating timezone.
export function businessDate(value: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
}

export function businessDayStart(value: Date = new Date()) { return new Date(businessDate(value).getTime() - 19800000); }
