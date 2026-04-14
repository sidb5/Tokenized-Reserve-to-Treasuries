import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <p className="text-4xl font-semibold text-neutral-950">404</p>
        <h1 className="mt-4 text-2xl font-semibold text-neutral-950">Page not found</h1>
        <p className="mt-2 text-sm text-neutral-600">The requested page is not available.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-neutral-950 hover:text-neutral-700">
          Go to the demo
        </Link>
      </div>
    </main>
  );
}
