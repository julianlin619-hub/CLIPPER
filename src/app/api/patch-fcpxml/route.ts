import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "patch_fcpxml.py");

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fcpxmlPath, editedXml, cuts } = body;

  if (!fcpxmlPath || !existsSync(fcpxmlPath)) {
    return new Response(JSON.stringify({ error: `Multicam FCPXML not found: ${fcpxmlPath}` }), { status: 400 });
  }

  const outputPath = path.join(tmpdir(), `clipper-patched-${randomUUID()}.fcpxml`);
  let args: string[];

  if (editedXml) {
    // Write the edited FCPXML to a temp file, then pass to script
    const editedPath = path.join(tmpdir(), `clipper-edited-${randomUUID()}.fcpxml`);
    writeFileSync(editedPath, editedXml, "utf-8");
    args = [SCRIPT_PATH, fcpxmlPath, "--from-edited", editedPath, outputPath];
  } else if (cuts && Array.isArray(cuts) && cuts.length > 0) {
    args = [SCRIPT_PATH, fcpxmlPath, "--cuts", JSON.stringify(cuts), outputPath];
  } else {
    return new Response(JSON.stringify({ error: "Provide either editedXml or cuts[]" }), { status: 400 });
  }

  return new Promise<Response>((resolve) => {
    const proc = spawn("python3", args, { env: { ...process.env } });

    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", async (code) => {
      // Clean up temp edited file if created
      const editedTmp = args[3] === "--from-edited" ? args[4] : null;
      if (editedTmp) await unlink(editedTmp).catch(() => {});

      if (code !== 0) {
        resolve(new Response(JSON.stringify({ error: `Patch failed: ${stderr.slice(-500)}` }), { status: 500 }));
        return;
      }
      try {
        const xml = await readFile(outputPath, "utf-8");
        await unlink(outputPath).catch(() => {});
        resolve(new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Content-Disposition": `attachment; filename="patched_multicam.fcpxml"`,
          },
        }));
      } catch (e: unknown) {
        resolve(new Response(JSON.stringify({ error: String(e) }), { status: 500 }));
      }
    });

    proc.on("error", (err) => {
      resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
    });
  });
}
