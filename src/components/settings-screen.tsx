"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileAvatar } from "@/components/avatar";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { DeveloperPanel } from "@/components/developer-panel";
import { useStore } from "@/components/store";
import { ACCENTS, MATURITY, type MaturityLevel } from "@/lib/avatars";
import { PLAYERS, QUALITIES } from "@/lib/players";
import { cn } from "@/lib/cn";

const TABS = [
  { id: "profile", label: "Perfis" },
  { id: "appearance", label: "Aparência" },
  { id: "playback", label: "Reprodução" },
  { id: "privacy", label: "Privacidade e dados" },
  { id: "developer", label: "Desenvolvedor" },
  { id: "about", label: "About & legal" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { settings, updateSettings, resetSettings } = useStore();
  const [tab, setTab] = useState<TabId>((params.get("tab") as TabId) ?? "profile");

  useEffect(() => {
    const fromUrl = params.get("tab") as TabId | null;
    if (fromUrl && TABS.some((t) => t.id === fromUrl)) setTab(fromUrl);
  }, [params]);

  const select = (id: TabId) => {
    setTab(id);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  };

  return (
    <>
      <Navbar />
      <main className="min-h-screen pb-16 pt-24 md:pt-28">
        <div className="mx-auto max-w-[1180px] px-4 md:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nf-accent)]">
            Account
          </p>
          <h1 className="mt-1 font-display text-[clamp(1.7rem,4vw,2.7rem)] leading-none text-white">
            Settings
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/45">
            Deixe a CinePlus do seu jeito — cores, layout, reprodução e privacidade. Tudo é salvo neste
            device and, if you are signed in to the cloud, mirrored to your account.
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
            <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => select(entry.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-left text-[13px] transition lg:w-full",
                    tab === entry.id
                      ? "bg-white/10 font-semibold text-white"
                      : "text-white/55 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            <div className="min-w-0">
              {tab === "profile" && <ProfilesPanel />}
              {tab === "appearance" && <AppearancePanel />}
              {tab === "playback" && <PlaybackPanel />}
              {tab === "privacy" && <PrivacyPanel />}
              {tab === "developer" && <DeveloperPanel />}
              {tab === "about" && <AboutPanel />}
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between border-t border-white/10 pt-5">
            <p className="text-[11.5px] text-white/35">
              CinePlus v1.1 · preferências guardadas localmente
            </p>
            <button
              type="button"
              onClick={() => {
                resetSettings();
              }}
              className="text-[11.5px] text-white/45 underline-offset-4 transition hover:text-white hover:underline"
            >
              Reset appearance &amp; playback
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ------------------------------------------------------------------ profiles */

function ProfilesPanel() {
  const { profiles, profile, updateProfile, removeProfile, setProfile } = useStore();
  const router = useRouter();
  const [name, setName] = useState(profile?.name ?? "");

  useEffect(() => setName(profile?.name ?? ""), [profile?.id, profile?.name]);

  if (!profile) {
    return (
      <Panel title="Nenhum perfil selecionado" hint="Escolha um perfil para editá-lo.">
        <button
          type="button"
          onClick={() => setProfile(null)}
          className="rounded-md bg-[var(--nf-accent)] px-4 py-2 text-[13px] font-semibold text-white"
        >
          Choose a profile
        </button>
      </Panel>
    );
  }

  const saveName = () => {
    const next = name.trim().slice(0, 18);
    if (next && next !== profile.name) updateProfile(profile.id, { name: next });
  };

  return (
    <div className="space-y-5">
      <Panel title="Este perfil" hint="Seu nome, personagem e o que você pode assistir.">
        <div className="flex flex-col gap-5 sm:flex-row">
          <ProfileAvatar
            avatar={profile.avatar}
            accent={profile.accent}
            className="h-24 w-24 shrink-0"
            rounded="rounded-xl"
            kids={profile.maturity === "kids"}
          />
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <Field label="Nome do perfil">
                <input
                  value={name}
                  maxLength={18}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={saveName}
                  onKeyDown={(event) => event.key === "Enter" && saveName()}
                  className="w-full max-w-xs rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--nf-accent)]"
                />
              </Field>
            </div>

            <Field label="Cor">
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((colour) => (
                  <button
                    key={colour.id}
                    type="button"
                    aria-label={colour.label}
                    onClick={() => updateProfile(profile.id, { accent: colour.value })}
                    className={cn(
                      "h-7 w-7 rounded-full transition",
                      profile.accent === colour.value
                        ? "ring-2 ring-white ring-offset-2 ring-offset-[#141414]"
                        : "hover:scale-110",
                    )}
                    style={{ background: colour.value }}
                  />
                ))}
                <label className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/20 px-2.5 text-[11px] text-white/60">
                  Custom
                  <input
                    type="color"
                    value={profile.accent}
                    onChange={(event) => updateProfile(profile.id, { accent: event.target.value })}
                    className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                </label>
              </div>
            </Field>

            <Field label="Classificação etária">
              <div className="flex flex-wrap gap-2">
                {MATURITY.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    onClick={() =>
                      updateProfile(profile.id, {
                        maturity: level.id as MaturityLevel,
                        kids: level.id === "kids",
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px] transition",
                      profile.maturity === level.id
                        ? "border-white bg-white text-black"
                        : "border-white/20 text-white/70 hover:border-white/50 hover:text-white",
                    )}
                    title={level.hint}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/35">
                {MATURITY.find((m) => m.id === profile.maturity)?.hint}
              </p>
            </Field>

            <ToggleRow
              title="Autoplay previews"
              hint="Trailers tocam automaticamente enquanto navega"
              value={profile.autoplay}
              onChange={(value) => updateProfile(profile.id, { autoplay: value })}
            />
          </div>
        </div>
      </Panel>

      <Panel title="All profiles" hint="Troque de perfil ou gerencie todos desta conta.">
        <div className="space-y-2">
          {profiles.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2"
            >
              <ProfileAvatar
                avatar={item.avatar}
                accent={item.accent}
                className="h-9 w-9"
                rounded="rounded-md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-white/90">
                  {item.name}
                  {item.id === profile.id && (
                    <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/60">
                      Current
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-white/35">
                  {MATURITY.find((m) => m.id === item.maturity)?.label} ·{" "}
                  {item.autoplay ? "autoplay on" : "autoplay off"}
                </p>
              </div>
              {item.id !== profile.id && (
                <button
                  type="button"
                  onClick={() => {
                    setProfile(item);
                    router.push("/");
                  }}
                  className="rounded border border-white/20 px-2.5 py-1 text-[11px] text-white/75 transition hover:border-white hover:text-white"
                >
                  Switch
                </button>
              )}
              {profiles.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeProfile(item.id)}
                  className="rounded px-2 py-1 text-[11px] text-white/40 transition hover:text-[#ff5c5c]"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setProfile(null);
            router.push("/");
          }}
          className="mt-4 rounded-md border border-white/20 px-4 py-2 text-[12.5px] text-white/80 transition hover:border-white hover:text-white"
        >
          Manage profiles &amp; add another
        </button>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- appearance */

function AppearancePanel() {
  const { settings, updateSettings, profile, updateProfile } = useStore();

  return (
    <div className="space-y-5">
      <Panel title="Accent colour" hint="Botões, destaques e anéis de foco em todo o site.">
        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENTS.map((colour) => (
            <button
              key={colour.id}
              type="button"
              aria-label={colour.label}
              onClick={() => updateSettings({ accent: colour.value })}
              className={cn(
                "h-9 w-9 rounded-full transition",
                settings.accent === colour.value
                  ? "ring-2 ring-white ring-offset-2 ring-offset-[#141414]"
                  : "hover:scale-105",
              )}
              style={{ background: colour.value }}
            />
          ))}
          <label className="inline-flex h-9 items-center gap-2 rounded-full border border-white/20 px-3 text-[12px] text-white/65">
            Custom
            <input
              type="color"
              value={settings.accent}
              onChange={(event) => updateSettings({ accent: event.target.value })}
              className="h-5 w-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-[var(--nf-accent)] px-4 py-2 text-[13px] font-semibold text-white"
          >
            Play
          </button>
          <span className="text-[12.5px] text-white/55">Live preview of your accent</span>
        </div>
      </Panel>

      <Panel title="Tamanho do cartão" hint="O tamanho dos pôsteres em cada prateleira e grade.">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "compact", label: "Compacto", hint: "Mais títulos de uma vez" },
              { id: "cozy", label: "Aconchegante", hint: "Balanced" },
              { id: "large", label: "Grande", hint: "Arte maior" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateSettings({ density: option.id })}
              className={cn(
                "rounded-lg border px-2 py-3 text-center transition",
                settings.density === option.id
                  ? "border-white bg-white/[0.08]"
                  : "border-white/12 hover:border-white/35",
              )}
            >
              <span className="block text-[13px] text-white">{option.label}</span>
              <span className="block text-[10.5px] text-white/40">{option.hint}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Movimento e interação">
        <div className="space-y-3">
          <ToggleRow
            title="Reduzir movimento"
            hint="Desvanecimento em vez de deslizar; ótimo para celulares mais antigos"
            value={settings.reduceMotion}
            onChange={(value) => updateSettings({ reduceMotion: value })}
          />
          <ToggleRow
            title="Prévias ao passar o mouse"
            hint="Expande um cartão ao passar o mouse (só no computador)"
            value={settings.hoverPreviews}
            onChange={(value) => updateSettings({ hoverPreviews: value })}
          />
          <ToggleRow
            title="Economia de dados"
            hint="Menos fileiras e arte menor em conexões lentas"
            value={settings.dataSaver}
            onChange={(value) => updateSettings({ dataSaver: value })}
          />
          <ToggleRow
            title="Autoplay trailers"
            hint="Prévias começam sozinhas"
            value={settings.autoplayTrailers}
            onChange={(value) => updateSettings({ autoplayTrailers: value })}
          />
        </div>
      </Panel>

      {profile && (
        <Panel title="Cor do perfil" hint="Define o anel ao redor do seu avatar em todos os lugares.">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((colour) => (
              <button
                key={colour.id}
                type="button"
                aria-label={colour.label}
                onClick={() => updateProfile(profile.id, { accent: colour.value })}
                className={cn(
                  "h-8 w-8 rounded-full transition",
                  profile.accent === colour.value
                    ? "ring-2 ring-white ring-offset-2 ring-offset-[#141414]"
                    : "hover:scale-105",
                )}
                style={{ background: colour.value }}
              />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ playback */

function PlaybackPanel() {
  const { settings, updateSettings } = useStore();

  return (
    <div className="space-y-5">
      <Panel
        title="Servidor padrão"
        hint="A CinePlus troca automaticamente se um servidor parar de responder — este é só o ponto de partida."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {PLAYERS.map((server) => (
            <button
              key={server.id}
              type="button"
              onClick={() => updateSettings({ defaultPlayer: server.id })}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                settings.defaultPlayer === server.id
                  ? "border-white bg-white/[0.08]"
                  : "border-white/12 hover:border-white/35",
              )}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
                {server.label}
                {server.badge && (
                  <span className="rounded bg-[var(--nf-accent)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white">
                    {server.badge}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-white/40">{server.hint}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Qualidade e idioma">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Qualidade preferida">
            <select
              value={settings.quality}
              onChange={(event) =>
                updateSettings({ quality: event.target.value as (typeof QUALITIES)[number] })
              }
              className="w-full rounded-md border border-white/15 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[var(--nf-accent)]"
            >
              {QUALITIES.map((quality) => (
                <option key={quality} value={quality}>
                  {quality.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Idioma preferido">
            <select
              value={settings.language}
              onChange={(event) => updateSettings({ language: event.target.value })}
              className="w-full rounded-md border border-white/15 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[var(--nf-accent)]"
            >
              {["Inglês", "Urdu", "Hindi", "Arabic", "Espanhol", "Francês", "Japonês", "Coreano"].map(
                (language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ),
              )}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel
        title="Anime audio"
        hint="VidNest, AniEmbed and CineLite's anime route all follow this."
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "sub", label: "Legendado", hint: "Áudio em japonês, legendas" },
              { id: "dub", label: "Dublado", hint: "Faixa de áudio em inglês" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateSettings({ animeAudio: option.id })}
              className={cn(
                "rounded-lg border px-3 py-3 text-left transition",
                settings.animeAudio === option.id
                  ? "border-white bg-white/[0.08]"
                  : "border-white/12 hover:border-white/35",
              )}
            >
              <span className="block text-[13px] text-white">{option.label}</span>
              <span className="block text-[11px] text-white/40">{option.hint}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Comportamento de reprodução">
        <ToggleRow
          title="Autoplay next episode"
          hint="As séries continuam sem você tocar em nada"
          value={settings.autoplayNext}
          onChange={(value) => updateSettings({ autoplayNext: value })}
        />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------- privacy */

function PrivacyPanel() {
  const { settings, updateSettings, clearEverything, myList, progress } = useStore();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const synced = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const exportData = () => {
    const payload: Record<string, unknown> = {};
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith("nf.")) payload[key] = window.localStorage.getItem(key);
      }
    } catch {
      /* ignore */
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "noflix-data.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Panel title="Filtros de conteúdo" hint="Applies to every shelf, grid and search result.">
        <ToggleRow
          title="Ocultar títulos adultos"
          hint="Hides 16+, R and TV-MA titles from browsing"
          value={settings.hideMature}
          onChange={(value) => updateSettings({ hideMature: value })}
        />
        <p className="mt-3 text-[11.5px] leading-relaxed text-white/35">
          Kids profiles always hide mature titles, whatever this switch says.
        </p>
      </Panel>

      <Panel title="Seus dados" hint="Você é dono de tudo que a CinePlus guarda sobre você.">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Minha Lista" value={`${myList.length} titles`} />
          <Stat label="Histórico de exibição" value={`${Object.keys(progress).length} titles`} />
          <Stat label="Sincronização na nuvem" value={synced ? "Connected" : "Somente local"} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportData}
            className="rounded-md border border-white/20 px-3 py-2 text-[12.5px] text-white/80 transition hover:border-white hover:text-white"
          >
            Export my data
          </button>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border border-[#ff5c5c]/40 px-3 py-2 text-[12.5px] text-[#ff8080] transition hover:bg-[#ff5c5c]/10"
            >
              Delete everything
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 rounded-md border border-[#ff5c5c]/40 px-3 py-2 text-[12.5px] text-white/80">
              Delete all profiles, My List and history?
              <button
                type="button"
                onClick={() => {
                  clearEverything();
                  setConfirming(false);
                  router.push("/");
                }}
                className="rounded bg-[#ff5c5c] px-2 py-1 text-[11.5px] font-semibold text-black"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-[11.5px] text-white/50 hover:text-white"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </Panel>

      <Panel title="Privacidade em resumo">
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-white/55">
          <li>· No accounts, no passwords, no advertising trackers.</li>
          <li>· Profiles, My List and progress live in your browser; cloud sync is optional.</li>
          <li>· Playback is handled by third-party embeds — they see your IP, we don&apos;t.</li>
          <li>
            · Read the{" "}
            <Link href="/privacy" className="text-[var(--nf-accent)] hover:underline">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="text-[var(--nf-accent)] hover:underline">
              terms
            </Link>
            .
          </li>
        </ul>
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------------- about */

function AboutPanel() {
  const links = [
    { href: "/about", label: "Sobre a CinePlus", hint: "O que é isto e como funciona" },
    { href: "/privacy", label: "Política de privacidade", hint: "O que é guardado e onde" },
    { href: "/terms", label: "Termos de uso", hint: "As regras de uso" },
    { href: "/dmca", label: "Direitos autorais e DMCA", hint: "Informações de remoção" },
  ];

  return (
    <div className="space-y-5">
      <Panel title="CinePlus" hint="Um front-end de streaming feito com Next.js, TMDB e players de terceiros.">
        <p className="text-[13px] leading-relaxed text-white/55">
          A CinePlus não hospeda nenhum vídeo. É um catálogo e um player: artes e metadados
          vêm do TMDB, e a reprodução acontece dentro de players incorporados operados por terceiros. Se
          gostar de algo que encontrar aqui, assista no serviço que o produziu.
        </p>
        <p className="mt-3 text-[11.5px] text-white/30">
          Build {process.env.NEXT_PUBLIC_BUILD_ID ?? "local"} ·{" "}
          {process.env.NEXT_PUBLIC_BUILD_TIME
            ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleDateString()
            : "dev"}
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-2">
        {links.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:border-white/30"
          >
            <span className="block text-[13px] text-white">{entry.label}</span>
            <span className="block text-[11px] text-white/40">{entry.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- bits */

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      {hint && <p className="mt-0.5 mb-4 text-[12px] text-white/40">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-[13px] text-white/90">{title}</p>
        <p className="text-[11px] text-white/35">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={title}
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition",
          value ? "bg-[var(--nf-accent)]" : "bg-white/20",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
            value ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-white/35">{label}</p>
      <p className="mt-0.5 text-[13px] text-white/85">{value}</p>
    </div>
  );
}
