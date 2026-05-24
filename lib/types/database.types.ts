export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          nom: string | null
          prenom: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id: string
          nom?: string | null
          prenom?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          nom?: string | null
          prenom?: string | null
        }
        Relationships: []
      }
      animals: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      cuts: {
        Row: {
          animal_id: string
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          animal_id: string
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          animal_id?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "cuts_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          amount: number
          closed_at: string | null
          created_at: string
          currency: string
          evidence_due_by: string | null
          id: string
          metadata: Json
          order_id: string
          reason: string | null
          status: string
          stripe_charge_id: string | null
          stripe_dispute_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          closed_at?: string | null
          created_at?: string
          currency?: string
          evidence_due_by?: string | null
          id?: string
          metadata?: Json
          order_id: string
          reason?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_dispute_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          closed_at?: string | null
          created_at?: string
          currency?: string
          evidence_due_by?: string | null
          id?: string
          metadata?: Json
          order_id?: string
          reason?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_dispute_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      email_change_otp_codes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          ip_address: unknown
          step: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          ip_address?: unknown
          step: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          step?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      email_change_undo_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: unknown
          new_email: string
          old_email: string
          token_hash: string
          used_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          ip_address?: unknown
          new_email: string
          old_email: string
          token_hash: string
          used_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          new_email?: string
          old_email?: string
          token_hash?: string
          used_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          reason: string
          soft_bounce_count: number
          source_resend_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          reason: string
          soft_bounce_count?: number
          source_resend_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          reason?: string
          soft_bounce_count?: number
          source_resend_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      geocode_cache: {
        Row: {
          cp: string
          hit_count: number
          last_hit_at: string
          lat: number
          lng: number
          resolved_at: string
          source: string
        }
        Insert: {
          cp: string
          hit_count?: number
          last_hit_at?: string
          lat: number
          lng: number
          resolved_at?: string
          source?: string
        }
        Update: {
          cp?: string
          hit_count?: number
          last_hit_at?: string
          lat?: number
          lng?: number
          resolved_at?: string
          source?: string
        }
        Relationships: []
      }
      gms_prices: {
        Row: {
          active: boolean
          created_at: string
          description_courte: string | null
          filiere: string
          id: string
          libelle: string
          mois_reference: string
          notes_admin: string | null
          ordre_affichage: number
          prix_gms_kg: number
          prix_terroir_kg_max: number | null
          prix_terroir_kg_min: number | null
          prix_terroir_kg_moyen: number | null
          slug: string
          source: string
          source_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description_courte?: string | null
          filiere: string
          id?: string
          libelle: string
          mois_reference: string
          notes_admin?: string | null
          ordre_affichage?: number
          prix_gms_kg: number
          prix_terroir_kg_max?: number | null
          prix_terroir_kg_min?: number | null
          prix_terroir_kg_moyen?: number | null
          slug: string
          source: string
          source_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description_courte?: string | null
          filiere?: string
          id?: string
          libelle?: string
          mois_reference?: string
          notes_admin?: string | null
          ordre_affichage?: number
          prix_gms_kg?: number
          prix_terroir_kg_max?: number | null
          prix_terroir_kg_min?: number | null
          prix_terroir_kg_moyen?: number | null
          slug?: string
          source?: string
          source_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      gms_prices_history: {
        Row: {
          created_at: string
          id: string
          mois_reference: string
          prix_gms_kg: number
          prix_terroir_kg_moyen: number | null
          reference_id: string
          source: string
          source_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mois_reference: string
          prix_gms_kg: number
          prix_terroir_kg_moyen?: number | null
          reference_id: string
          source: string
          source_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mois_reference?: string
          prix_gms_kg?: number
          prix_terroir_kg_moyen?: number | null
          reference_id?: string
          source?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gms_prices_history_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "gms_prices"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          metadata: Json | null
          statut: string | null
          template: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          statut?: string | null
          template: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          statut?: string | null
          template?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          order_id: string | null
          prix_unitaire: number
          product_id: string | null
          quantite: number
          sous_total: number
        }
        Insert: {
          id?: string
          order_id?: string | null
          prix_unitaire: number
          product_id?: string | null
          quantite: number
          sous_total: number
        }
        Update: {
          id?: string
          order_id?: string | null
          prix_unitaire?: number
          product_id?: string | null
          quantite?: number
          sous_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          cgv_accepted_at: string | null
          cgv_version: string | null
          closure_reason: string | null
          code_commande: string | null
          commission_terroir: number | null
          completed_at: string | null
          confirmed_at: string | null
          consumer_id: string | null
          created_at: string | null
          date_retrait: string | null
          heure_retrait: string | null
          id: string
          montant_net_producteur: number | null
          montant_total: number | null
          notes_client: string | null
          producer_id: string | null
          review_followup_d2_sent_at: string | null
          review_followup_d7_sent_at: string | null
          slot_id: string | null
          statut: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cgv_accepted_at?: string | null
          cgv_version?: string | null
          closure_reason?: string | null
          code_commande?: string | null
          commission_terroir?: number | null
          completed_at?: string | null
          confirmed_at?: string | null
          consumer_id?: string | null
          created_at?: string | null
          date_retrait?: string | null
          heure_retrait?: string | null
          id?: string
          montant_net_producteur?: number | null
          montant_total?: number | null
          notes_client?: string | null
          producer_id?: string | null
          review_followup_d2_sent_at?: string | null
          review_followup_d7_sent_at?: string | null
          slot_id?: string | null
          statut?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cgv_accepted_at?: string | null
          cgv_version?: string | null
          closure_reason?: string | null
          code_commande?: string | null
          commission_terroir?: number | null
          completed_at?: string | null
          confirmed_at?: string | null
          consumer_id?: string | null
          created_at?: string | null
          date_retrait?: string | null
          heure_retrait?: string | null
          id?: string
          montant_net_producteur?: number | null
          montant_total?: number | null
          notes_client?: string | null
          producer_id?: string | null
          review_followup_d2_sent_at?: string | null
          review_followup_d7_sent_at?: string | null
          slot_id?: string | null
          statut?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          commission: number | null
          created_at: string | null
          error_msg: string | null
          id: string
          montant_brut: number | null
          montant_net: number | null
          periode_debut: string | null
          periode_fin: string | null
          producer_id: string | null
          statut: string | null
          stripe_payout_id: string | null
          stripe_transfer_id: string | null
          updated_at: string
        }
        Insert: {
          commission?: number | null
          created_at?: string | null
          error_msg?: string | null
          id?: string
          montant_brut?: number | null
          montant_net?: number | null
          periode_debut?: string | null
          periode_fin?: string | null
          producer_id?: string | null
          statut?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          commission?: number | null
          created_at?: string | null
          error_msg?: string | null
          id?: string
          montant_brut?: number | null
          montant_net?: number | null
          periode_debut?: string | null
          periode_fin?: string | null
          producer_id?: string | null
          statut?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      producer_interests: {
        Row: {
          abandoned_at: string | null
          abandoned_reason: string | null
          assigned_to: string | null
          commune: string | null
          created_at: string | null
          current_step: number
          email: string
          especes: string[] | null
          first_contact_at: string | null
          id: string
          last_contact_at: string | null
          message: string | null
          next_follow_up_at: string | null
          nom: string
          nom_exploitation: string | null
          prefill_token: string | null
          prefill_token_expires_at: string | null
          prenom: string | null
          source: string
          statut: string | null
          telephone: string | null
        }
        Insert: {
          abandoned_at?: string | null
          abandoned_reason?: string | null
          assigned_to?: string | null
          commune?: string | null
          created_at?: string | null
          current_step?: number
          email: string
          especes?: string[] | null
          first_contact_at?: string | null
          id?: string
          last_contact_at?: string | null
          message?: string | null
          next_follow_up_at?: string | null
          nom: string
          nom_exploitation?: string | null
          prefill_token?: string | null
          prefill_token_expires_at?: string | null
          prenom?: string | null
          source?: string
          statut?: string | null
          telephone?: string | null
        }
        Update: {
          abandoned_at?: string | null
          abandoned_reason?: string | null
          assigned_to?: string | null
          commune?: string | null
          created_at?: string | null
          current_step?: number
          email?: string
          especes?: string[] | null
          first_contact_at?: string | null
          id?: string
          last_contact_at?: string | null
          message?: string | null
          next_follow_up_at?: string | null
          nom?: string
          nom_exploitation?: string | null
          prefill_token?: string | null
          prefill_token_expires_at?: string | null
          prenom?: string | null
          source?: string
          statut?: string | null
          telephone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producer_interests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      producer_interest_followups: {
        Row: {
          channel: string
          created_at: string
          created_by: string | null
          direction: string
          id: string
          is_automatic: boolean
          lead_id: string
          note: string | null
          occurred_at: string
          relance_step: number | null
        }
        Insert: {
          channel: string
          created_at?: string
          created_by?: string | null
          direction: string
          id?: string
          is_automatic?: boolean
          lead_id: string
          note?: string | null
          occurred_at?: string
          relance_step?: number | null
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          is_automatic?: boolean
          lead_id?: string
          note?: string | null
          occurred_at?: string
          relance_step?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "producer_interest_followups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producer_interest_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "producer_interests"
            referencedColumns: ["id"]
          },
        ]
      }
      producer_invitations: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      producers: {
        Row: {
          abonnement_expire_at: string | null
          abonnement_niveau: string | null
          adresse: string | null
          annee_creation: number | null
          badge_annulation_score: number | null
          badge_confirmation_score: number | null
          badge_stock_score: number | null
          bio: boolean
          bio_certificate_number: string | null
          bio_validated_at: string | null
          code_postal: string | null
          commune: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          especes: string[] | null
          forme_juridique: string | null
          generations: number | null
          histoire: string | null
          id: string
          labels: string[] | null
          latitude: number | null
          longitude: number | null
          nb_avis: number
          nom_exploitation: string
          note_moyenne: number
          photo_principale: string | null
          photos: string[] | null
          publication_requested_at: string | null
          siret: string | null
          slug: string
          statut: string | null
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_cleanup_pending: boolean
          stripe_details_submitted: boolean
          stripe_payouts_enabled: boolean
          type_production: string | null
          type_production_precision: string | null
          user_id: string | null
        }
        Insert: {
          abonnement_expire_at?: string | null
          abonnement_niveau?: string | null
          adresse?: string | null
          annee_creation?: number | null
          badge_annulation_score?: number | null
          badge_confirmation_score?: number | null
          badge_stock_score?: number | null
          bio?: boolean
          bio_certificate_number?: string | null
          bio_validated_at?: string | null
          code_postal?: string | null
          commune?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          especes?: string[] | null
          forme_juridique?: string | null
          generations?: number | null
          histoire?: string | null
          id?: string
          labels?: string[] | null
          latitude?: number | null
          longitude?: number | null
          nb_avis?: number
          nom_exploitation: string
          note_moyenne?: number
          photo_principale?: string | null
          photos?: string[] | null
          publication_requested_at?: string | null
          siret?: string | null
          slug: string
          statut?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_cleanup_pending?: boolean
          stripe_details_submitted?: boolean
          stripe_payouts_enabled?: boolean
          type_production?: string | null
          type_production_precision?: string | null
          user_id?: string | null
        }
        Update: {
          abonnement_expire_at?: string | null
          abonnement_niveau?: string | null
          adresse?: string | null
          annee_creation?: number | null
          badge_annulation_score?: number | null
          badge_confirmation_score?: number | null
          badge_stock_score?: number | null
          bio?: boolean
          bio_certificate_number?: string | null
          bio_validated_at?: string | null
          code_postal?: string | null
          commune?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          especes?: string[] | null
          forme_juridique?: string | null
          generations?: number | null
          histoire?: string | null
          id?: string
          labels?: string[] | null
          latitude?: number | null
          longitude?: number | null
          nb_avis?: number
          nom_exploitation?: string
          note_moyenne?: number
          photo_principale?: string | null
          photos?: string[] | null
          publication_requested_at?: string | null
          siret?: string | null
          slug?: string
          statut?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_cleanup_pending?: boolean
          stripe_details_submitted?: boolean
          stripe_payouts_enabled?: boolean
          type_production?: string | null
          type_production_precision?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      product_stock_alerts: {
        Row: {
          confirm_token: string
          confirmed_at: string | null
          consumer_id: string | null
          created_at: string
          email: string
          id: string
          notified_at: string | null
          product_id: string
          unsubscribe_token: string
          unsubscribed_at: string | null
        }
        Insert: {
          confirm_token: string
          confirmed_at?: string | null
          consumer_id?: string | null
          created_at?: string
          email: string
          id?: string
          notified_at?: string | null
          product_id: string
          unsubscribe_token: string
          unsubscribed_at?: string | null
        }
        Update: {
          confirm_token?: string
          confirmed_at?: string | null
          consumer_id?: string | null
          created_at?: string
          email?: string
          id?: string
          notified_at?: string | null
          product_id?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_stock_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean | null
          animal_id: string | null
          category_id: string | null
          conseil_active: boolean
          conseil_texte: string | null
          created_at: string | null
          cut_id: string | null
          delai_preparation_jours: number | null
          description: string | null
          id: string
          nom: string
          photos: string[] | null
          poids_estime_kg: number | null
          prix: number
          producer_id: string | null
          stock_disponible: number | null
          stock_illimite: boolean | null
          unite: string | null
        }
        Insert: {
          active?: boolean | null
          animal_id?: string | null
          category_id?: string | null
          conseil_active?: boolean
          conseil_texte?: string | null
          created_at?: string | null
          cut_id?: string | null
          delai_preparation_jours?: number | null
          description?: string | null
          id?: string
          nom: string
          photos?: string[] | null
          poids_estime_kg?: number | null
          prix: number
          producer_id?: string | null
          stock_disponible?: number | null
          stock_illimite?: boolean | null
          unite?: string | null
        }
        Update: {
          active?: boolean | null
          animal_id?: string | null
          category_id?: string | null
          conseil_active?: boolean
          conseil_texte?: string | null
          created_at?: string | null
          cut_id?: string | null
          delai_preparation_jours?: number | null
          description?: string | null
          id?: string
          nom?: string
          photos?: string[] | null
          poids_estime_kg?: number | null
          prix?: number
          producer_id?: string | null
          stock_disponible?: number | null
          stock_illimite?: boolean | null
          unite?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cut_id_fkey"
            columns: ["cut_id"]
            isOneToOne: false
            referencedRelation: "cuts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_incident_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          id: string
          outcome: string
          refund_incident_id: string
          stripe_error_code: string | null
          stripe_error_message: string | null
          stripe_error_type: string | null
          stripe_refund_id: string | null
          stripe_request_id: string | null
        }
        Insert: {
          attempt_number: number
          attempted_at?: string
          id?: string
          outcome: string
          refund_incident_id: string
          stripe_error_code?: string | null
          stripe_error_message?: string | null
          stripe_error_type?: string | null
          stripe_refund_id?: string | null
          stripe_request_id?: string | null
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          id?: string
          outcome?: string
          refund_incident_id?: string
          stripe_error_code?: string | null
          stripe_error_message?: string | null
          stripe_error_type?: string | null
          stripe_refund_id?: string | null
          stripe_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_incident_attempts_refund_incident_id_fkey"
            columns: ["refund_incident_id"]
            isOneToOne: false
            referencedRelation: "refund_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_incidents: {
        Row: {
          blocked_reason: string | null
          consumer_id: string | null
          created_at: string
          first_failed_event_at: string
          id: string
          kind: string
          last_error_code: string | null
          last_error_message: string | null
          max_retries: number
          order_id: string
          payment_intent_id: string
          resolution_note: string | null
          resolved_at: string | null
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          consumer_id?: string | null
          created_at?: string
          first_failed_event_at: string
          id?: string
          kind: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_retries?: number
          order_id: string
          payment_intent_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          consumer_id?: string | null
          created_at?: string
          first_failed_event_at?: string
          id?: string
          kind?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_retries?: number
          order_id?: string
          payment_intent_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_incidents_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_incidents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          commentaire: string | null
          consumer_id: string | null
          created_at: string | null
          id: string
          note: number | null
          order_id: string | null
          producer_id: string | null
          producer_response: string | null
          producer_response_at: string | null
          producer_response_locked_at: string | null
          producer_response_status: string | null
          producer_response_updated_at: string | null
          published_at: string | null
          statut: string | null
        }
        Insert: {
          commentaire?: string | null
          consumer_id?: string | null
          created_at?: string | null
          id?: string
          note?: number | null
          order_id?: string | null
          producer_id?: string | null
          producer_response?: string | null
          producer_response_at?: string | null
          producer_response_locked_at?: string | null
          producer_response_status?: string | null
          producer_response_updated_at?: string | null
          published_at?: string | null
          statut?: string | null
        }
        Update: {
          commentaire?: string | null
          consumer_id?: string | null
          created_at?: string | null
          id?: string
          note?: number | null
          order_id?: string | null
          producer_id?: string | null
          producer_response?: string | null
          producer_response_at?: string | null
          producer_response_locked_at?: string | null
          producer_response_status?: string | null
          producer_response_updated_at?: string | null
          published_at?: string | null
          statut?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_rules: {
        Row: {
          active: boolean
          capacity_per_slot: number
          created_at: string
          days_of_week: number[]
          end_time: string
          id: string
          mode: string
          periodicity_weeks: number
          producer_id: string
          slot_duration_minutes: number
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity_per_slot: number
          created_at?: string
          days_of_week: number[]
          end_time: string
          id?: string
          mode?: string
          periodicity_weeks?: number
          producer_id: string
          slot_duration_minutes: number
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity_per_slot?: number
          created_at?: string
          days_of_week?: number[]
          end_time?: string
          id?: string
          mode?: string
          periodicity_weeks?: number
          producer_id?: string
          slot_duration_minutes?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_rules_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_rules_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          active: boolean | null
          capacity_per_slot: number
          created_at: string
          ends_at: string
          excluded_at: string | null
          id: string
          producer_id: string | null
          rule_id: string | null
          starts_at: string
        }
        Insert: {
          active?: boolean | null
          capacity_per_slot: number
          created_at?: string
          ends_at: string
          excluded_at?: string | null
          id?: string
          producer_id?: string | null
          rule_id?: string | null
          starts_at: string
        }
        Update: {
          active?: boolean | null
          capacity_per_slot?: number
          created_at?: string
          ends_at?: string
          excluded_at?: string | null
          id?: string
          producer_id?: string | null
          rule_id?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slots_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "producers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "slot_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_preferences: {
        Row: {
          created_at: string
          email_review_response: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_review_response?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_review_response?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          cgu_accepted_at: string | null
          cgu_version: string | null
          created_at: string | null
          email: string | null
          id: string
          nom: string | null
          prenom: string | null
          roles: string[]
          sms_optin: boolean | null
          stripe_customer_id: string | null
          telephone: string | null
        }
        Insert: {
          cgu_accepted_at?: string | null
          cgu_version?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          nom?: string | null
          prenom?: string | null
          roles?: string[]
          sms_optin?: boolean | null
          stripe_customer_id?: string | null
          telephone?: string | null
        }
        Update: {
          cgu_accepted_at?: string | null
          cgu_version?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nom?: string | null
          prenom?: string | null
          roles?: string[]
          sms_optin?: boolean | null
          stripe_customer_id?: string | null
          telephone?: string | null
        }
        Relationships: []
      }
      webhook_events_processed: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      producers_public: {
        Row: {
          adresse: string | null
          alimentation: string | null
          annee_creation: number | null
          badge_annulation_score: number | null
          badge_confirmation_score: number | null
          badge_stock_score: number | null
          code_postal: string | null
          commune: string | null
          densite_animale: string | null
          description: string | null
          especes: string[] | null
          generations: number | null
          histoire: string | null
          id: string | null
          labels: string[] | null
          latitude: number | null
          longitude: number | null
          mode_elevage: string | null
          nb_avis: number | null
          nom_exploitation: string | null
          note_moyenne: number | null
          photo_principale: string | null
          photos: string[] | null
          slug: string | null
          user_id: string | null
        }
        Insert: {
          adresse?: string | null
          alimentation?: string | null
          annee_creation?: number | null
          badge_annulation_score?: number | null
          badge_confirmation_score?: number | null
          badge_stock_score?: number | null
          code_postal?: string | null
          commune?: string | null
          densite_animale?: string | null
          description?: string | null
          especes?: string[] | null
          generations?: number | null
          histoire?: string | null
          id?: string | null
          labels?: string[] | null
          latitude?: never
          longitude?: never
          mode_elevage?: string | null
          nb_avis?: number | null
          nom_exploitation?: string | null
          note_moyenne?: number | null
          photo_principale?: string | null
          photos?: string[] | null
          slug?: string | null
          user_id?: string | null
        }
        Update: {
          adresse?: string | null
          alimentation?: string | null
          annee_creation?: number | null
          badge_annulation_score?: number | null
          badge_confirmation_score?: number | null
          badge_stock_score?: number | null
          code_postal?: string | null
          commune?: string | null
          densite_animale?: string | null
          description?: string | null
          especes?: string[] | null
          generations?: number | null
          histoire?: string | null
          id?: string | null
          labels?: string[] | null
          latitude?: never
          longitude?: never
          mode_elevage?: string | null
          nb_avis?: number | null
          nom_exploitation?: string | null
          note_moyenne?: number | null
          photo_principale?: string | null
          photos?: string[] | null
          slug?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      bump_geocode_cache: {
        Args: { p_cp: string }
        Returns: {
          lat: number
          lng: number
        }[]
      }
      can_access_order: { Args: { p_order_id: string }; Returns: boolean }
      create_order_with_items: {
        Args: {
          p_consumer_id: string
          p_date_retrait: string
          p_heure_retrait: string
          p_items: Json
          p_notes_client: string
          p_producer_id: string
          p_slot_id: string
        }
        Returns: string
      }
      delete_user_account: { Args: { p_user_id: string }; Returns: undefined }
      generate_order_code: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_completed_order_of_caller: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      is_producer_public: { Args: { p_producer_id: string }; Returns: boolean }
      owns_producer: { Args: { p_producer_id: string }; Returns: boolean }
      record_refund_attempt: {
        Args: {
          p_blocked_reason: string
          p_classification: string
          p_consumer_id: string
          p_first_failed_event_at: string
          p_kind: string
          p_order_id: string
          p_outcome: string
          p_payment_intent_id: string
          p_stripe_error_code: string
          p_stripe_error_message: string
          p_stripe_error_type: string
          p_stripe_refund_id: string
          p_stripe_request_id: string
        }
        Returns: {
          attempt_id: string
          attempt_number: number
          incident_id: string
          incident_status: string
        }[]
      }
      request_publication: {
        Args: { p_user_id: string }
        Returns: Json
      }
      revive_order_with_stock_check: {
        Args: { p_order_id: string }
        Returns: string
      }
      search_producers: {
        Args: {
          p_especes?: string[]
          p_labels?: string[]
          p_lat: number
          p_lng: number
          p_radius_km: number
        }
        Returns: {
          badge_annulation_score: number
          badge_confirmation_score: number
          badge_stock_score: number
          code_postal: string
          commune: string
          distance_km: number
          especes: string[]
          id: string
          labels: string[]
          latitude: number
          longitude: number
          nb_avis: number
          nom_exploitation: string
          note_moyenne: number
          photo_principale: string
          product_count: number
          slug: string
        }[]
      }
      update_producer_onboarding: {
        Args: {
          p_adresse: string
          p_code_postal: string
          p_commune: string
          p_forme_juridique: string
          p_nom_exploitation: string
          p_siret: string
          p_type_production: string
          p_type_production_precision: string
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_geocode_cache: {
        Args: { p_cp: string; p_lat: number; p_lng: number; p_source?: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
