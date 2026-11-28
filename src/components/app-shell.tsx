"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileGate } from "@/components/profile-gate";
import { TitleModal } from "@/components/title-modal";
import { SearchOverlay } from "@/components/search-overlay";
import { SoundNotice } from "@/components/sound-notice";
import { CloudSync } from "@/components/cloud-sync";
import { useStore } from "@/components/store";
import { ChatIcon, CloseIcon } from "@/components/icons";
import { supportOptions } from "@/lib/support";
import { isSupportFloatHidden } from "@/lib/support-float";
import { usePanelMe } from "@/lib/use-panel-me";

/* tudo26: botão flutuante de suporte — SEMPRE visível, em todas as
   páginas (o botão ficava escondido dentro do menu do perfil, atrás de
   um clique). Só aparece quando há contato preenchido no admin (regra
   atual — não inventa contato): WhatsApp verde, Telegram azul. */
function SupportFloat() {
  const { me } = usePanelMe();
  const pathname = usePathname();
  /* tudo33 (b): some também quando um modal/overlay está aberto (detalhe
     do título ou busca) — o flutuante (z-130) fica POR CIMA do modal
     (z-80) e cobre o botão de fechar / o play. O estado vem da store,
     não só do pathname: o player vive em rota (/play, /watch), mas o
     modal abre sem trocar a rota. */
  const { activeSlug, searchOpen } = useStore();
  const modalOpen = Boolean(activeSlug) || searchOpen;
  /* tudo32: some no player e em tela cheia (ver isSupportFloatHidden). */
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(document.fullscreenElement));
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  /* tudo34: o botão abre um menu com as DUAS opções (WhatsApp e Telegram)
     — o cliente escolhe qual quer usar. Só entram as configuradas no admin
     (support_whatsapp / support_telegram); sem nenhuma, o botão não aparece.
     O comportamento de sumir continua igual (tudo33): some no player, com
     modal/busca abertos e em tela cheia. */
  const options = supportOptions(me?.support?.whatsapp, me?.support?.telegram);
  const hidden =
    options.length === 0 || modalOpen || isSupportFloatHidden(pathname, isFullscreen);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (hidden) setMenuOpen(false);
  }, [hidden]);
  if (hidden) return null;
  return (
    <>
      {menuOpen && (
        <button
          type="button"
          aria-label="Fechar menu de suporte"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-[129] cursor-default"
        />
      )}
      {menuOpen && (
        <div className="fixed bottom-24 right-5 z-[130] w-60 rounded-2xl border border-white/10 bg-[#141414]/98 p-2 shadow-2xl backdrop-blur-xl">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            Falar com o suporte
          </p>
          {options.map((opt) => (
            <a
              key={opt.kind}
              href={opt.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
              className="mt-1 flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-bold text-white transition hover:brightness-110 active:scale-[0.99]"
              style={{
                backgroundColor: opt.kind === "whatsapp" ? "#25d366" : "#229ED9",
                color: opt.kind === "whatsapp" ? "#06281a" : "#fff",
              }}
            >
              <ChatIcon width={20} height={20} />
              {opt.label}
            </a>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? "Fechar menu de suporte" : "Falar com o suporte"}
        aria-expanded={menuOpen}
        title="Falar com o suporte"
        className="fixed bottom-5 right-5 z-[130] grid h-14 w-14 place-items-center rounded-full bg-[#e50914] text-white shadow-2xl transition-transform hover:scale-105"
      >
        {menuOpen ? <CloseIcon width={24} height={24} /> : <ChatIcon width={26} height={26} />}
      </button>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hydrated, profile, setProfile, toasts } = useStore();
  const pathname = usePathname();
  // O portão de perfis NUNCA pode cobrir a tela de login: sem perfil local
  // salvo, ele aparecia por cima do formulário e o usuário não conseguia
  // nem digitar e-mail e senha (o login parecia não funcionar).
  const showProfileGate = hydrated && !profile && pathname !== "/login";
  return (
    <>
      {children}

      <CloudSync />

      <AnimatePresence>
        {showProfileGate && (
          <ProfileGate
            onPick={(picked) => setProfile(picked)}
          />
        )}
      </AnimatePresence>

      <SupportFloat />

      <SoundNotice />
      <TitleModal />
      <SearchOverlay />

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="rounded-md border border-white/10 bg-[#1f1f1f]/95 px-5 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur"
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
