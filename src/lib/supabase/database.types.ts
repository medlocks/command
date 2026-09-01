// Hand-authored mirror of `supabase-schema.sql`, in the same shape
// `supabase gen types typescript --project-id <id>` would produce. There is
// no live Supabase project yet (see SETUP-README.md) — once one exists and
// the schema has been applied, replace this file wholesale with:
//   supabase gen types typescript --project-id <project-id> > src/lib/supabase/database.types.ts
// Every table/view/enum below corresponds 1:1 to `supabase-schema.sql`, so
// that swap should produce no structural diff. Keep this file in sync with
// the SQL file until then — they must never drift (Requirements Section 8.2).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'owner' | 'manager' | 'stylist' | 'admin';
export type RecommendationStatus = 'pending' | 'in_progress' | 'accepted' | 'rejected' | 'dismissed';
export type IndicatorStatus = 'strong' | 'neutral' | 'caution';
export type IndicatorTrend = 'improving' | 'stable' | 'declining';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string | null;
          linked_stylist_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          full_name?: string | null;
          linked_stylist_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };

      stylists: {
        Row: {
          id: string;
          fresha_stylist_id: string | null;
          name: string;
          employment_status: string;
          start_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          fresha_stylist_id?: string | null;
          name: string;
          employment_status?: string;
          start_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['stylists']['Insert']>;
        Relationships: [];
      };

      stylist_wages: {
        Row: {
          id: string;
          stylist_id: string;
          // Confirmed hourly pay model (Requirements Section 3.5, 13 Q8) — no
          // more pay_model/commission_pct variants to support.
          hourly_rate: number;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          stylist_id: string;
          hourly_rate: number;
          effective_from: string;
          effective_to?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['stylist_wages']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'stylist_wages_stylist_id_fkey';
            columns: ['stylist_id'];
            referencedRelation: 'stylists';
            referencedColumns: ['id'];
          },
        ];
      };

      product_costs: {
        Row: {
          id: string;
          period_start: string;
          period_end: string;
          category: string | null;
          amount: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          period_start: string;
          period_end: string;
          category?: string | null;
          amount: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['product_costs']['Insert']>;
        Relationships: [];
      };

      job_applicants: {
        Row: {
          id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          stage: string;
          role_applied_for: string | null;
          applied_date: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          stage?: string;
          role_applied_for?: string | null;
          applied_date?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['job_applicants']['Insert']>;
        Relationships: [];
      };

      vacancies: {
        Row: {
          id: string;
          role_title: string;
          opened_date: string;
          closed_date: string | null;
          filled_by_applicant_id: string | null;
          estimated_weekly_revenue_impact: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          role_title: string;
          opened_date: string;
          closed_date?: string | null;
          filled_by_applicant_id?: string | null;
          estimated_weekly_revenue_impact?: number | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['vacancies']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'vacancies_filled_by_applicant_id_fkey';
            columns: ['filled_by_applicant_id'];
            referencedRelation: 'job_applicants';
            referencedColumns: ['id'];
          },
        ];
      };

      // Shape confirmed against a real Fresha "Client list" export
      // (Requirements Section 3.1, reviewed 19 Aug 2026) — replaces the
      // earlier assumption-based first_name/last_name/referral_source
      // columns. No stable client ID in the real export; dedup on import
      // runs on email/mobile, not fresha_client_id (kept for a future
      // live connector, not populated by the current manual CSV path).
      clients: {
        Row: {
          id: string;
          fresha_client_id: string | null;
          full_name: string;
          gender: string | null;
          age: number | null;
          email: string | null;
          mobile: string | null;
          added_date: string | null;
          first_appointment_date: string | null;
          last_appointment_date: string | null;
          loyalty_points_balance: number | null;
          loyalty_tier: string | null;
          client_source: string | null;
          referred_by: string | null;
          marketing_consent: boolean;
          profiling_opt_out: boolean;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          fresha_client_id?: string | null;
          full_name: string;
          gender?: string | null;
          age?: number | null;
          email?: string | null;
          mobile?: string | null;
          added_date?: string | null;
          first_appointment_date?: string | null;
          last_appointment_date?: string | null;
          loyalty_points_balance?: number | null;
          loyalty_tier?: string | null;
          client_source?: string | null;
          referred_by?: string | null;
          marketing_consent?: boolean;
          profiling_opt_out?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['clients']['Insert']>;
        Relationships: [];
      };

      service_categories: {
        Row: {
          id: string;
          raw_service_name: string;
          category: string;
          is_colour_category: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          raw_service_name: string;
          category: string;
          is_colour_category?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['service_categories']['Insert']>;
        Relationships: [];
      };

      products: {
        Row: {
          id: string;
          name: string;
          unit: string | null;
          reorder_threshold: number | null;
          current_estimated_stock: number | null;
          supplier: string | null;
          approx_cost_per_unit: number | null;
          is_critical: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          unit?: string | null;
          reorder_threshold?: number | null;
          current_estimated_stock?: number | null;
          supplier?: string | null;
          approx_cost_per_unit?: number | null;
          is_critical?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };

      stock_flags: {
        Row: {
          id: string;
          product_id: string;
          urgency: string;
          flagged_by: string | null;
          status: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          product_id: string;
          urgency?: string;
          flagged_by?: string | null;
          status?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['stock_flags']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'stock_flags_product_id_fkey';
            columns: ['product_id'];
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };

      service_product_usage: {
        Row: {
          id: string;
          raw_service_name: string;
          product_id: string;
          estimated_quantity_per_service: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          raw_service_name: string;
          product_id: string;
          estimated_quantity_per_service?: number | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['service_product_usage']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'service_product_usage_raw_service_name_fkey';
            columns: ['raw_service_name'];
            referencedRelation: 'service_categories';
            referencedColumns: ['raw_service_name'];
          },
          {
            foreignKeyName: 'service_product_usage_product_id_fkey';
            columns: ['product_id'];
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };

      services: {
        Row: {
          id: string;
          raw_service_name: string;
          price: number;
          duration_minutes: number;
          estimated_product_cost: number | null;
          is_estimate: boolean;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          raw_service_name: string;
          price: number;
          duration_minutes: number;
          estimated_product_cost?: number | null;
          is_estimate?: boolean;
          updated_at?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['services']['Insert']>;
        Relationships: [
          {
            // Unusual FK — references service_categories by its unique
            // raw_service_name column, not a uuid id, so the two catalogs
            // (broad category vs. real per-service commercial numbers)
            // stay linked (Requirements Section 3.6).
            foreignKeyName: 'services_raw_service_name_fkey';
            columns: ['raw_service_name'];
            referencedRelation: 'service_categories';
            referencedColumns: ['raw_service_name'];
          },
        ];
      };

      appointments: {
        Row: {
          id: string;
          fresha_appointment_id: string | null;
          client_id: string | null;
          stylist_id: string | null;
          service_category_id: string | null;
          raw_service_name: string | null;
          appointment_date: string;
          price: number;
          retail_addon_amount: number | null;
          status: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          fresha_appointment_id?: string | null;
          client_id?: string | null;
          stylist_id?: string | null;
          service_category_id?: string | null;
          raw_service_name?: string | null;
          appointment_date: string;
          price?: number;
          retail_addon_amount?: number | null;
          status?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['appointments']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'appointments_client_id_fkey';
            columns: ['client_id'];
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointments_stylist_id_fkey';
            columns: ['stylist_id'];
            referencedRelation: 'stylists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointments_service_category_id_fkey';
            columns: ['service_category_id'];
            referencedRelation: 'service_categories';
            referencedColumns: ['id'];
          },
        ];
      };

      retail_sales: {
        Row: {
          id: string;
          fresha_transaction_id: string | null;
          stylist_id: string | null;
          client_id: string | null;
          product_name: string | null;
          amount: number;
          sale_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          fresha_transaction_id?: string | null;
          stylist_id?: string | null;
          client_id?: string | null;
          product_name?: string | null;
          amount?: number;
          sale_date: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['retail_sales']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'retail_sales_stylist_id_fkey';
            columns: ['stylist_id'];
            referencedRelation: 'stylists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'retail_sales_client_id_fkey';
            columns: ['client_id'];
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
        ];
      };

      // Fresha "Sales Summary" reports (Section 3.1, confirmed 19 Aug
      // 2026) — period-aggregate exports, not per-transaction rows.
      // period_start/period_end are captured at upload time (the owner
      // picks the range the export covers), not parsed from the file.
      sales_summary_by_team_member: {
        Row: {
          id: string;
          team_member_name: string;
          stylist_id: string | null;
          period_start: string;
          period_end: string;
          sales_qty: number;
          items_sold: number;
          gross_sales: number;
          total_discounts: number;
          refunds: number;
          net_sales: number;
          taxes: number;
          total_sales: number;
          import_batch_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_member_name: string;
          stylist_id?: string | null;
          period_start: string;
          period_end: string;
          sales_qty?: number;
          items_sold?: number;
          gross_sales?: number;
          total_discounts?: number;
          refunds?: number;
          net_sales?: number;
          taxes?: number;
          total_sales?: number;
          import_batch_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['sales_summary_by_team_member']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'sales_summary_by_team_member_stylist_id_fkey';
            columns: ['stylist_id'];
            referencedRelation: 'stylists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_summary_by_team_member_import_batch_id_fkey';
            columns: ['import_batch_id'];
            referencedRelation: 'import_batches';
            referencedColumns: ['id'];
          },
        ];
      };

      // Service/Product split resolves the retail-isolation problem in
      // Section 5.9 — `type` is kept as free text since the real
      // "Product" row content was unverified at review time.
      sales_summary_by_type: {
        Row: {
          id: string;
          type: string;
          period_start: string;
          period_end: string;
          sales_qty: number;
          items_sold: number;
          gross_sales: number;
          total_discounts: number;
          refunds: number;
          net_sales: number;
          taxes: number;
          total_sales: number;
          import_batch_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          period_start: string;
          period_end: string;
          sales_qty?: number;
          items_sold?: number;
          gross_sales?: number;
          total_discounts?: number;
          refunds?: number;
          net_sales?: number;
          taxes?: number;
          total_sales?: number;
          import_batch_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['sales_summary_by_type']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'sales_summary_by_type_import_batch_id_fkey';
            columns: ['import_batch_id'];
            referencedRelation: 'import_batches';
            referencedColumns: ['id'];
          },
        ];
      };

      // Real appointment-list import (Requirements Section 3.1, confirmed
      // 19 Aug 2026) — a SEPARATE table from `appointments` above, not a
      // migration of it. See the schema file's own comment on why.
      fresha_appointments: {
        Row: {
          id: string;
          appt_ref: string;
          client_name: string;
          team_member_name: string | null;
          resource: string | null;
          status: string;
          created_date: string | null;
          scheduled_date: string | null;
          cancelled_date: string | null;
          category: string | null;
          service: string | null;
          duration_minutes: number | null;
          appt_slot: string | null;
          created_by: string | null;
          cancelled_by: string | null;
          location: string | null;
          net_sales: number;
          cancellation_reason: string | null;
          fees_charged: number;
          prepayments: number;
          import_batch_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          appt_ref: string;
          client_name: string;
          team_member_name?: string | null;
          resource?: string | null;
          status: string;
          created_date?: string | null;
          scheduled_date?: string | null;
          cancelled_date?: string | null;
          category?: string | null;
          service?: string | null;
          duration_minutes?: number | null;
          appt_slot?: string | null;
          created_by?: string | null;
          cancelled_by?: string | null;
          location?: string | null;
          net_sales?: number;
          cancellation_reason?: string | null;
          fees_charged?: number;
          prepayments?: number;
          import_batch_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['fresha_appointments']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'fresha_appointments_import_batch_id_fkey';
            columns: ['import_batch_id'];
            referencedRelation: 'import_batches';
            referencedColumns: ['id'];
          },
        ];
      };

      client_service_history: {
        Row: {
          id: string;
          client_id: string;
          service_category_id: string;
          last_visit_date: string | null;
          avg_interval_days: number | null;
          visit_count: number;
          predicted_next_due_date: string | null;
          lapse_risk_score: number | null;
          confidence: string | null;
          computed_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          service_category_id: string;
          last_visit_date?: string | null;
          avg_interval_days?: number | null;
          visit_count?: number;
          predicted_next_due_date?: string | null;
          lapse_risk_score?: number | null;
          confidence?: string | null;
          computed_at?: string;
        };
        Update: Partial<Database['public']['Tables']['client_service_history']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'client_service_history_client_id_fkey';
            columns: ['client_id'];
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_service_history_service_category_id_fkey';
            columns: ['service_category_id'];
            referencedRelation: 'service_categories';
            referencedColumns: ['id'];
          },
        ];
      };

      ad_spend_daily: {
        Row: {
          id: string;
          platform: string;
          campaign_id: string | null;
          campaign_name: string | null;
          spend_date: string;
          spend_amount: number;
          platform_reported_conversions: number | null;
          synced_at: string;
        };
        Insert: {
          id?: string;
          platform: string;
          campaign_id?: string | null;
          campaign_name?: string | null;
          spend_date: string;
          spend_amount?: number;
          platform_reported_conversions?: number | null;
          synced_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ad_spend_daily']['Insert']>;
        Relationships: [];
      };

      business_indicators: {
        Row: {
          id: string;
          indicator_key: string;
          computed_at: string;
          status: IndicatorStatus;
          trend: IndicatorTrend | null;
          confidence: string;
          // The numbers actually driving the read, e.g. {"utilization_pct": 95, "weeks_at_capacity": 6} — never fabricated.
          current_values: Json;
          reasoning: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          indicator_key: string;
          computed_at?: string;
          status: IndicatorStatus;
          trend?: IndicatorTrend | null;
          confidence?: string;
          current_values: Json;
          reasoning?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['business_indicators']['Insert']>;
        Relationships: [];
      };

      industry_benchmarks: {
        Row: {
          id: string;
          topic: string;
          principle: string;
          application_notes: string | null;
          target_metric: string | null;
          target_value: number | null;
          source_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          topic: string;
          principle: string;
          application_notes?: string | null;
          target_metric?: string | null;
          target_value?: number | null;
          source_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['industry_benchmarks']['Insert']>;
        Relationships: [];
      };

      recommendations: {
        Row: {
          id: string;
          category: string;
          title: string;
          detail: string | null;
          priority_score: number;
          // £ opportunity/impact shown front-and-centre on the to-do list (Section 5.5).
          estimated_impact_gbp: number | null;
          // Honesty framing alongside the £ figure — never presented with false precision.
          impact_confidence: string;
          related_client_id: string | null;
          related_stylist_id: string | null;
          status: RecommendationStatus;
          // Free-text owner notes (e.g. why it's "waiting", what was actually done) — feeds chat memory (5.4.1).
          notes: string | null;
          rejection_reason: string | null;
          cycle_date: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          category: string;
          title: string;
          detail?: string | null;
          priority_score?: number;
          estimated_impact_gbp?: number | null;
          impact_confidence?: string;
          related_client_id?: string | null;
          related_stylist_id?: string | null;
          status?: RecommendationStatus;
          notes?: string | null;
          rejection_reason?: string | null;
          cycle_date: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['recommendations']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'recommendations_related_client_id_fkey';
            columns: ['related_client_id'];
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recommendations_related_stylist_id_fkey';
            columns: ['related_stylist_id'];
            referencedRelation: 'stylists';
            referencedColumns: ['id'];
          },
        ];
      };

      chat_memory_facts: {
        Row: {
          id: string;
          fact_type: string;
          subject: string;
          content: string;
          source_conversation_ref: string | null;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          fact_type: string;
          subject: string;
          content: string;
          source_conversation_ref?: string | null;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['chat_memory_facts']['Insert']>;
        Relationships: [];
      };

      import_batches: {
        Row: {
          id: string;
          report_type: string;
          uploaded_by: string | null;
          file_name: string | null;
          row_count: number | null;
          error_count: number | null;
          validation_errors: Json | null;
          status: string;
          created_at: string;
          committed_at: string | null;
        };
        Insert: {
          id?: string;
          report_type: string;
          uploaded_by?: string | null;
          file_name?: string | null;
          row_count?: number | null;
          error_count?: number | null;
          validation_errors?: Json | null;
          status?: string;
          created_at?: string;
          committed_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['import_batches']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'import_batches_uploaded_by_fkey';
            columns: ['uploaded_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      data_subject_requests: {
        Row: {
          id: string;
          request_type: string;
          client_id: string | null;
          requested_at: string;
          fulfilled_at: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          request_type: string;
          client_id?: string | null;
          requested_at?: string;
          fulfilled_at?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['data_subject_requests']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'data_subject_requests_client_id_fkey';
            columns: ['client_id'];
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
        ];
      };
    };

    Views: {
      // Supabase codegen marks every view column nullable regardless of the
      // underlying query, since it can't prove non-nullability through a view.
      v_blended_cac_monthly: {
        Row: {
          month: string | null;
          total_ad_spend: number | null;
          new_clients: number | null;
          blended_cac: number | null;
        };
        Relationships: [];
      };
      v_aov_monthly: {
        Row: {
          month: string | null;
          avg_order_value: number | null;
          appointment_count: number | null;
        };
        Relationships: [];
      };
      v_service_profitability: {
        Row: {
          raw_service_name: string | null;
          price: number | null;
          duration_minutes: number | null;
          estimated_product_cost: number | null;
          is_estimate: boolean | null;
          profit_per_chair_hour: number | null;
          booking_count_90d: number | null;
        };
        Relationships: [];
      };
      v_retail_conversion_weekly: {
        Row: {
          week_start: string | null;
          stylist_id: string | null;
          clients_seen: number | null;
          retail_transactions: number | null;
          retail_conversion_pct: number | null;
        };
        Relationships: [];
      };
    };

    Functions: {
      current_user_role: {
        Args: Record<string, never>;
        Returns: UserRole;
      };
    };

    Enums: {
      user_role: UserRole;
      recommendation_status: RecommendationStatus;
      indicator_status: IndicatorStatus;
      indicator_trend: IndicatorTrend;
    };
  };
}
