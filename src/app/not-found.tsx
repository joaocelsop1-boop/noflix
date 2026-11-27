import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { appUrl } from "@/lib/paths";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#0f1220] px-6 text-center">
      <div>
        <Wordmark className="mx-auto text-3xl" />
        <h1 className="mt-10 text-4xl font-semibold text-white md:text-6xl">
          Se perdeu?
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/55">
          Desculpe, não encontramos essa página. Você vai encontrar muita coisa para explorar na página inicial.
        </p>
        <Link
          href={appUrl("/")}
          className="mt-8 inline-flex rounded bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/85"
        >
          Início CinePlus
        </Link>
        <p className="mt-10 text-xs uppercase tracking-[0.3em] text-white/25">
          Código de erro <span className="text-white/60">NSES-404</span>
        </p>
      </div>
    </main>
  );
}
