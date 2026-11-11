import { LinkPage } from "@/components/link-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <LinkPage
      role="CUSTOMER"
      title="Distributors"
      kind="DISTRIBUTOR_CUSTOMER"
      directory={{ url: "/api/directory/distributors", findLabel: "Find distributors" }}
      emptyText="No links yet. Find a distributor."
    />
  );
}
