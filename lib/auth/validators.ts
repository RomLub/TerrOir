import { z } from "zod";
import {
  ALIMENTATION_VALUES,
  DENSITE_ANIMALE_VALUES,
  MODE_ELEVAGE_VALUES,
} from "@/lib/producers/score-carbone-enums";

// Mot de passe création/changement : 8+ chars + minuscule + majuscule + chiffre.
// Aligné avec les règles Auth Dashboard Supabase (paramétrage 29/04/2026).
// Évite l'incohérence où Zod accepterait un mdp simple que Supabase rejetterait
// ensuite avec un message anglais brut peu user-friendly.
//
// loginSchema ne l'utilise PAS : un login passe le mdp existant à Supabase
// qui vérifie le hash. Si la politique change, les anciens mdp doivent
// continuer de pouvoir se logger.
export const strongPasswordSchema = z
  .string()
  .min(8, "Mot de passe : 8 caractères minimum")
  .regex(/[a-z]/, "Doit contenir au moins une minuscule")
  .regex(/[A-Z]/, "Doit contenir au moins une majuscule")
  .regex(/[0-9]/, "Doit contenir au moins un chiffre");

export const signupSchema = z.object({
  prenom: z.string().trim().min(1, "Prénom requis"),
  nom: z.string().trim().min(1, "Nom requis"),
  email: z.string().trim().email("Email invalide"),
  password: strongPasswordSchema,
  telephone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  sms_optin: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  // Acceptation CGU obligatoire pour opposabilité juridique. Refus
  // serveur si manquant ou false (cas client trafiqué). La checkbox HTML
  // envoie "on" quand cochée, rien sinon — on accepte boolean ou string,
  // on dérive le booléen via transform, et on rejette tout sauf "vrai"
  // via refine pour que le message d'erreur custom soit visible (et pas
  // "Invalid input" générique du union strict).
  cgu_accepted: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === "on" || v === "true")
    .refine((v) => v === true, {
      message: "Vous devez accepter les conditions d'utilisation",
    }),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const inviteProducerSchema = z.object({
  email: z.string().trim().email("Email invalide"),
});

// --- Onboarding multi-étapes (Chantier 2 Phase 3) -----------------------------

export const invitationCreateAccountSchema = z
  .object({
    token: z.string().min(16, "Token invalide"),
    password: strongPasswordSchema,
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Les mots de passe ne correspondent pas",
    path: ["passwordConfirm"],
  });

export const invitationLoginAndUpgradeSchema = z.object({
  token: z.string().min(16, "Token invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const formeJuridiqueEnum = z.enum([
  "gaec",
  "earl",
  "ei",
  "scea",
  "sas",
  "sarl",
  "autre",
]);

export const typeProductionEnum = z.enum([
  "maraichage",
  "elevage",
  "laiterie",
  "boulangerie",
  "vin",
  "arboriculture",
  "apiculture",
  "autre",
]);

// Cast en tuple mutable pour préserver le typage strict des littéraux côté
// z.infer (le `as const` de score-carbone-enums.ts produit un readonly tuple
// que z.enum n'accepte pas directement).
export const modeElevageEnum = z.enum(
  MODE_ELEVAGE_VALUES as unknown as [
    (typeof MODE_ELEVAGE_VALUES)[number],
    ...(typeof MODE_ELEVAGE_VALUES)[number][],
  ],
);

export const alimentationEnum = z.enum(
  ALIMENTATION_VALUES as unknown as [
    (typeof ALIMENTATION_VALUES)[number],
    ...(typeof ALIMENTATION_VALUES)[number][],
  ],
);

export const densiteAnimaleEnum = z.enum(
  DENSITE_ANIMALE_VALUES as unknown as [
    (typeof DENSITE_ANIMALE_VALUES)[number],
    ...(typeof DENSITE_ANIMALE_VALUES)[number][],
  ],
);

export const invitationBusinessInfoSchema = z
  .object({
    // Token optionnel : absent en mode reprise d'onboarding (Phase 4) où la
    // légitimité vient de la session + du producer draft existant, pas
    // d'une invitation valide. Si un token est fourni, l'action le validera
    // quand même (flux invitation classique).
    token: z.string().optional(),
    // Phase 2 du chantier "Vision funnel producteur" : fusion StepPersonnel
    // dans cette étape unique. Les 3 champs perso (prenom/nom/telephone) sont
    // collectés ici en plus des champs business — pré-remplis depuis le lead
    // matching email côté page.tsx, écrits dans `users` côté action.
    prenom: z.string().trim().min(1, "Prénom requis"),
    nom: z.string().trim().min(1, "Nom requis"),
    telephone: z.string().trim().min(1, "Téléphone requis"),
    nom_exploitation: z.string().trim().min(1, "Nom de l'exploitation requis"),
    forme_juridique: formeJuridiqueEnum,
    siret: z.string().trim().regex(/^\d{14}$/, "SIRET : 14 chiffres requis"),
    adresse: z.string().trim().min(1, "Adresse requise"),
    code_postal: z.string().trim().regex(/^\d{5}$/, "Code postal : 5 chiffres"),
    commune: z.string().trim().min(1, "Commune requise"),
    type_production: typeProductionEnum,
    type_production_precision: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    mode_elevage: modeElevageEnum.optional(),
    alimentation: alimentationEnum.optional(),
    densite_animale: densiteAnimaleEnum.optional(),
    // T-200 r5 — déclaration sur l'honneur conditionnelle. Les libellés
    // grand public (« Plein air », etc.) recoupent partiellement des
    // dénominations encadrées par les règlements UE (œufs/volailles/porcs).
    // On exige l'engagement déclaratif du producteur dès qu'au moins un
    // des 3 indicateurs est saisi — sinon la case est ignorée. La checkbox
    // HTML envoie "on" quand cochée, rien sinon : on accepte les deux
    // formes sérialisées de "vrai".
    declaration_indicateurs_veracite: z
      .union([z.literal("on"), z.literal("true"), z.boolean()])
      .optional()
      .transform((v) => v === true || v === "on" || v === "true"),
  })
  .refine(
    (d) =>
      d.type_production !== "autre" ||
      (d.type_production_precision && d.type_production_precision.length > 0),
    {
      message: "Précisez votre type de production",
      path: ["type_production_precision"],
    },
  )
  .refine(
    (d) => {
      const anyEnumSet = Boolean(
        d.mode_elevage || d.alimentation || d.densite_animale,
      );
      return !anyEnumSet || d.declaration_indicateurs_veracite === true;
    },
    {
      message:
        "Pour publier ces indicateurs, certifie qu'ils correspondent à ta pratique réelle.",
      path: ["declaration_indicateurs_veracite"],
    },
  );

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type FormeJuridique = z.infer<typeof formeJuridiqueEnum>;
export type TypeProduction = z.infer<typeof typeProductionEnum>;
export type ModeElevageInput = z.infer<typeof modeElevageEnum>;
export type AlimentationInput = z.infer<typeof alimentationEnum>;
export type DensiteAnimaleInput = z.infer<typeof densiteAnimaleEnum>;
