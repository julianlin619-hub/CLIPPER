import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  const username = process.env.ACCESS_USERNAME ?? "admin";
  const password = process.env.ACCESS_PASSWORD ?? "changeme";
  const expected = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  const auth = req.headers.get("authorization");

  if (auth !== expected) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="CLIPPER"' },
    });
  }
}

export const config = {
  matcher: ["/((?!_next).*)"],
};
