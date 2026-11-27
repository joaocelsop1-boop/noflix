/**
 * Cliente do painel do revendedor (/api/panel/*).
 *
 * As rotas são servidas por outro agente — este arquivo só codifica o
 * contrato combinado (ver tarefa): /api/panel/me, login, logout, register,
 * plans, catalog, info, epg, order e order-status. Nada aqui toca no
 * backend PHP nem nas rotas de API do servidor.
 */

export type PanelUser = {
  id: number;
  name: string;
  email: string;
  plan_id?: number | null;
  plan_name?: string | null;
  expires_at?: string | null;
  status?: string | null;
};

export type PanelMe = {
  loggedIn: boolean;
  user: PanelUser | null;
  canWatch: boolean;
};

export type PanelPlan = {
  id: number;
  name: string;
  price: number;
  duration_days: number;
  is_recommended?: boolean | number;
};

export type PanelOrder = {
  ok: boolean;
  success?: boolean;
  mode?: string;
  order_id?: number | string;
  pix_code?: string;
  pix_qr_url?: string;
  amount?: number;
  plan_name?: string;
  /** Pix fixo (manual): chave, copia e cola, QR e beneficiário do admin */
  pix_key?: string | null;
  pix_fixed_code?: string | null;
  pix_fixed_qr?: string | null;
  pix_beneficiary?: string | null;
  error?: string;
};

export type PanelOrderStatus = {
  status: "pending" | "approved" | "cancelled";
  [key: string]: unknown;
};

/** Item cru do painel, normalizado para a grade (filme/série/canal). */
export type PanelCatalogItem = {
  id: number;
  name: string;
  type: "movie" | "series" | "live";
  logo?: string;
  poster?: string;
  backdrop?: string;
  category?: string;
  category_id?: number | string;
  ext?: string;
  year?: number;
  plot?: string;
  /** campos crus preservados para a página de detalhe */
  raw: Record<string, unknown>;
};

export type PanelEpgProgramme = {
  title: string;
  start?: string;
  stop?: string;
  description?: string;
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length ? value : undefined;

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Normaliza o array cru do painel: o painel devolve chaves variadas
 * (stream_id/id, stream_display_name/name, stream_icon/logo...). Aceita
 * qualquer uma delas e devolve um formato único para a UI.
 */
export function normalizePanelItem(raw: Record<string, unknown>, kind: "movie" | "series" | "live"): PanelCatalogItem {
  const id = num(raw.stream_id ?? raw.id) ?? 0;
  const name =
    str(raw.stream_display_name ?? raw.name ?? raw.title) ?? `Canal ${id || "?"}`;
  return {
    id,
    name,
    type: kind,
    logo: str(raw.stream_icon ?? raw.logo ?? raw.icon ?? raw.poster),
    poster: str(raw.cover ?? raw.poster ?? raw.stream_icon),
    backdrop: str(raw.backdrop),
    category: str(raw.category_name ?? raw.category),
    category_id: (raw.category_id as number | string | undefined) ?? undefined,
    ext: str(raw.container_extension ?? raw.ext),
    year: num(raw.year ?? raw.release_date),
    plot: str(raw.plot ?? raw.description ?? raw.overview),
    raw,
  };
}

export function normalizePanelCatalog(
  data: unknown,
  kind: "movie" | "series" | "live",
): PanelCatalogItem[] {
  // A rota /api/panel/catalog devolve { ok, items, total } (objeto), não
  // um array direto — aceita os dois formatos.
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items)
      ? ((data as Record<string, unknown>).items as unknown[])
      : [];
  return list
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => normalizePanelItem(entry, kind));
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchPanelMe(): Promise<PanelMe | null> {
  try {
    const res = await fetch("/api/panel/me", { cache: "no-store" });
    if (!res.ok) return null;
    return await readJson<PanelMe>(res);
  } catch {
    return null;
  }
}

