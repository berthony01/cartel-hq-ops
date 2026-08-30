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
      ai_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          input_json: Json
          job_type: string
          output_json: Json
          pack_id: string | null
          provider: string | null
          provider_cost: number | null
          provider_model: string | null
          provider_task_id: string | null
          status: string
          sticker_id: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_json?: Json
          job_type: string
          output_json?: Json
          pack_id?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_model?: string | null
          provider_task_id?: string | null
          status?: string
          sticker_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_json?: Json
          job_type?: string
          output_json?: Json
          pack_id?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_model?: string | null
          provider_task_id?: string | null
          status?: string
          sticker_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_jobs_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_sticker_id_fkey"
            columns: ["sticker_id"]
            isOneToOne: false
            referencedRelation: "stickers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kits: {
        Row: {
          ai_style_notes: string | null
          approved_phrases: Json
          brand_name: string
          colors: Json
          created_at: string
          description: string | null
          fonts: Json
          id: string
          metadata: Json
          prohibited_styles: Json
          telegram_url: string | null
          ticker: string | null
          updated_at: string
          website_url: string | null
          workspace_id: string
          x_url: string | null
        }
        Insert: {
          ai_style_notes?: string | null
          approved_phrases?: Json
          brand_name: string
          colors?: Json
          created_at?: string
          description?: string | null
          fonts?: Json
          id?: string
          metadata?: Json
          prohibited_styles?: Json
          telegram_url?: string | null
          ticker?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id: string
          x_url?: string | null
        }
        Update: {
          ai_style_notes?: string | null
          approved_phrases?: Json
          brand_name?: string
          colors?: Json
          created_at?: string
          description?: string | null
          fonts?: Json
          id?: string
          metadata?: Json
          prohibited_styles?: Json
          telegram_url?: string | null
          ticker?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id?: string
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_kits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          asset_type: string
          created_at: string
          file_size_bytes: number | null
          height: number | null
          id: string
          metadata: Json
          mime_type: string | null
          storage_path: string
          transparency_valid: boolean | null
          uploaded_by: string | null
          width: number | null
          workspace_id: string
        }
        Insert: {
          asset_type: string
          created_at?: string
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          storage_path: string
          transparency_valid?: boolean | null
          uploaded_by?: string | null
          width?: number | null
          workspace_id: string
        }
        Update: {
          asset_type?: string
          created_at?: string
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          storage_path?: string
          transparency_valid?: boolean | null
          uploaded_by?: string | null
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_message_templates: {
        Row: {
          created_at: string
          draft_body: string
          draft_updated_at: string | null
          key: string
          published_at: string | null
          published_body: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          draft_body: string
          draft_updated_at?: string | null
          key: string
          published_at?: string | null
          published_body?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          draft_body?: string
          draft_updated_at?: string | null
          key?: string
          published_at?: string | null
          published_body?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sticker_drop_events: {
        Row: {
          created_at: string
          error_message: string | null
          group_connection_id: string
          id: string
          local_date: string
          pack_id: string
          schedule_id: string | null
          status: string
          sticker_id: string | null
          telegram_message_id: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          group_connection_id: string
          id?: string
          local_date: string
          pack_id: string
          schedule_id?: string | null
          status: string
          sticker_id?: string | null
          telegram_message_id?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          group_connection_id?: string
          id?: string
          local_date?: string
          pack_id?: string
          schedule_id?: string | null
          status?: string
          sticker_id?: string | null
          telegram_message_id?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_drop_events_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_events_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_events_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "sticker_drop_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_events_sticker_id_fkey"
            columns: ["sticker_id"]
            isOneToOne: false
            referencedRelation: "stickers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_drop_schedules: {
        Row: {
          active_end: string
          active_start: string
          approved_only: boolean
          consecutive_failures: number
          created_at: string
          created_by: string | null
          daily_cap: number
          enabled: boolean
          group_connection_id: string
          id: string
          interval_minutes: number
          last_sent_at: string | null
          last_sticker_id: string | null
          next_run_at: string | null
          no_immediate_repeat: boolean
          pack_id: string
          paused_reason: string | null
          selected_sticker_ids: string[]
          silent: boolean
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active_end?: string
          active_start?: string
          approved_only?: boolean
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          daily_cap?: number
          enabled?: boolean
          group_connection_id: string
          id?: string
          interval_minutes?: number
          last_sent_at?: string | null
          last_sticker_id?: string | null
          next_run_at?: string | null
          no_immediate_repeat?: boolean
          pack_id: string
          paused_reason?: string | null
          selected_sticker_ids?: string[]
          silent?: boolean
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active_end?: string
          active_start?: string
          approved_only?: boolean
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          daily_cap?: number
          enabled?: boolean
          group_connection_id?: string
          id?: string
          interval_minutes?: number
          last_sent_at?: string | null
          last_sticker_id?: string | null
          next_run_at?: string | null
          no_immediate_repeat?: boolean
          pack_id?: string
          paused_reason?: string | null
          selected_sticker_ids?: string[]
          silent?: boolean
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_drop_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_schedules_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_schedules_last_sticker_id_fkey"
            columns: ["last_sticker_id"]
            isOneToOne: false
            referencedRelation: "stickers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_schedules_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_schedules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_drop_workspace_controls: {
        Row: {
          kill_switch: boolean
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          kill_switch?: boolean
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          kill_switch?: boolean
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_drop_workspace_controls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_drop_workspace_controls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_pack_group_targets: {
        Row: {
          announced_at: string | null
          assigned_at: string | null
          created_at: string
          group_connection_id: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          pack_id: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          announced_at?: string | null
          assigned_at?: string | null
          created_at?: string
          group_connection_id: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          pack_id: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          announced_at?: string | null
          assigned_at?: string | null
          created_at?: string
          group_connection_id?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          pack_id?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_pack_group_targets_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_pack_group_targets_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_pack_group_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sticker_packs: {
        Row: {
          brief: string | null
          character_name: string | null
          created_at: string
          created_by: string | null
          id: string
          pack_size: number
          reference_asset_id: string | null
          status: string
          style_notes: string | null
          telegram_group_connection_id: string | null
          telegram_publish_error: string | null
          telegram_published_at: string | null
          telegram_set_name: string | null
          telegram_set_url: string | null
          theme: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brief?: string | null
          character_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pack_size: number
          reference_asset_id?: string | null
          status?: string
          style_notes?: string | null
          telegram_group_connection_id?: string | null
          telegram_publish_error?: string | null
          telegram_published_at?: string | null
          telegram_set_name?: string | null
          telegram_set_url?: string | null
          theme?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brief?: string | null
          character_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pack_size?: number
          reference_asset_id?: string | null
          status?: string
          style_notes?: string | null
          telegram_group_connection_id?: string | null
          telegram_publish_error?: string | null
          telegram_published_at?: string | null
          telegram_set_name?: string | null
          telegram_set_url?: string | null
          theme?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_packs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_packs_reference_asset_id_fkey"
            columns: ["reference_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_packs_telegram_group_connection_id_fkey"
            columns: ["telegram_group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_packs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stickers: {
        Row: {
          action_description: string | null
          created_at: string
          emoji_list: string[]
          id: string
          image_asset_id: string | null
          keyword_list: string[]
          label: string
          pack_id: string
          prompt: string | null
          sort_order: number
          status: string
          telegram_file_id: string | null
          telegram_publish_error: string | null
          telegram_published_at: string | null
          updated_at: string
        }
        Insert: {
          action_description?: string | null
          created_at?: string
          emoji_list?: string[]
          id?: string
          image_asset_id?: string | null
          keyword_list?: string[]
          label: string
          pack_id: string
          prompt?: string | null
          sort_order: number
          status?: string
          telegram_file_id?: string | null
          telegram_publish_error?: string | null
          telegram_published_at?: string | null
          updated_at?: string
        }
        Update: {
          action_description?: string | null
          created_at?: string
          emoji_list?: string[]
          id?: string
          image_asset_id?: string | null
          keyword_list?: string[]
          label?: string
          pack_id?: string
          prompt?: string | null
          sort_order?: number
          status?: string
          telegram_file_id?: string | null
          telegram_publish_error?: string | null
          telegram_published_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stickers_image_asset_id_fkey"
            columns: ["image_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stickers_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_beta_contacts: {
        Row: {
          chat_title: string | null
          chat_type: string | null
          created_at: string
          first_name: string | null
          id: string
          installer_telegram_user_id: number | null
          is_linked_user: boolean
          last_name: string | null
          last_seen_at: string
          metadata: Json
          opted_in: boolean
          opted_in_at: string | null
          source: string
          source_chat_id: number | null
          source_chat_title: string | null
          source_chat_type: string | null
          subject_type: string
          telegram_chat_id: number | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string
          welcome_sent_at: string | null
        }
        Insert: {
          chat_title?: string | null
          chat_type?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          installer_telegram_user_id?: number | null
          is_linked_user?: boolean
          last_name?: string | null
          last_seen_at?: string
          metadata?: Json
          opted_in?: boolean
          opted_in_at?: string | null
          source: string
          source_chat_id?: number | null
          source_chat_title?: string | null
          source_chat_type?: string | null
          subject_type: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          welcome_sent_at?: string | null
        }
        Update: {
          chat_title?: string | null
          chat_type?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          installer_telegram_user_id?: number | null
          is_linked_user?: boolean
          last_name?: string | null
          last_seen_at?: string
          metadata?: Json
          opted_in?: boolean
          opted_in_at?: string | null
          source?: string
          source_chat_id?: number | null
          source_chat_title?: string | null
          source_chat_type?: string | null
          subject_type?: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          welcome_sent_at?: string | null
        }
        Relationships: []
      }
      telegram_community_settings: {
        Row: {
          auto_delete_enabled: boolean
          auto_delete_seconds: number
          created_at: string
          group_connection_id: string
          mention_member: boolean
          metadata: Json
          updated_at: string
          welcome_enabled: boolean
          welcome_message: string
          workspace_id: string
        }
        Insert: {
          auto_delete_enabled?: boolean
          auto_delete_seconds?: number
          created_at?: string
          group_connection_id: string
          mention_member?: boolean
          metadata?: Json
          updated_at?: string
          welcome_enabled?: boolean
          welcome_message?: string
          workspace_id: string
        }
        Update: {
          auto_delete_enabled?: boolean
          auto_delete_seconds?: number
          created_at?: string
          group_connection_id?: string
          mention_member?: boolean
          metadata?: Json
          updated_at?: string
          welcome_enabled?: boolean
          welcome_message?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_community_settings_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: true
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_community_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_connections: {
        Row: {
          connected_at: string
          first_name: string | null
          id: string
          last_name: string | null
          metadata: Json
          telegram_user_id: number
          telegram_username: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          telegram_user_id: number
          telegram_username?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          metadata?: Json
          telegram_user_id?: number
          telegram_username?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_group_connections: {
        Row: {
          bot_is_admin: boolean
          can_set_sticker_set: boolean
          chat_type: string
          connected_at: string
          connected_by: string
          created_at: string
          id: string
          metadata: Json
          telegram_chat_id: number
          title: string
          username: string | null
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          bot_is_admin?: boolean
          can_set_sticker_set?: boolean
          chat_type: string
          connected_at?: string
          connected_by: string
          created_at?: string
          id?: string
          metadata?: Json
          telegram_chat_id: number
          title: string
          username?: string | null
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          bot_is_admin?: boolean
          can_set_sticker_set?: boolean
          chat_type?: string
          connected_at?: string
          connected_by?: string
          created_at?: string
          id?: string
          metadata?: Json
          telegram_chat_id?: number
          title?: string
          username?: string | null
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_group_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_requests: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          metadata: Json
          status: string
          telegram_user_id: number | null
          token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          metadata?: Json
          status?: string
          telegram_user_id?: number | null
          token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json
          status?: string
          telegram_user_id?: number | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_ledger: {
        Row: {
          action_type: string
          ai_job_id: string | null
          created_at: string
          id: string
          internal_cost: number | null
          provider_cost: number | null
          units: number
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action_type: string
          ai_job_id?: string | null
          created_at?: string
          id?: string
          internal_cost?: number | null
          provider_cost?: number | null
          units?: number
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action_type?: string
          ai_job_id?: string | null
          created_at?: string
          id?: string
          internal_cost?: number | null
          provider_cost?: number | null
          units?: number
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_ai_job_id_fkey"
            columns: ["ai_job_id"]
            isOneToOne: false
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_pack: {
        Args: { _pack_id: string; _user_id: string }
        Returns: boolean
      }
      get_platform_owner_dashboard_metrics: { Args: never; Returns: Json }
      has_platform_unrestricted_access: {
        Args: { _user_id: string }
        Returns: boolean
      }
      invoke_sticker_drop_scheduler: { Args: never; Returns: number }
      is_platform_owner: { Args: { _user_id: string }; Returns: boolean }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_owner: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      sticker_drop_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
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
