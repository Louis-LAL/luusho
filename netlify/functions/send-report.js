// Fonction serveur Netlify : génère les emails avec le rapport PDF en pièce jointe,
// envoyés au locataire et au propriétaire via Resend.
// Utilise la clé de service Supabase (secrète) pour retrouver les emails des deux parties
// sans jamais exposer cette clé côté navigateur.

exports.handler = async function (event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Méthode non autorisée" };
  }

  const SUPABASE_URL = "https://eofytkmpyvfmvwlmvtik.supabase.co";
  const { SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY } = process.env;
  if (!SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Configuration serveur incomplète (variables d'environnement manquantes)." }),
    };
  }

  try {
    const { dossierId, pdfBase64 } = JSON.parse(event.body);
    if (!dossierId || !pdfBase64) {
      throw new Error("Paramètres manquants (dossierId ou pdfBase64).");
    }

    // 1. Récupérer le dossier (adresse + identifiants des deux parties)
    const dossierRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dossiers?id=eq.${dossierId}&select=address,tenant_user_id,landlord_user_id`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const dossierRows = await dossierRes.json();
    const dossier = dossierRows && dossierRows[0];
    if (!dossier) throw new Error("Dossier introuvable.");

    // 2. Retrouver l'email de chaque partie déjà inscrite
    const recipients = [];
    for (const uid of [dossier.tenant_user_id, dossier.landlord_user_id]) {
      if (!uid) continue;
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      });
      const userData = await userRes.json();
      if (userData && userData.email) recipients.push(userData.email);
    }

    if (recipients.length === 0) {
      throw new Error("Aucune des deux parties n'a encore rejoint ce dossier avec un compte.");
    }

    // 3. Envoyer l'email avec le PDF en pièce jointe
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "État des lieux <onboarding@resend.dev>",
        to: recipients,
        subject: `État des lieux — ${dossier.address}`,
        html: `<p>Bonjour,</p><p>Voici le rapport d'état des lieux pour le logement situé au <strong>${dossier.address}</strong>, en pièce jointe.</p><p>Conservez ce document : il fait foi entre les deux parties en cas de désaccord ultérieur.</p>`,
        attachments: [{ filename: "etat-des-lieux.pdf", content: pdfBase64 }],
      }),
    });
    const emailData = await emailRes.json();
    if (!emailRes.ok) throw new Error(emailData.message || JSON.stringify(emailData));

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, recipients }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
