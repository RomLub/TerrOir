# Checklist pré-Live TerrOir — 2026-05-06

> **Source de vérité unique** pour le passage en mode Live (Stripe Live +
> ouverture publique consumer). Consolide les bloquants éparpillés dans
> `docs/TODO.md` et les rapports comité review T-200 r1→r4, T-239+T-240
> r1→r3, T-241 r2→r3, BL-2 r4.
>
> Ce document est T-244 (consolidation) + T-257 (escalade T-245+T-246
> P1→P0-Mesure) + T-261 (intégration RGPD pré-Live des 5 follow-ups
> T-248/T-249/T-263/T-264/T-265).
>
> **Convention** :
> - **P0** = bloquant strict — Live ne peut **pas** être ouvert tant que
>   l'item est `🔲`.
> - **P1** = à finaliser dans les jours suivant Live (jamais à oublier).
> - **P2** = bloquant scaling post-Live (Sarthe → Pays de la Loire →
>   France) — pas un pré-requis de l'ouverture initiale.
> - **Hors checklist — Dette long terme** = à reprendre si signal
>   produit/business le justifie. Ne bloque rien.

---

## Statut global

À mettre à jour au fil de l'avancement (J=jour go-live cible).

| Section P0 | Total | ✅ Done | 🔲 Open |
|------------|-------|---------|---------|
| Paiement / Stripe | 3 | 0 | 3 |
| Juridique & Pages légales | 4 | 0 | 4 |
| Config externe Romain | 4 | 0 | 4 |
| Mesure / Business (T-257) | 3 | 0 | 3 |
| Sécurité technique | 6 | 2 | 4 |
| RGPD pré-Live (T-261) | 12 | 0 | 12 |
| Conformité DGCCRF | 8 | 1 | 7 |
| Produit / UX critique | 9 | 0 | 9 |

**Total P0** : 49 items. À zéro `🔲` avant bascule Stripe Live.

Items déjà livrés ce cycle (2026-05-06 — traçabilité audit T-003) :
- T-217 (politique uniforme floutage coords)
- T-218 + T-218-bis (RLS producers + lat/lng admin-only)
- T-219 (cache géocodage CP→lat/lng)
- T-228 (audit Stripe metadata pas de fuite T-200)
- T-237 (suite client interactive DistanceWidget @testing-library)
- T-238 (scan meta no raw coords leak routes API publiques)
- T-241 (persistance déclaration véracité — schema + RPC)
- T-110 + T-110-bis (lookups email .ilike + escape wildcards)
- T-255 (lint anti-apostrophe courbe)
- T-264 (audit CSP conformité anti-exfiltration sessionStorage)
- T-266 + T-266-bis + T-266-tris (namespace storage `terroir_`)
- T-273 (audit disclosure DistanceWidget + a11y mineurs)

---

## P0 — Bloquants stricts ouverture publique

### 🔴 Paiement / Stripe

- 🔲 **T-001** Onboarder Julien (GAEC du Rheu) — flow Stripe Connect
  end-to-end Live à valider avec un vrai producteur.
- 🔲 **T-002** Bascule Stripe Test → Live.
- 🔲 **T-045** Webhook Stripe mode Live — créer endpoint pointant
  `https://www.terroir-local.fr/api/stripe/webhook` au moment de la
  bascule T-002.

### 🔴 Juridique & Pages légales

- 🔲 **T-003** Audit tech externe pré-lancement (~2-4 k€, 1-2 semaines).
  Pentest, RLS Supabase, server actions sensibles, conformité RGPD,
  tests de charge, npm vulnerabilities, validation `/notre-demarche`.
- 🔲 **T-041** Pages légales (Mentions légales / CGU / CGV / Politique
  de confidentialité) — rédaction + validation juridique avocat.
- 🔲 **T-046** HIBP password protection — upgrade Supabase Pro plan
  (25$/mois) puis toggle Auth → Password Strength → Enable HIBP.
