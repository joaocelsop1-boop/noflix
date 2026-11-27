import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsScreen } from "@/components/settings-screen";

export const metadata: Metadata = { title: "Configurações — CinePlus" };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f1220]" />}>
      <SettingsScreen />
    </Suspense>
  );
}
