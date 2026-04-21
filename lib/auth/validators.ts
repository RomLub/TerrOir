import { z } from "zod";

export const signupSchema = z.object({
  prenom: z.string().trim().min(1, "Prénom requis"),
  nom: z.string().trim().min(1, "Nom requis"),
  email: z.string().trim().email("Email invalide"),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum"),
  telephone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  sms_optin: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
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
    password: z.string().min(8, "Mot de passe : 8 caractères minimum"),
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

export const invitationPersonalInfoSchema = z.object({
  token: z.string().min(16, "Token invalide"),
  prenom: z.string().trim().min(1, "Prénom requis"),
  nom: z.string().trim().min(1, "Nom requis"),
  telephone: z.string().trim().min(1, "Téléphone requis"),
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
    token: z.string().min(16, "Token invalide"),
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
