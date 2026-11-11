import { LinkPage } from "@/components/link-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <LinkPage role="PROVIDER" title="Distributors" kind="PROVIDER_DISTRIBUTOR" emptyText="No distributors linked yet. Distributors request a link from their Providers tab." />;
}
