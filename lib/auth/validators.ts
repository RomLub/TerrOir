import { z } from "zod";

// Mot de passe création/changement : 12+ chars + minuscule + majuscule + chiffre.
// Aligné avec les règles Auth Dashboard Supabase (paramétrage 29/04/2026).
// Évite l'incohérence où Zod accepterait un mdp simple que Supabase rejetterait
// ensuite avec un message anglais brut peu user-friendly.
//
// loginSchema ne l'utilise PAS : un login passe le mdp existant à Supabase
// qui vérifie le hash. Si la politique change, les anciens mdp doivent
// continuer de pouvoir se logger.
//
// Politique progressive 12 caractères (chantier 3, 2026-05) : ce schéma valide
// la CRÉATION et le CHANGEMENT de mot de passe (signup producteur + consumer,
// invitation, reset, change-password) — jamais le login. Le passage de 8 → 12
// caractères n'invalide NI les sessions actives (cookies JWT indépendants du
// mot de passe) NI les comptes existants (hashs bcrypt opaques, vérifiés tels
// quels au login). Les comptes < 12 restent valables et migrent naturellement
// à leur prochain reset/changement (où ce schéma s'applique). Aucune migration
// DB nécessaire.
export const strongPasswordSchema = z
  .string()
  .min(12, "Mot de passe : 12 caractères minimum")
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

// Chantier 3 (2026-05) — signup producteur self-service via /devenir-producteur.
// Crée le compte (auth + users + producers draft) + le lead. Champs business
// obligatoires (0.6c). prefillToken optionnel : présent quand un prospect
// arrive via son lien personnel (formulaire pré-rempli, email verrouillé).
export const producerSignupSchema = z
  .object({
    prenom: z.string().trim().min(1, "Prénom requis").max(120),
    nom: z.string().trim().min(1, "Nom requis").max(120),
    email: z.string().trim().toLowerCase().email("Email invalide"),
    password: strongPasswordSchema,
    passwordConfirm: z.string(),
    telephone: z.string().trim().min(1, "Téléphone requis").max(40),
    nom_exploitation: z
      .string()
      .trim()
      .min(1, "Nom de l'exploitation requis")
      .max(200),
    commune: z.string().trim().min(1, "Commune requise").max(120),
    code_postal: z.string().trim().regex(/^\d{5}$/, "Code postal : 5 chiffres"),
    especes: z.array(z.string().trim().min(1)).max(20).optional(),
    message: z
      .string()
      .trim()
      .max(5000)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    // Lien personnel prospect (HMAC) — optionnel. Validé côté action.
    prefillToken: z
      .string()
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    cgu_accepted: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === "on" || v === "true")
      .refine((v) => v === true, {
        message: "Vous devez accepter les conditions d'utilisation",
      }),
    // Honeypot anti-bot : doit rester vide (rempli = bot → 200 silencieux).
    website: z.string().optional(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Les mots de passe ne correspondent pas",
    path: ["passwordConfirm"],
  });

export type ProducerSignupInput = z.infer<typeof producerSignupSchema>;

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
  })
  .refine(
    (d) =>
      d.type_production !== "autre" ||
      (d.type_production_precision && d.type_production_precision.length > 0),
    {
      message: "Précisez votre type de production",
      path: ["type_production_precision"],
    },
  );

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type FormeJuridique = z.infer<typeof formeJuridiqueEnum>;
export type TypeProduction = z.infer<typeof typeProductionEnum>;
