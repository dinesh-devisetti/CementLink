import { LinkPage } from "@/components/link-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <LinkPage role="DISTRIBUTOR" title="Customers" kind="DISTRIBUTOR_CUSTOMER" emptyText="No customers linked yet. Customers request a link from their Distributors tab." />;
}
