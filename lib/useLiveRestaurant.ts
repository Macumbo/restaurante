"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DiningTable, Order, Participant, TableSession } from "@/lib/types";

/** Sessões abertas, pedidos ativos, mesas e participantes de um restaurante, em tempo real. */
export function useLiveRestaurant(restaurantId: string) {
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const load = useCallback(async () => {
    const sb = supabase();
    const [s, o, t] = await Promise.all([
      sb
        .from("table_sessions")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("status", ["pending", "confirmed"])
        .order("opened_at"),
      sb
        .from("orders")
        .select("*, order_items(*)")
        .eq("restaurant_id", restaurantId)
        .in("status", ["pending_approval", "approved", "preparing", "ready"])
        .order("created_at"),
      sb.from("dining_tables").select("*").eq("restaurant_id", restaurantId),
    ]);
    const sessionIds = (s.data ?? []).map((x) => x.id);
    const p = sessionIds.length
      ? await sb.from("session_participants").select("*").in("session_id", sessionIds)
      : { data: [] };
    setSessions((s.data ?? []) as TableSession[]);
    setOrders((o.data ?? []) as Order[]);
    setTables((t.data ?? []) as DiningTable[]);
    setParticipants((p.data ?? []) as Participant[]);
  }, [restaurantId]);

  useEffect(() => {
    void load();
    const sb = supabase();
    const channel = sb
      .channel(`restaurant-${restaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "table_sessions", filter: `restaurant_id=eq.${restaurantId}` },
        () => void load(),
      )
      .subscribe();
    // Recarrega periodicamente, caso a ligação em tempo real caia (rede móvel)
    const poll = setInterval(() => void load(), 30000);
    return () => {
      clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [restaurantId, load]);

  const tableLabel = (session: TableSession | undefined) =>
    tables.find((t) => t.id === session?.table_id)?.label ?? "?";
  const sessionOf = (order: Order) => sessions.find((s) => s.id === order.session_id);
  const personName = (participantId: string) =>
    participants.find((p) => p.id === participantId)?.display_name ?? "";

  return { sessions, orders, tables, participants, reload: load, tableLabel, sessionOf, personName };
}

/** Aviso sonoro curto quando chega algo novo (garçom e cozinha). */
export function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {}
}
