import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="card panel p-8 w-full max-w-md text-center animate-rise">
        <p className="eyebrow mb-2">404</p>
        <h1 className="serif text-2xl mb-2">Page not found</h1>
        <p className="txt-2 text-sm mb-6">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" className="btn btn-primary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
