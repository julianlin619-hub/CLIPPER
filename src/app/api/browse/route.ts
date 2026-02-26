import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync } from "fs";
import path from "path";
import os from "os";

export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get("dir") || os.homedir();
  try {
    const entries = readdirSync(dir)
      .map((name) => {
        try {
          const fullPath = path.join(dir, name);
          const stat = statSync(fullPath);
          return {
            name,
            path: fullPath,
            type: stat.isDirectory() ? "directory" : "file",
            size: stat.isFile() ? stat.size : undefined,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ dir, entries, parent: path.dirname(dir) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
