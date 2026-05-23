import { EmailLayout, emailTheme } from "./layout";

// Chantier 6 — emails de notification du cycle de vie d'un compte admin,
// envoyés à la personne concernée (promotion / suspension / retrait /
// changement de niveau / réactivation). Un seul template paramétré par `kind`
// (copy + CTA conditionnels), basé sur EmailLayout. Envoyé via sendTemplate
// (from no-reply configuré + footer « email automatique »).

export type AdminLifecycleKind =
  | "promoted"
  | "suspended"
  | "revoked"
  | "privilege_changed"
  | "reactivated";

export interface Props {
  kind: AdminLifecycleKind;
  prenom: string | null;
  // Pour kind='privilege_changed' : le nouveau niveau.
  newPrivilege?: "super_admin" | "standard";
  adminUrl: string;
}

const PRIVILEGE_LABEL: Record<"super_admin" | "standard", string> = {
  super_admin: "super-administrateur",
  standard: "administrateur standard",
};

function copyFor(props: Props): {
  subject: string;
  heading: string;
  body: string;
  cta?: string;
} {
  switch (props.kind) {
    case "promoted":
      return {
        subject: "[TerrOir] Vous êtes administrateur",
        heading: "Vous avez été promu administrateur",
        body:
          "Vous avez été promu administrateur de TerrOir. Connectez-vous sur l'espace d'administration pour y accéder. Pour des raisons de sécurité, pensez à mettre à jour votre mot de passe dès votre première connexion.",
        cta: "Accéder à l'espace admin",
      };
    case "suspended":
      return {
        subject: "[TerrOir] Votre accès administrateur a été suspendu",
        heading: "Accès administrateur suspendu",
        body:
          "Votre accès administrateur a été suspendu. Contactez le super-administrateur pour plus d'informations.",
      };
    case "revoked":
      return {
        subject: "[TerrOir] Votre statut administrateur a été retiré",
        heading: "Statut administrateur retiré",
        body:
          "Votre statut administrateur a été retiré. Votre compte client reste actif : vous pouvez continuer à utiliser TerrOir normalement.",
      };
    case "privilege_changed": {
      const lvl = props.newPrivilege
        ? PRIVILEGE_LABEL[props.newPrivilege]
        : "administrateur";
      return {
        subject: "[TerrOir] Votre niveau d'accès a évolué",
        heading: "Niveau d'accès modifié",
        body: `Votre niveau d'accès administrateur a évolué : vous êtes désormais ${lvl}.`,
      };
    }
    case "reactivated":
      return {
        subject: "[TerrOir] Votre accès administrateur a été réactivé",
        heading: "Accès administrateur réactivé",
        body:
          "Votre accès administrateur a été réactivé. Vous pouvez à nouveau vous connecter à l'espace d'administration.",
        cta: "Accéder à l'espace admin",
      };
  }
}

export const subject = (p: Props) => copyFor(p).subject;

export default function AdminLifecycle(props: Props) {
  const { heading, body, cta } = copyFor(props);
  const isPositive = props.kind === "promoted" || props.kind === "reactivated";
  const accent = isPositive ? emailTheme.green : emailTheme.terracotta;
  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: accent, marginTop: 0, fontSize: 22 }}>{heading}</h1>
      <p>Bonjour{props.prenom ? ` ${props.prenom}` : ""},</p>
      <p>{body}</p>
      {cta ? (
        <div style={{ marginTop: 24 }}>
          <a
            href={props.adminUrl}
            style={{
              display: "inline-block",
              padding: "12px 20px",
              backgroundColor: emailTheme.green,
              color: "#fff",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 600,
            }}
          >
            {cta}
          </a>
        </div>
      ) : null}
    </EmailLayout>
  );
}