- 🔲 **T-206** Review avocat formulation comparative « ~1500 km » +
  page `/notre-demarche` (loi Climat & Résilience). Articulation T-003.

### 🔴 Config externe Romain (Dashboards)

- 🔲 **T-040** Twilio SMS — numéro FR à régler.
- 🔲 **T-042** SMTP custom Supabase Resend (rate limit Supabase
  built-in ~3-4/h non-prod, mails Auth en spam observés).
- 🔲 **T-043** Templates Auth Email — Magic Link, Reset Password,
  Confirm Signup, Change Email, Invite User à valider visuellement.
- 🔲 **T-044** Branding Stripe Connect — logo, couleurs, pages
  `/connect/*`, branding marketplace.

### 🔴 Mesure / Business (T-257 P0-Mesure)

> **T-257** : sans baseline mesurée, le bénéfice de T-239+T-240 reste
> invérifiable. Le comité r2 a figé T-245 et T-246 en bloquants Live.

- 🔲 **T-201** Instrumentation widget distance (taux clic « Utiliser ma
  position » vs saisie CP, taux de finalisation, distance médiane).
- 🔲 **T-245** Instrumentation scroll-depth (25/50/75/100 %) + clic
  produit fiche producteur. Valide le placement du bloc « Démarche »
  sous Avis.
- 🔲 **T-246** Instrumentation taux d'expansion du widget distance
  replié.

### 🔴 Sécurité technique

- ✅ **T-235** Vue Supabase floutée `producers_public` (déjà livrée par
  T-218-bis lat/lng admin-only — protection RLS au niveau DB).
- ✅ **T-238** Scan auto anti-fuite sur routes API publiques (livré
  2026-05-06, commit `6e2aa40`).
- ✅ **T-295-bis** Durcissement ACL RPC `SECURITY DEFINER` findings
  annexes T-295 (livré + applied 2026-05-06). 4 RPC verrouillées
  service_role only (`bump_geocode_cache`, `upsert_geocode_cache`,
  `invalidate_active_invitations_for_email`, `producers_block_owner_
  admin_columns`). Cache poisoning géocodage bloqué (cluster T-227).
  Cf. `docs/security/audit-rpc-acl-hardening-t295-bis-2026-05-06.md`.
- 🔲 **T-236** Rate-limit `/api/producers/search` anti-trilatération
  (livré 2026-05-06 commit `11a8bc9` — vérifier déploiement prod).
- 🔲 **T-227** Étude ré-identification adresse producteur par
  croisement de données publiques (arrondi 2 décimales ~1 km mais
  attaquant peut croiser fiches publiques + nom ferme + commune +
  photos). Documenter dans politique privacy producteur.
- 🔲 **T-253** Audit pre-Live `sessionStorage` DistanceWidget non-fuite
  vers tiers (Resend, Stripe, Vercel).
- 🔲 **T-254** Audit champs sensibles renvoyés par fiche producteur
  publique (email, téléphone, adresse non floutée).

### 🔴 RGPD pré-Live consolidé (T-261)

> **T-261** : intégration des 5 follow-ups conformité widget distance
> (registre traitements ↔ politique conf, audit logs, wording in-situ,
> CSP, exclusion CP des trackers front).

- 🔲 **T-207** Politique de confidentialité — mentionner widget
  distance, géocodage tiers `api-adresse.data.gouv.fr`, sessionStorage
  non-persistant. Réintroduire `<Link>` cliquable dans `PrivacyNote()`
  (`DistanceWidget.tsx`) à la livraison de la page.
- 🔲 **T-208** Inscription widget distance au registre des traitements
  RGPD (art. 30). Obligation d'inventaire même si donnée ne quitte pas
  le navigateur.
- 🔲 **T-209** CGU producteur — clause de véracité sur les 3 enums
  score carbone déclaratifs (`mode_elevage`, `alimentation`,
  `densite_animale`) + mécanisme rectification/contestation.
