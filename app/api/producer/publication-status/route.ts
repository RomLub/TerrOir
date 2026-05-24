import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getPublicationStatus } from "@/lib/producers/publication-status";

// GET /api/producer/publication-status — statut des 6 critères de publication
// pour le producteur connecté (checklist de mise en ligne, ADR-0011). Lecture
// seule. La page ma-page (client) le consomme pour afficher la progression.
export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getPublicationStatus(session.id);
  return NextResponse.json(status);
}
