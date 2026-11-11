import { ComingSoonPage } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  return <ComingSoonPage role="DISTRIBUTOR" section={(await params).section} />;
}
