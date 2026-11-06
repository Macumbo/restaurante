"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { LangSwitch } from "@/components/ui";

export default function Home() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-brand text-white">
      <div className="flex justify-end p-4">
        <LangSwitch />
      </div>
      <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-6 px-6 pb-16">
        <h1 className="text-3xl font-bold leading-tight">{t("home.title")}</h1>
        <p className="text-lg opacity-90">{t("home.body")}</p>
        <Link href="/m/demo-mesa-1" className="rounded-xl bg-white px-4 py-3 text-center font-semibold text-brand">
          {t("home.demo")}
        </Link>
        <Link href="/staff" className="rounded-xl border border-white/60 px-4 py-3 text-center font-semibold">
          {t("home.staff")}
        </Link>
      </main>
    </div>
  );
}