- 🔲 **T-210** Vérifier non-confusion `plein_air` / `semi_plein_air` vs
  règlement européen CE 543/2008 (œufs/volailles). Disclaimer in situ
  ou renommage enums.
- 🔲 **T-242** (round 4) Documenter méthodologie distance « à vol
  d'oiseau » (Haversine, arrondi 2 décimales, point fiche producteur).
  Pages mentions légales / FAQ.
- 🔲 **T-243** (round 4) Versioning + historisation des valeurs enums
  score carbone. Prérequis audit DGCCRF rétrospectif.
- 🔲 **T-248** Cohérence registre traitements ↔ mention in-situ widget
  distance (cluster T-261).
- 🔲 **T-249** Audit logs serveur — confirmer non-capture des CP/coords
  transmis au calcul Haversine (Vercel function logs, Resend, Sentry
  futur). Cluster T-261.
- 🔲 **T-262** CGU/CGV pré-Live — mention « distance à vol d'oiseau »
  et usage de `sessionStorage` côté consumer.
- 🔲 **T-263** (mentionné par T-261, à clarifier dans l'audit RGPD
  global — wording in-situ widget distance).
- 🔲 **T-264** Audit CSP conformité anti-exfiltration sessionStorage —
  livré commit `c8db47a` du 2026-05-06, vérifier conformité au déploiement.
- 🔲 **T-265** Étendre T-249 côté client — exclure CP des trackers
  front éventuels (Plausible, PostHog, GA). Vérifier events ne
  capturent jamais le CP saisi, URL/Referer sans CP en query string.
