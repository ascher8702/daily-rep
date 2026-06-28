/**
 * GENERATED FILE — do not edit by hand.
 *
 * TypeScript types for the Supabase Postgres schema (project aswwhsxubqyzbrfoptoq). Regenerate after
 * any schema change with the Supabase MCP `generate_typescript_types` tool (or, with the CLI:
 * `supabase gen types typescript --project-id aswwhsxubqyzbrfoptoq > src/lib/database.types.ts`).
 *
 * Consumed by `createClient<Database>` in supabase.ts so `.from('daily_rep_state')` / RPC calls are
 * type-checked against the real columns instead of `any`.
 */

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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      analytics_profile: {
        Row: {
          bodyweight: number | null
          days_per_week: number | null
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bodyweight?: number | null
          days_per_week?: number | null
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bodyweight?: number | null
          days_per_week?: number | null
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_session_sets: {
        Row: {
          done: boolean
          e1rm: number
          e1rm_kg: number
          effective_weight: number
          effective_weight_kg: number
          exercise_id: string
          exercise_order: number
          instance_id: string | null
          is_bodyweight_lift: boolean
          is_working: boolean | null
          performed_at: string
          performed_on: string
          plan_lift_id: string | null
          plan_slot: number | null
          regions: string[]
          reps: number
          rpe: number | null
          schema_version: number
          session_id: string
          set_id: string
          set_order: number
          set_volume: number
          set_volume_kg: number
          superset_group: string | null
          target_rep_high: number | null
          target_rep_low: number | null
          unit: string
          user_id: string
          warmup: boolean
          weight: number
        }
        Insert: {
          done?: boolean
          e1rm?: number
          e1rm_kg?: number
          effective_weight?: number
          effective_weight_kg?: number
          exercise_id: string
          exercise_order?: number
          instance_id?: string | null
          is_bodyweight_lift?: boolean
          is_working?: boolean | null
          performed_at: string
          performed_on: string
          plan_lift_id?: string | null
          plan_slot?: number | null
          regions?: string[]
          reps?: number
          rpe?: number | null
          schema_version?: number
          session_id: string
          set_id: string
          set_order?: number
          set_volume?: number
          set_volume_kg?: number
          superset_group?: string | null
          target_rep_high?: number | null
          target_rep_low?: number | null
          unit: string
          user_id: string
          warmup?: boolean
          weight?: number
        }
        Update: {
          done?: boolean
          e1rm?: number
          e1rm_kg?: number
          effective_weight?: number
          effective_weight_kg?: number
          exercise_id?: string
          exercise_order?: number
          instance_id?: string | null
          is_bodyweight_lift?: boolean
          is_working?: boolean | null
          performed_at?: string
          performed_on?: string
          plan_lift_id?: string | null
          plan_slot?: number | null
          regions?: string[]
          reps?: number
          rpe?: number | null
          schema_version?: number
          session_id?: string
          set_id?: string
          set_order?: number
          set_volume?: number
          set_volume_kg?: number
          superset_group?: string | null
          target_rep_high?: number | null
          target_rep_low?: number | null
          unit?: string
          user_id?: string
          warmup?: boolean
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_session_sets_user_id_session_id_fkey"
            columns: ["user_id", "session_id"]
            isOneToOne: false
            referencedRelation: "analytics_sessions"
            referencedColumns: ["user_id", "session_id"]
          },
        ]
      }
      analytics_sessions: {
        Row: {
          blob_updated_at: string
          bodyweight: number | null
          bodyweight_kg: number | null
          completed_at: string | null
          day_is_estimated: boolean
          duration_min: number | null
          exercise_count: number
          fingerprint: string
          focus: string[]
          gen_focus: string[] | null
          local_week: number
          performed_at: string
          performed_on: string
          plan_day_label: string | null
          plan_id: string | null
          projected_at: string
          schema_version: number
          session_id: string
          started_at: string | null
          title: string
          unit: string
          user_id: string
          working_rep_count: number
          working_set_count: number
          working_volume: number
          working_volume_kg: number
        }
        Insert: {
          blob_updated_at: string
          bodyweight?: number | null
          bodyweight_kg?: number | null
          completed_at?: string | null
          day_is_estimated?: boolean
          duration_min?: number | null
          exercise_count?: number
          fingerprint: string
          focus?: string[]
          gen_focus?: string[] | null
          local_week: number
          performed_at: string
          performed_on: string
          plan_day_label?: string | null
          plan_id?: string | null
          projected_at?: string
          schema_version?: number
          session_id: string
          started_at?: string | null
          title?: string
          unit: string
          user_id: string
          working_rep_count?: number
          working_set_count?: number
          working_volume?: number
          working_volume_kg?: number
        }
        Update: {
          blob_updated_at?: string
          bodyweight?: number | null
          bodyweight_kg?: number | null
          completed_at?: string | null
          day_is_estimated?: boolean
          duration_min?: number | null
          exercise_count?: number
          fingerprint?: string
          focus?: string[]
          gen_focus?: string[] | null
          local_week?: number
          performed_at?: string
          performed_on?: string
          plan_day_label?: string | null
          plan_id?: string | null
          projected_at?: string
          schema_version?: number
          session_id?: string
          started_at?: string | null
          title?: string
          unit?: string
          user_id?: string
          working_rep_count?: number
          working_set_count?: number
          working_volume?: number
          working_volume_kg?: number
        }
        Relationships: []
      }
      daily_rep_state: {
        Row: {
          client_updated_at: string | null
          created_at: string
          data: Json
          schema_version: number
          updated_at: string
          user_id: string
        }
        Insert: {
          client_updated_at?: string | null
          created_at?: string
          data?: Json
          schema_version?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          client_updated_at?: string | null
          created_at?: string
          data?: Json
          schema_version?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exercise_facts: {
        Row: {
          exercise_id: string
          is_bodyweight_lift: boolean
          regions: string[]
        }
        Insert: {
          exercise_id: string
          is_bodyweight_lift?: boolean
          regions?: string[]
        }
        Update: {
          exercise_id?: string
          is_bodyweight_lift?: boolean
          regions?: string[]
        }
        Relationships: []
      }
      exercises: {
        Row: {
          active: boolean
          created_at: string
          data: Json
          id: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          data: Json
          id: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          data?: Json
          id?: string
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          data: Json
          id: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          data: Json
          id: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          data?: Json
          id?: string
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          plan: string | null
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan?: string | null
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan?: string | null
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_my_adherence: {
        Row: {
          adherence: number | null
          local_week: number | null
          target: number | null
          training_days: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_my_exercise_e1rm: {
        Row: {
          best_e1rm: number | null
          best_e1rm_kg: number | null
          exercise_id: string | null
          performed_on: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_my_exercise_prs: {
        Row: {
          e1rm: number | null
          exercise_id: string | null
          performed_on: string | null
          previous: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_my_region_volume: {
        Row: {
          local_week: number | null
          performed_on: string | null
          region: string | null
          user_id: string | null
          volume: number | null
          volume_kg: number | null
          working_sets: number | null
        }
        Relationships: []
      }
      v_my_session_volume: {
        Row: {
          local_week: number | null
          performed_on: string | null
          user_id: string | null
          working_rep_count: number | null
          working_set_count: number | null
          working_volume: number | null
          working_volume_kg: number | null
        }
        Insert: {
          local_week?: number | null
          performed_on?: string | null
          user_id?: string | null
          working_rep_count?: number | null
          working_set_count?: number | null
          working_volume?: number | null
          working_volume_kg?: number | null
        }
        Update: {
          local_week?: number | null
          performed_on?: string | null
          user_id?: string | null
          working_rep_count?: number | null
          working_set_count?: number | null
          working_volume?: number | null
          working_volume_kg?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      my_volume_percentile: {
        Args: never
        Returns: {
          cohort_n: number
          cohort_p50: number
          my_volume: number
        }[]
      }
      my_weekly_streak: { Args: never; Returns: number }
      purge_user_data: { Args: { p_user: string }; Returns: undefined }
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
