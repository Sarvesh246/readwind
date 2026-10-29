import { managedAuth } from "@/lib/readwind/auth-server";
import type { NextRequest } from "next/server";
type Context = { params: Promise<{ path: string[] }> };
export function GET(req: NextRequest, ctx: Context) {
  return managedAuth().handler().GET(req, ctx);
}
export function POST(req: NextRequest, ctx: Context) {
  return managedAuth().handler().POST(req, ctx);
}
export function PUT(req: NextRequest, ctx: Context) {
  return managedAuth().handler().PUT(req, ctx);
}
export function PATCH(req: NextRequest, ctx: Context) {
  return managedAuth().handler().PATCH(req, ctx);
}
export function DELETE(req: NextRequest, ctx: Context) {
  return managedAuth().handler().DELETE(req, ctx);
}
