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
      ai_calls: {
        Row: {
          cost_cents: number
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          message_id: string | null
          model: string
          operation: string
          provider: string
          summary_id: string | null
          tenant_id: string
          tokens_in: number
          tokens_out: number
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          message_id?: string | null
          model: string
          operation: string
          provider: string
          summary_id?: string | null
          tenant_id: string
          tokens_in?: number
          tokens_out?: number
        }
        Update: {
          cost_cents?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          message_id?: string | null
          model?: string
          operation?: string
          provider?: string
          summary_id?: string | null
          tenant_id?: string
          tokens_in?: number
          tokens_out?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audios: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivered_to_whatsapp: boolean
          duration_seconds: number | null
          id: string
          model: string | null
          size_bytes: number | null
          speed: number | null
          storage_path: string
          summary_id: string
          tenant_id: string
          voice: string | null
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivered_to_whatsapp?: boolean
          duration_seconds?: number | null
          id?: string
          model?: string | null
          size_bytes?: number | null
          speed?: number | null
          storage_path: string
          summary_id: string
          tenant_id: string
          voice?: string | null
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivered_to_whatsapp?: boolean
          duration_seconds?: number | null
          id?: string
          model?: string | null
          size_bytes?: number | null
          speed?: number | null
          storage_path?: string
          summary_id?: string
          tenant_id?: string
          voice?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audios_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: true
            referencedRelation: "summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audios_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          instance_id: string
          is_monitored: boolean
          last_synced_at: string | null
          member_count: number | null
          name: string
          picture_url: string | null
          tenant_id: string
          uazapi_group_jid: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id: string
          is_monitored?: boolean
          last_synced_at?: string | null
          member_count?: number | null
          name: string
          picture_url?: string | null
          tenant_id: string
          uazapi_group_jid: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string
          is_monitored?: boolean
          last_synced_at?: string | null
          member_count?: number | null
          name?: string
          picture_url?: string | null
          tenant_id?: string
          uazapi_group_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          captured_at: string
          content: string | null
          created_at: string
          group_id: string
          id: string
          media_download_status: string | null
          media_duration_seconds: number | null
          media_mime_type: string | null
          media_size_bytes: number | null
          media_storage_path: string | null
          media_url: string | null
          raw_payload: Json | null
          sender_jid: string | null
          sender_name: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["message_type"]
          uazapi_message_id: string
        }
        Insert: {
          captured_at: string
          content?: string | null
          created_at?: string
          group_id: string
          id?: string
          media_download_status?: string | null
          media_duration_seconds?: number | null
          media_mime_type?: string | null
          media_size_bytes?: number | null
          media_storage_path?: string | null
          media_url?: string | null
          raw_payload?: Json | null
          sender_jid?: string | null
          sender_name?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["message_type"]
          uazapi_message_id: string
        }
        Update: {
          captured_at?: string
          content?: string | null
          created_at?: string
          group_id?: string
          id?: string
          media_download_status?: string | null
          media_duration_seconds?: number | null
          media_mime_type?: string | null
          media_size_bytes?: number | null
          media_storage_path?: string | null
          media_url?: string | null
          raw_payload?: Json | null
          sender_jid?: string | null
          sender_name?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["message_type"]
          uazapi_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          approval_mode: Database["public"]["Enums"]["schedule_approval_mode"]
          created_at: string
          day_of_week: number | null
          frequency: Database["public"]["Enums"]["schedule_frequency"]
          group_id: string
          id: string
          is_active: boolean
          tenant_id: string
          time_of_day: string | null
          tone: Database["public"]["Enums"]["summary_tone"]
          trigger_type: Database["public"]["Enums"]["schedule_trigger_type"]
          updated_at: string
          voice: string | null
        }
        Insert: {
          approval_mode?: Database["public"]["Enums"]["schedule_approval_mode"]
          created_at?: string
          day_of_week?: number | null
          frequency?: Database["public"]["Enums"]["schedule_frequency"]
          group_id: string
          id?: string
          is_active?: boolean
          tenant_id: string
          time_of_day?: string | null
          tone?: Database["public"]["Enums"]["summary_tone"]
          trigger_type?: Database["public"]["Enums"]["schedule_trigger_type"]
          updated_at?: string
          voice?: string | null
        }
        Update: {
          approval_mode?: Database["public"]["Enums"]["schedule_approval_mode"]
          created_at?: string
          day_of_week?: number | null
          frequency?: Database["public"]["Enums"]["schedule_frequency"]
          group_id?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          time_of_day?: string | null
          tone?: Database["public"]["Enums"]["summary_tone"]
          trigger_type?: Database["public"]["Enums"]["schedule_trigger_type"]
          updated_at?: string
          voice?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      summaries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          group_id: string
          id: string
          model: string | null
          period_end: string
          period_start: string
          prompt_version: string | null
          rejected_reason: string | null
          status: Database["public"]["Enums"]["summary_status"]
          tenant_id: string
          text: string
          tone: Database["public"]["Enums"]["summary_tone"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          group_id: string
          id?: string
          model?: string | null
          period_end: string
          period_start: string
          prompt_version?: string | null
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["summary_status"]
          tenant_id: string
          text: string
          tone?: Database["public"]["Enums"]["summary_tone"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          group_id?: string
          id?: string
          model?: string | null
          period_end?: string
          period_start?: string
          prompt_version?: string | null
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["summary_status"]
          tenant_id?: string
          text?: string
          tone?: Database["public"]["Enums"]["summary_tone"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "summaries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "summaries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      superadmins: {
        Row: {
          granted_at: string
          granted_by: string | null
          note: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          created_at: string
          joined_at: string
          role: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          delivery_target: string
          id: string
          include_caption_on_delivery: boolean
          is_active: boolean
          name: string
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_target?: string
          id?: string
          include_caption_on_delivery?: boolean
          is_active?: boolean
          name: string
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_target?: string
          id?: string
          include_caption_on_delivery?: boolean
          is_active?: boolean
          name?: string
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      transcripts: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          language: string | null
          message_id: string
          model: string | null
          text: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          language?: string | null
          message_id: string
          model?: string | null
          text: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          language?: string | null
          message_id?: string
          model?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          connected_at: string | null
          created_at: string
          id: string
          last_seen_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["whatsapp_instance_status"]
          tenant_id: string
          uazapi_instance_id: string
          uazapi_token_encrypted: string | null
          updated_at: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["whatsapp_instance_status"]
          tenant_id: string
          uazapi_instance_id: string
          uazapi_token_encrypted?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["whatsapp_instance_status"]
          tenant_id?: string
          uazapi_instance_id?: string
          uazapi_token_encrypted?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_ids: { Args: never; Returns: string[] }
      is_superadmin: { Args: never; Returns: boolean }
      safe_uuid: { Args: { value: string }; Returns: string }
    }
    Enums: {
      message_type: "text" | "audio" | "image" | "video" | "other"
      schedule_approval_mode: "auto" | "optional" | "required"
      schedule_frequency: "daily" | "weekly" | "custom"
      schedule_trigger_type: "fixed_time" | "inactivity" | "dynamic_window"
      summary_status: "pending_review" | "approved" | "rejected"
      summary_tone: "formal" | "fun" | "corporate"
      tenant_member_role: "owner" | "admin" | "member"
      whatsapp_instance_status:
        | "disconnected"
        | "connecting"
        | "qrcode"
        | "connected"
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
    Enums: {
      message_type: ["text", "audio", "image", "video", "other"],
      schedule_approval_mode: ["auto", "optional", "required"],
      schedule_frequency: ["daily", "weekly", "custom"],
      schedule_trigger_type: ["fixed_time", "inactivity", "dynamic_window"],
      summary_status: ["pending_review", "approved", "rejected"],
      summary_tone: ["formal", "fun", "corporate"],
      tenant_member_role: ["owner", "admin", "member"],
      whatsapp_instance_status: [
        "disconnected",
        "connecting",
        "qrcode",
        "connected",
      ],
    },
  },
} as const
