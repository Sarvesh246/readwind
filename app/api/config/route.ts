export function GET() {
  return Response.json({ authUrl: process.env.NEON_AUTH_BASE_URL || null });
}
