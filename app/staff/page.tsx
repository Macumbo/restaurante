"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { canUse, useStaff } from "@/lib/useStaff";
import { BrandShell, Spinner } from "@/components/ui";

export default function StaffHome() {
  const { t } = useI18n();
  const staff = useStaff();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (staff.loading) return <BrandShell restaurant={null}><Spinner /></BrandShell>;
  if (staff.configError)
    return (
      <BrandShell restaurant={null}>
        <p className="card">{t("error.config")}</p>
      </BrandShell>
    );

  if (!staff.user)
    return (
      <BrandShell restaurant={null}>
        <form
          className="card mx-auto mt-10 max-w-sm space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const { error } = await supabase().auth.signInWithPassword({ email, password });
            setBusy(false);
            if (error) setError(error.message);
          }}
        >
          <h1 className="text-xl font-bold">{t("staff.login")}</h1>
          <input
            className="input"
            type="email"
            autoComplete="email"
            placeholder={t("staff.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder={t("staff.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button className="btn w-full" disabled={busy || !email || !password}>
            {t("staff.login")}
          </button>
        </form>
      </BrandShell>
    );

  const roles = staff.current?.roles ?? [];

  return (
    <BrandShell restaurant={staff.current?.restaurant ?? null} subtitle={t("staff.choose")}>
      <div className="space-y-3">
        {staff.memberships.length > 1 ? (
          <select
            className="input"
            value={staff.current?.restaurant.id}
            onChange={(e) => staff.select(e.target.value)}
          >
            {staff.memberships.map((m) => (
              <option key={m.restaurant.id} value={m.restaurant.id}>
                {m.restaurant.name}
              </option>
            ))}
          </select>
        ) : null}
        {!staff.current ? <p className="card">{t("staff.noRole")}</p> : null}
        {canUse("waiter", roles) ? (
          <Link href="/staff/waiter" className="btn w-full !py-5 text-lg">
            {t("staff.waiter")}
          </Link>
        ) : null}
        {canUse("kitchen", roles) ? (
          <Link href="/staff/kitchen" className="btn w-full !py-5 text-lg">
            {t("staff.kitchen")}
          </Link>
        ) : null}
        {canUse("manage", roles) ? (
          <Link href="/staff/manage" className="btn w-full !py-5 text-lg">
            {t("staff.manage")}
          </Link>
        ) : null}
        <button className="btn-ghost w-full" onClick={() => supabase().auth.signOut()}>
          {t("staff.logout")}
        </button>
      </div>
    </BrandShell>
  );
}
