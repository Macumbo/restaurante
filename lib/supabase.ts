import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Cliente Supabase do navegador (criado só quando é preciso, para o build não precisar das chaves). */
export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (ver .env.example)");
    }
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

/** Garante uma sessão: clientes entram como anónimos, sem registo. */
export async function ensureAnonymousSession() {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return signed.session;
}

/** Converte o código de erro das funções SQL numa chave de tradução. */
export function errorKey(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? "";
  const known = [
    "table_not_found",
    "session_not_open",
    "dish_unavailable",
    "invalid_modifier",
    "invalid_name",
    "forbidden",
    "invalid_transition",
    "session_not_pending",
  ];
  return known.find((k) => msg.includes(k)) ?? "generic";
}
