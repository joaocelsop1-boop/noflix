import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LiveCatalogue } from "@/components/live-catalogue";
import {
  categorySlug,
  fetchPanelCategories,
} from "@/lib/panel-categories";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = await findCategory(slug);
  return { title: found ? `${found.name} — CinePlus` : "Navegar — CinePlus" };
}

/**
 * /genre/<slug> agora é uma categoria DO PAINEL — nada de gênero TMDB.
 * O slug vem do nome limpo da categoria ("Amazon Prime Video" →
 * "amazon-prime-video"). Procura primeiro nas VOD, depois nas séries.
 * Sem correspondência, cai para o Navegar.
 */
async function findCategory(slug: string): Promise<{
  id: string;
  name: string;
  tab: "movie" | "series";
} | null> {
  const cookie = (await headers()).get("cookie");
  const [vod, series] = await Promise.all([
    fetchPanelCategories("movie", cookie),
    fetchPanelCategories("series", cookie),
  ]);
  for (const cat of vod) {
    if (categorySlug(cat.name) === slug || cat.slug === slug) {
      return { id: cat.id, name: cat.name, tab: "movie" };
    }
  }
  for (const cat of series) {
    if (categorySlug(cat.name) === slug || cat.slug === slug) {
      return { id: cat.id, name: cat.name, tab: "series" };
    }
  }
  return null;
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await findCategory(slug);
  if (!found) redirect("/browse");
  return (
    <LiveCatalogue
      initialCategory={{ id: found.id, tab: found.tab }}
      heading={found.name}
    />
  );
}
