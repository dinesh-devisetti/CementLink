import { LinkPage } from "@/components/link-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <LinkPage
      role="DISTRIBUTOR"
      title="Providers"
      kind="PROVIDER_DISTRIBUTOR"
      directory={{ url: "/api/directory/providers", findLabel: "Find providers" }}
      emptyText="No links yet. Find a provider."
    />
  );
}
