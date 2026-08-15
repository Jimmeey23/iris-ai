import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, expectedSessionToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health", "/api/fillout"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const expected = await expectedSessionToken();
  if (!expected) {
    // APP_PASSWORD not configured: fail closed on API routes, allow pages through
    // so the app is still reachable to configure it, but flag loudly in logs.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Server misconfigured: APP_PASSWORD is not set." },
        { status: 500 },
      );
    }
    console.error("APP_PASSWORD is not set — the app is running with no authentication.");
    return NextResponse.next();
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookie === expected) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
