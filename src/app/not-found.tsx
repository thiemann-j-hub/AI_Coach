import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-6">
      <h1 className="text-2xl font-bold">Seite nicht gefunden</h1>
      <p className="text-sm text-muted-foreground">Diese Seite existiert nicht (404).</p>
      <Link
        href="/analyze"
        className="text-sm text-primary underline hover:text-primary/80 transition-colors"
      >
        Zur Analyse
      </Link>
    </main>
  );
}
