/**
 * GET /api/admin/uazapi/instances
 *
 * Superadmin endpoint. Returns every UAZAPI instance on the gateway, joined
 * with the local `whatsapp_instances` table, so the admin UI can render
 * the attach/detach picker + status.
 *
 * Response: `200 { instances: UazapiInstanceAdminView[] }`
 */

import { NextResponse } from "next/server";
import { listAllInstances } from "@/lib/admin/uazapi";
import {
  mapErrorToResponse,
  requireSuperadminJson,
} from "../../_shared";

export async function GET() {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  try {
    const instances = await listAllInstances();
    return NextResponse.json({ instances });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
