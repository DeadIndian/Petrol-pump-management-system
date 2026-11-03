import CustomerDetail from "./customer-detail";
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  return <CustomerDetail params={await params} />;
}
