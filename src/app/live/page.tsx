"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { PlayIcon } from "@/components/icons";
import {
  fetchPanelCatalog,
  fetchPanelEpg,
  fetchPanelMe,
  type PanelCatalogItem,
  type PanelEpgProgramme,
} from "@/lib/panel";
import { cn } from "@/lib/cn";

/**
 * Canais ao vivo do painel: filtro por categoria + grade com logo/nome/
 * categoria. Clicar num canal mostra a programação (EPG) e o botão
 * "Assistir agora", que abre o player próprio com o canal (panel live).
 * Sem login, redireciona para /login.
 */
export default function LivePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [channels, setChannels] = useState<PanelCatalogItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<PanelCatalogItem | null>(null);
  const [epg, setEpg] = useState<PanelEpgProgramme[]>([]);
  const [epgLoading, setEpgLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchPanelMe().then((me) => {
      if (!alive) return;
      if (!me?.loggedIn) {
        router.replace("/login");
        return;
      }
      setChecking(false);
      void fetchPanelCatalog("live", { limit: 500 })
        .then((items) => {
          if (alive) setChannels(items);
        })
        .catch(() => {
          if (alive) setLoadError("Não foi possível carregar os canais. Tente novamente.");
        });
    });
    return () => {
      alive = false;
    };
  }, [router]);

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const channel of channels) {
      const key = channel.category ?? "Outros";
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [channels]);

  const visible = useMemo(
    () =>
      category === "all"
        ? channels
        : channels.filter((c) => (c.category ?? "Outros") === category),
    [channels, category],
  );

  const selectChannel = (channel: PanelCatalogItem) => {
    setSelected(channel);
    setEpg([]);
    setEpgLoading(true);
    void fetchPanelEpg(channel.id).then((programmes) => {
      setEpg(programmes);
      setEpgLoading(false);
    });
  };

  const watch = (channel: PanelCatalogItem) => {
    const params = new URLSearchParams({
      panel: "1",
      type: "live",
      id: String(channel.id),
      title: channel.name,
    });
    if (channel.ext) params.set("ext", channel.ext);
    router.push(`/play/0?${params.toString()}`);
  };

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-black">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-[#e50914]" />
      </main>
    );
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-black pb-16 pt-24 md:pt-28">
        <div className="mx-auto max-w-[1500px] px-4 md:px-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e50914]">
            Ao vivo · MineTV
          </p>
          <h1 className="mt-1 font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-none text-white">
            Canais ao vivo
          </h1>
          <p className="mt-2 max-w-[60ch] text-[12.5px] text-white/50">
            {channels.length > 0
              ? `${channels.length} canais no ar — escolha um canal para ver a programação e assistir.`
              : "Carregando os canais…"}
          </p>

          {loadError && (
            <p role="alert" className="mt-6 rounded-md border border-[#e50914]/40 bg-[#e50914]/10 px-3 py-2 text-sm text-[#ff6b72]">
              {loadError}
            </p>
          )}

          {/* filtro por categoria */}
          {categories.length > 0 && (
            <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
              <button
                type="button"
                onClick={() => setCategory("all")}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition",
                  category === "all"
                    ? "border-white bg-white text-black"
                    : "border-white/20 text-white/70 hover:border-white/50 hover:text-white",
                )}
              >
                Todos
              </button>
              {categories.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCategory(name)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition",
                    category === name
                      ? "border-white bg-white text-black"
                      : "border-white/20 text-white/70 hover:border-white/50 hover:text-white",
                  )}
                >
                  {name} · {count}
                </button>
              ))}
            </div>
          )}

          {/* programação do canal selecionado */}
          {selected && (
            <section className="mt-6 rounded-xl border border-white/10 bg-[#141414] p-5">
              <div className="flex flex-wrap items-center gap-4">
                {selected.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.logo}
                    alt=""
                    className="h-12 w-12 rounded-md bg-white/10 object-contain p-1"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#e50914]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#e50914]" />
                    Ao vivo agora
                  </p>
                  <h2 className="truncate text-lg font-bold text-white">{selected.name}</h2>
                  {selected.category && (
                    <p className="text-xs text-white/45">{selected.category}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => watch(selected)}
                  className="flex items-center gap-2 rounded-md bg-[#e50914] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#f6121d]"
                >
                  <PlayIcon width={13} height={13} />
                  Assistir agora
                </button>
              </div>

              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
                  Programação
                </p>
                {epgLoading ? (
                  <p className="mt-2 text-[13px] text-white/50">Carregando programação…</p>
                ) : epg.length === 0 ? (
                  <p className="mt-2 text-[13px] text-white/50">
                    Sem programação informada para este canal.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {epg.slice(0, 8).map((programme, index) => (
                      <li key={index} className="flex items-baseline gap-3 text-[13px]">
                        <span className="shrink-0 tabular-nums text-white/45">
                          {programme.start ?? ""}
                          {programme.stop ? ` – ${programme.stop}` : ""}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-white/90">
                            {programme.title}
                          </span>
                          {programme.description && (
                            <span className="block truncate text-xs text-white/40">
                              {programme.description}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* grade de canais */}
          <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7">
            {visible.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => selectChannel(channel)}
                aria-pressed={selected?.id === channel.id}
                className={cn(
                  "group relative overflow-hidden rounded-[6px] bg-[#1b1b1b] text-left ring-1 transition duration-200 hover:z-10 hover:ring-white/40",
                  selected?.id === channel.id ? "ring-[#e50914]" : "ring-white/5",
                )}
              >
                <span className="relative grid aspect-[16/9] w-full place-items-center overflow-hidden bg-[#101010] p-3">
                  {channel.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={channel.logo}
                      alt={channel.name}
                      loading="lazy"
                      decoding="async"
                      className="max-h-full max-w-full object-contain transition duration-300 group-hover:scale-[1.05]"
                    />
                  ) : (
                    <span className="text-center text-[11px] font-semibold text-white/60">
                      {channel.name}
                    </span>
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                    <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-black/40 text-white">
                      <PlayIcon width={12} height={12} />
                    </span>
                  </span>
                  <span className="absolute left-1 top-1 flex items-center gap-1 rounded-sm bg-[#e50914] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    Live
                  </span>
                </span>
                <span className="block px-2 pb-2 pt-1.5">
                  <span className="block truncate text-[11px] font-medium leading-tight text-white/90">
                    {channel.name}
                  </span>
                  {channel.category && (
                    <span className="mt-0.5 block truncate text-[9.5px] text-white/45">
                      {channel.category}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {!loadError && visible.length === 0 && channels.length > 0 && (
            <p className="mt-8 text-center text-sm text-white/50">
              Nenhum canal nesta categoria.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