export async function panelLogin(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string; user?: PanelUser; canWatch?: boolean }> {
  const res = await fetch("/api/panel/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    // Sem timeout o botão ficava em "Aguarde…" para sempre quando a rede
    // falhava — o usuário achava que nada tinha acontecido.
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await readJson<{ ok: boolean; error?: string; user?: PanelUser; canWatch?: boolean }>(res)) ?? { ok: false };
  if (!res.ok && !data.error) return { ok: false, error: "Não foi possível entrar. Tente novamente." };
  return data;
}

export async function panelRegister(input: {
  name: string;
  email: string;
  password: string;
  whatsapp?: string;
}): Promise<{ ok: boolean; error?: string; user?: PanelUser }> {
  const res = await fetch("/api/panel/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await readJson<{ ok: boolean; error?: string; user?: PanelUser }>(res)) ?? { ok: false };
  if (!res.ok && !data.error) return { ok: false, error: "Não foi possível criar a conta. Tente novamente." };
  return data;
}

export async function panelLogout(): Promise<void> {
  try {
    await fetch("/api/panel/logout", { method: "POST" });
  } catch {
    /* sair localmente mesmo se a rota falhar */
  }
}

export async function fetchPanelPlans(): Promise<PanelPlan[]> {
  const res = await fetch("/api/panel/plans", { cache: "no-store" });
  const data = (await readJson<{ plans?: PanelPlan[] } | PanelPlan[]>(res)) ?? {};
  return Array.isArray(data) ? data : data.plans ?? [];
}

export async function fetchPanelCatalog(
  kind: "movie" | "series" | "live",
  opts?: { category_id?: string; limit?: number; offset?: number },
): Promise<PanelCatalogItem[]> {
  const params = new URLSearchParams({ kind });
  if (opts?.category_id) params.set("category_id", opts.category_id);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const res = await fetch(`/api/panel/catalog?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  return normalizePanelCatalog(await readJson(res), kind);
}

export async function fetchPanelInfo(
  type: "movie" | "series",
  id: number,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`/api/panel/info?type=${type}&id=${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return await readJson<Record<string, unknown>>(res);
}

export async function fetchPanelEpg(streamId: number): Promise<PanelEpgProgramme[]> {
  try {
    const res = await fetch(`/api/panel/epg?stream_id=${streamId}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await readJson<unknown>(res)) as
      | { programmes?: unknown[]; epg?: unknown[] }
      | unknown[]
      | null;
    const list = Array.isArray(data) ? data : data?.programmes ?? data?.epg ?? [];
    return list
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        title: str(entry.title ?? entry.name) ?? "Programação",
        start: str(entry.start),
        stop: str(entry.stop),
        description: str(entry.description ?? entry.desc),
      }));
  } catch {
    return [];
  }
}

export async function createPanelOrder(
  planId: number,
  whatsapp?: string,
): Promise<PanelOrder> {
  const res = await fetch("/api/panel/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan_id: planId, whatsapp: whatsapp || undefined }),
  });
  const raw = (await readJson<Record<string, unknown>>(res)) ?? {};
  // O PHP responde {success, message, ...} e o front esperava {ok, error}:
  // sem esta normalização o pedido SEMPRE parecia falhar (ok undefined) e
  // o QR nunca aparecia — mesmo com o token válido. Mapeia os dois formatos.
  const data = raw as PanelOrder & { success?: boolean; message?: string };
  const ok = data.ok ?? data.success ?? false;
  if (!res.ok && !data.error && !data.message) {
    return { ok: false, error: "Não foi possível criar o pedido. Tente novamente." };
  }
  return {
    ...data,
    ok: Boolean(ok),
    error: data.error ?? (typeof data.message === "string" ? data.message : undefined),
  };
}

export async function fetchPanelOrderStatus(
  orderId: number | string,
): Promise<PanelOrderStatus | null> {
  try {
    const res = await fetch(`/api/panel/order-status?order_id=${orderId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await readJson<PanelOrderStatus>(res);
  } catch {
    return null;
  }
}

export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "2026-12-14T..." -> "14/12/2026"; devolve o texto cru se não for data. */
export function formatDateBR(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}
