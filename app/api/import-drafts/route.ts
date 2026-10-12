import { NextRequest } from "next/server";
import { requireOfficeSession } from "@/lib/server/requireOfficeSession";
import { handleSharedImport } from "@/lib/server/sharedImportApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handle(request: NextRequest) {
  return handleSharedImport(request, {
    authorize: async () => (await requireOfficeSession(request)) === null,
  });
}
export const GET = handle;
export const POST = handle;
