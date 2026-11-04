"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import { BrandShell, Spinner } from "@/components/ui";
import type { Restaurant, Role } from "@/lib/types";

type Membership = { restaurant: Restaurant; roles: Role[] };

export type StaffContext = {
  user: User;
  restaurant: Restaurant;
  roles: Role[];
  setRestaurant: (r: Restaurant) => void;
};

/** Carrega o utilizador da equipa e os restaurantes a que pertence. */
export function useStaff() {
  const [state, setState] = useState<{
    loading: boolean;
    user: User | null;
    memberships: Membership[];
    configError: boolean;
  }>({ loading: true, user: null, memberships: [], configError: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let sb;
    try {
      sb = supabase();
    } catch {
      setState({ loading: false, user: null, memberships: [], configError: true });
      return;
    }
    const load = async () => {
      const { data } = await sb.auth.getUser();
      const user = data.user && !data.user.is_anonymous ? data.user : null;
      if (!user) {
        setState({ loading: false, user: null, memberships: [], configError: false });
        return;
      }
      const { data: rows } = await sb
        .from("restaurant_members")
        .select("role, restaurants(*)")
        .eq("user_id", user.id);
      const map = new Map<string, Membership>();
      for (const row of (rows ?? []) as unknown as { role: Role; restaurants: Restaurant }[]) {
        const m = map.get(row.restaurants.id) ?? { restaurant: row.restaurants, roles: [] };
        m.roles.push(row.role);
        map.set(row.restaurants.id, m);
      }
      setState({ loading: false, user, memberships: [...map.values()], configError: false });
    };
    void load();
    try {
      setSelectedId(localStorage.getItem("staff_restaurant"));
    } catch {}
    const { data: sub } = sb.auth.onAuthStateChange(() => void load());
    return () => sub.subscription.unsubscribe();
  }, []);

  const current =
    state.memberships.find((m) => m.restaurant.id === selectedId) ?? state.memberships[0] ?? null;

  return {
    ...state,
    current,
    select: (id: string) => {
      setSelectedId(id);
      try {
        localStorage.setItem("staff_restaurant", id);
      } catch {}
    },
  };
}

const ROLE_SCREENS: Record<"waiter" | "kitchen" | "manage", Role[]> = {
  waiter: ["owner", "manager", "waiter"],
  kitchen: ["owner", "manager", "kitchen"],
  manage: ["owner", "manager"],
};

export function canUse(screen: keyof typeof ROLE_SCREENS, roles: Role[]) {
  return roles.some((r) => ROLE_SCREENS[screen].includes(r));
}

/** Protege um ecrã da equipa: pede login e verifica o papel. */
export function StaffGate({
  screen,
  title,
  children,
}: {
  screen: keyof typeof ROLE_SCREENS;
  title: string;
  children: (ctx: { restaurant: Restaurant; roles: Role[]; user: User }) => React.ReactNode;
}) {
  const { t } = useI18n();
  const staff = useStaff();

  if (staff.loading) return <BrandShell restaurant={null}><Spinner /></BrandShell>;
  if (staff.configError)
    return (
      <BrandShell restaurant={null}>
        <p className="card">{t("error.config")}</p>
      </BrandShell>
    );
  if (!staff.user || !staff.current || !canUse(screen, staff.current.roles))
    return (
      <BrandShell restaurant={staff.current?.restaurant ?? null}>
        <div className="card space-y-3">
          <p>{staff.user ? t("staff.noRole") : t("staff.login")}</p>
          <Link href="/staff" className="btn">
            {t("staff.choose")}
          </Link>
        </div>
      </BrandShell>
    );

  return (
    <BrandShell
      restaurant={staff.current.restaurant}
      subtitle={title}
      right={
        <Link href="/staff" className="rounded-lg border border-white/40 px-2 py-1 text-sm">
          ☰
        </Link>
      }
    >
      {children({ restaurant: staff.current.restaurant, roles: staff.current.roles, user: staff.user })}
    </BrandShell>
  );
}
