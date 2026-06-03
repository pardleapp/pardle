import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Server-side OTP verification. The SignInModal POSTs { email, token }
 * here instead of calling supabase.auth.verifyOtp() on the browser
 * client directly.
 *
 * Why server-side: when verifyOtp succeeds, the Supabase client needs
 * to persist the session cookies. In a route handler context,
 * cookieStore.set() writes real HTTP Set-Cookie response headers,
 * which the browser reliably persists across reloads. The browser
 * client's JS-cookie path is timing-sensitive and was dropping the
 * session on reload — moving the verify to the server eliminates it.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim();
  const token = body.token?.trim();
  if (!email || !token) {
    return NextResponse.json(
      { error: "email and token are required" },
      { status: 400 },
    );
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 },
    );
  }
  if (!data?.session) {
    return NextResponse.json(
      { error: "Signed in but no session returned" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
