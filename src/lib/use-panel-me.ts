"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPanelMe, type PanelMe } from "@/lib/panel";

/** Estado da sessão do painel, partilhado por navbar, gate e páginas. */
export function usePanelMe() {
  const [me, setMe] = useState<PanelMe | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchPanelMe();
    setMe(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { me, loading, refresh };
}
