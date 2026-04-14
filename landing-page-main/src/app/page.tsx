import { LocalSettlementDemo } from "@/components/LocalSettlementDemo";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "Local Settlement Demo",
  description: "Local settlement prototype dashboard",
};

export default function Home() {
  return <LocalSettlementDemo />;
}
