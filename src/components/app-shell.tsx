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
import { ChatIcon } from "@/components/icons";
import { supportUrl } from "@/lib/support";
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
  const url = supportUrl(me?.support?.whatsapp, me?.support?.telegram);
  if (!url || modalOpen || isSupportFloatHidden(pathname, isFullscreen)) return null;
  const isWhatsApp = url.includes("wa.me");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="Falar com o suporte"
      title="Falar com o suporte"
      className="fixed bottom-5 right-5 z-[130] grid h-14 w-14 place-items-center rounded-full shadow-2xl transition-transform hover:scale-105"
      style={{
        backgroundColor: isWhatsApp ? "#25d366" : "#229ED9",
        color: isWhatsApp ? "#06281a" : "#fff",
      }}
    >
      <ChatIcon width={26} height={26} />
    </a>
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