- 🔲 **T-272** Valider explicitement dans l'audit RGPD transverse le
  pattern « clic pour déployer la mention RGPD » (acceptable car aucune
  donnée collectée tant que l'utilisateur ne saisit rien).
- 🔲 **T-274** Vérification pre-Live : `sessionStorage` non-embarqué par
  outils de session-replay/monitoring front (Sentry, Datadog, LogRocket,
  FullStory).
- 🔲 **T-275** Garde-fou : aucun endpoint d'autocomplétion CP futur ne
  doit logger ni passer le CP en query string GET.
- 🔲 **T-276** Vérifier scoping origine de `terroir_geo_session` à
  `terroir-local.fr` (sous-domaines applicatifs futurs isolés par
  construction navigateur).

### 🔴 Conformité DGCCRF (déclaration véracité T-241)

- ✅ **T-241** Persistance déclaration véracité — schema + RPC
  `update_producer_onboarding` (livrée 2026-05-04).
- 🔲 **T-279** Runbook admin extraction snapshot DGCCRF —
  `declaration_indicateurs_veracite_at`, `_snapshot`, `_wording_version`
  en cas de réquisition. À documenter dans `METHODOLOGY.md` ou runbook
  dédié.
- 🔲 **T-282** Procédure gouvernance wording certifié — qui valide
  v1.0 → v1.1 (Romain seul / juriste obligatoire), où archiver
  l'historique, comment relier `wording_version` au texte exact affiché.
- 🔲 **T-284** Registre RGPD (Article 30) — finalité + durée
  conservation des 3 colonnes `declaration_indicateurs_*` (typique 2
  ans après fin relation commerciale, à confirmer juriste).
- 🔲 **T-285** Politique purge/anonymisation `declaration_indicateurs_*`
  lors suppression compte producteur. Arbitrage RGPD vs probatoire
  DGCCRF (archive intermédiaire ou anonymisation post-délai).
- 🔲 **T-286** CGU producteur — clause horodatage de la déclaration
  (information loyale RGPD : producteur informé que son geste est tracé
  en base avec timestamp + snapshot + wording version).
- 🔲 **T-287** RLS audit `declaration_indicateurs_*` avant Live —
  lecture admin only, write interdite par self-update producteur direct
  (forge `_veracite_at` / `_snapshot` / `_wording_version` via PostgREST
  = perte valeur probante). **Articulation T-218 + T-218-bis : déjà
  couvert par le trigger `producers_block_owner_admin_columns`** appliqué
  en prod 2026-05-06. À reconfirmer dans l'audit T-003.
- 🔲 **T-290** Politique rétention traces `declaration_indicateurs_*`
  cohérente avec durée RGPD côté producteur (croisement T-284, T-285).
- 🔲 **T-292** Contrainte CHECK sur `declaration_indicateurs_wording_version`
  (`'v1.0'`, `'v1.1'`, …). Migration légère ALTER TABLE ADD CONSTRAINT.
  En cours TA cycle 2026-05-06.
- 🔲 **T-295** Audit pré-Live RPC `update_producer_onboarding` —
  SECURITY DEFINER + search_path durci + REVOKE/GRANT EXECUTE.
  **Cf. `docs/security/audit-rpc-update-producer-onboarding-pre-live-
  2026-05-06.md`** (ce cycle).

### 🔴 Produit / UX critique

- 🔲 **T-202** Backfill lat/lng des 5 producteurs sans coordonnées
  (50 % du parc actuel). Sans fix, moitié des fiches perdent le widget
  distance — argument différenciant principal. Articulation T-229
  (process backfill sans logging adresses précises).
- 🔲 **T-211** Repenser bloc « Notre démarche » modulaire selon métier
  producteur (maraîcher, boulanger, apiculteur, arboriculteur ne sont
  pas des éleveurs). Aujourd'hui fiche maraîcher montre uniquement
  widget distance + titre adaptatif.
- 🔲 **T-239** (round 4) QA mobile dédiée bloc score carbone —
  écrans étroits 320→414 px, touch targets ≥ 44 px, troncature nom
  producteur.
- 🔲 **T-240** (round 4) État vide explicite quand producteur n'a pas
  renseigné les 4 indicateurs. Trancher : placeholder neutre vs
  masquage.
- 🔲 **T-241** (round 4) Micro-tooltips d'aide au choix dans onboarding
  `StepInfos` (mini-bouton « ? » avec exemple concret).
- 🔲 **T-250** Audit global tutoiement vs vouvoiement parcours consumer
  (home, fiche produit, panier, checkout, compte, mails Resend).
- 🔲 **T-281** Producteurs existants re-soumis ou re-certifiés —
  producteurs créés avant T-241 ont `declaration_indicateurs_*` à NULL.
  Forcer re-coche ou les masquer tant que NULL avant ouverture publique.
- 🔲 **T-229** Process backfill T-202 sans logging d'adresses précises
  (migration data avec valeurs littérales OU script ad-hoc non commit).
- 🔲 **T-011** Bug intermittent navbar « Connexion » affiché loggé.
  Mitigation préparée (snippet `INITIAL_SESSION` protect dans
  `UserProvider`) à activer si re-flag persistant.

---

## P1 — À finaliser dans les jours après Live

- 🔲 **T-082** Documenter durée rétention `audit_logs` cluster
  `admin_invite_*` (intérêt légitime, 12-36 mois typique). Inscrire
  dans registre traitements + politique de confidentialité producer.
- 🔲 **T-232** Mécanisme de rectification continue 4 indicateurs
  producteur (UI dédiée `/ma-page` à articuler avec T-203 / T-212).

---

## P2 — Bloquants scaling post-Live (Sarthe → Pays de la Loire → France)

- 🔲 **T-204** Anticiper scaling géocodeur public au-delà Sarthe
  (`api-adresse.data.gouv.fr` sans SLA → bascule géocodeur SLA ou cache
  CP fréquents — T-219 livre le cache, à monitorer).
- 🔲 **T-216** Internationalisation « ~1500 km » ADEME France et
  `api-adresse.data.gouv.fr` hors France.
- 🔲 **T-225** Workflow staging→prod pour migrations Supabase. Apply
  via MCP en prod acceptable pré-Live, à reconsidérer avant ouverture
  publique.
- 🔲 **T-226** Plan B fournisseur géocodage (BAN auto-hébergée, Google
  Geocoding payant, MapBox).
- 🔲 **T-247** Persistance opt-in position consumer (cookie ou champ
  profil consumer) — articulation T-213.
- 🔲 **T-260** Anticiper impact élargissement géo sur pertinence widget
  distance (consumer parisien à 200 km vs manceau à 12 km).
- 🔲 **T-271** Conditionner bloc score-carbone à distance seuil lors
  élargissement géo.

---

## Hors checklist — Dette long terme

Items à reprendre si signal produit/business le justifie. Ne bloquent
ni l'ouverture publique ni le scaling immédiat.

| ID | Sujet |
|----|-------|
| T-085 | Dashboard taux conversion invitation → onboarding |
| T-150 | Consumer cancel route — décision produit |
| T-151 | Transition `ready → refunded` illégale — décision produit |
| T-152 | Aligner guards `canTransition` vs `isTerminal` |
| T-153 | Confirm route sans garde rôle explicite |
| T-213 | Pré-remplissage global position consumer (header / compte) |
| T-214 | Comparatif GMS visuel post-review juridique |
| T-215 | Audit a11y dédié pills colorées (livré T-273) |
| T-234 | Audit transverse messages d'erreur validation client |
| T-251 | Repenser section Démarche maintenant en bas |
| T-252 | Test utilisateur seniors widget replié |
| T-256 | Pattern disclosure design system (`aria-expanded`) |
| T-258 | KPI cible widget distance déplié (post-Live, dépend T-246) |
| T-259 | Vérifier bloc Démarche reste lu (post-Live, dépend T-245) |
| T-267 | Documenter clé `terroir_geo_session` globale |
| T-268 | Introduire `@testing-library/react` au refacto T-256 |
| T-269 | Évaluer env Vitest jsdom global vs ciblé |
| T-270 | Préciser seuil minimal usage widget T-258 |
| T-278 | Passage v1.1 wording (re-coche) |
| T-280 | Étendre pattern snapshot daté + version |
| T-283 | Suivi taux producteurs avec déclaration persistée |
| T-288 | Chantier futur wording v1.1 |
| T-289 | UX explicite re-coche après changement indicateur |
| T-291 | Application migration T-241 (déjà appliquée 2026-05-04) |
| T-293 | Runbook bump wording v1.1 |
| T-294 | Surveiller surcharge `completeOnboardingAction` |
| T-296 | Infra test intégration SQL contre Supabase |
| T-297 | Convention hygiène migrations (idempotence) |
| T-298 | Refaire test BL-1 orchestrateur |

---

## Avant bascule Stripe Live (procédure)

1. Vérifier que **tous les items P0** sont à `✅`.
2. Lancer audit T-003 externe (1-2 semaines).
3. Appliquer correctifs identifiés par l'audit.
4. Vérifier que T-202 (backfill lat/lng) est terminé et qu'aucun
   producteur visible n'a `declaration_indicateurs_*` à NULL (T-281).
5. Activer instrumentation T-201 + T-245 + T-246 et collecter baseline
   sur 3-5 jours en mode Test.
6. Bascule T-002 + création webhook T-045.
7. Onboarder Julien T-001 en Live.
8. Communiquer ouverture publique.

---

## Maintenance de cette checklist

- Mise à jour à chaque clôture d'item P0 (passer 🔲 → ✅).
- Items ajoutés ad hoc référencés dans la section adéquate avec ID
  T-XXX stable.
- Si nouvelle catégorie émerge (ex: Marketing/SEO), créer une section
  P0/P1/P2 dédiée plutôt que la diluer.
- Source d'origine de chaque item : `docs/TODO.md`. La checklist est
  une vue **synthétisée**, pas une duplication exhaustive.
