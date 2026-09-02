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
      launch_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          launch_id: string
          payload: Json
          scheduled_for: string
          source: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          launch_id: string
          payload?: Json
          scheduled_for: string
          source: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          launch_id?: string
          payload?: Json
          scheduled_for?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_events_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_notification_deliveries: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          created_at: string
          error_class: string | null
          event_id: string
          id: string
          last_error: string | null
          launch_id: string
          next_attempt_at: string
          sent_at: string | null
          status: string
          subscription_id: string
          telegram_message_id: number | null
          telegram_user_id: number
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          created_at?: string
          error_class?: string | null
          event_id: string
          id?: string
          last_error?: string | null
          launch_id: string
          next_attempt_at?: string
          sent_at?: string | null
          status?: string
          subscription_id: string
          telegram_message_id?: number | null
          telegram_user_id: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          created_at?: string
          error_class?: string | null
          event_id?: string
          id?: string
          last_error?: string | null
          launch_id?: string
          next_attempt_at?: string
          sent_at?: string | null
          status?: string
          subscription_id?: string
          telegram_message_id?: number | null
          telegram_user_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_notification_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "launch_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_notification_deliveries_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_notification_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "launch_watch_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_schedule_communications: {
        Row: {
          baseline_launch_at: string | null
          baseline_timezone: string
          baseline_window_end: string | null
          baseline_window_start: string | null
          change_count: number
          created_at: string
          current_launch_at: string | null
          current_timezone: string
          current_window_end: string | null
          current_window_start: string | null
          detected_at: string
          detected_by: string | null
          id: string
          launch_id: string
          resolved_at: string | null
          resolved_by: string | null
          sent_client_request_id: string | null
          sent_event_id: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          baseline_launch_at?: string | null
          baseline_timezone: string
          baseline_window_end?: string | null
          baseline_window_start?: string | null
          change_count?: number
          created_at?: string
          current_launch_at?: string | null
          current_timezone: string
          current_window_end?: string | null
          current_window_start?: string | null
          detected_at?: string
          detected_by?: string | null
          id?: string
          launch_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          sent_client_request_id?: string | null
          sent_event_id?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          baseline_launch_at?: string | null
          baseline_timezone?: string
          baseline_window_end?: string | null
          baseline_window_start?: string | null
          change_count?: number
          created_at?: string
          current_launch_at?: string | null
          current_timezone?: string
          current_window_end?: string | null
          current_window_start?: string | null
          detected_at?: string
          detected_by?: string | null
          id?: string
          launch_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sent_client_request_id?: string | null
          sent_event_id?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_schedule_communications_detected_by_fkey"
            columns: ["detected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_schedule_communications_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_schedule_communications_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_schedule_communications_sent_event_id_fkey"
            columns: ["sent_event_id"]
            isOneToOne: false
            referencedRelation: "launch_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_schedule_communications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_watch_subscriptions: {
        Row: {
          confirmation_attempt_count: number
          confirmation_attempted_at: string | null
          confirmation_error_class: string | null
          confirmation_last_error: string | null
          confirmation_sent_at: string | null
          confirmation_status: string | null
          confirmation_telegram_message_id: number | null
          created_at: string
          id: string
          is_active: boolean
          last_interaction_at: string
          launch_id: string
          reminders_enabled: boolean
          source: string
          subscribed_at: string
          telegram_user_id: number
          unsubscribed_at: string | null
          updates_enabled: boolean
        }
        Insert: {
          confirmation_attempt_count?: number
          confirmation_attempted_at?: string | null
          confirmation_error_class?: string | null
          confirmation_last_error?: string | null
          confirmation_sent_at?: string | null
          confirmation_status?: string | null
          confirmation_telegram_message_id?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_interaction_at?: string
          launch_id: string
          reminders_enabled?: boolean
          source?: string
          subscribed_at?: string
          telegram_user_id: number
          unsubscribed_at?: string | null
          updates_enabled?: boolean
        }
        Update: {
          confirmation_attempt_count?: number
          confirmation_attempted_at?: string | null
          confirmation_error_class?: string | null
          confirmation_last_error?: string | null
          confirmation_sent_at?: string | null
          confirmation_status?: string | null
          confirmation_telegram_message_id?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_interaction_at?: string
          launch_id?: string
          reminders_enabled?: boolean
          source?: string
          subscribed_at?: string
          telegram_user_id?: number
          unsubscribed_at?: string | null
          updates_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "launch_watch_subscriptions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      launches: {
        Row: {
          announced_at: string | null
          chain: string
          completed_at: string | null
          contract_pending_at: string | null
          contract_registered_at: string | null
          contract_registered_by: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_notes: string | null
          launch_approaching_at: string | null
          launch_at: string | null
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          project_profile_id: string
          public_slug: string
          status: string
          status_changed_at: string
          status_changed_by: string | null
          ticker: string
          timezone: string
          token_name: string
          updated_at: string
          watchlist_opened_at: string | null
          workspace_id: string
        }
        Insert: {
          announced_at?: string | null
          chain: string
          completed_at?: string | null
          contract_pending_at?: string | null
          contract_registered_at?: string | null
          contract_registered_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          launch_approaching_at?: string | null
          launch_at?: string | null
          launch_watch_token?: string | null
          launch_watch_token_created_at?: string | null
          launch_window_end?: string | null
          launch_window_start?: string | null
          live_at?: string | null
          official_contract_address?: string | null
          project_profile_id: string
          public_slug: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          ticker: string
          timezone?: string
          token_name: string
          updated_at?: string
          watchlist_opened_at?: string | null
          workspace_id: string
        }
        Update: {
          announced_at?: string | null
          chain?: string
          completed_at?: string | null
          contract_pending_at?: string | null
          contract_registered_at?: string | null
          contract_registered_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          launch_approaching_at?: string | null
          launch_at?: string | null
          launch_watch_token?: string | null
          launch_watch_token_created_at?: string | null
          launch_window_end?: string | null
          launch_window_start?: string | null
          live_at?: string | null
          official_contract_address?: string | null
          project_profile_id?: string
          public_slug?: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          ticker?: string
          timezone?: string
          token_name?: string
          updated_at?: string
          watchlist_opened_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launches_contract_registered_by_fkey"
            columns: ["contract_registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_project_profile_id_fkey"
            columns: ["project_profile_id"]
            isOneToOne: false
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
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
      project_conversation_messages: {
        Row: {
          author_type: string
          body: string
          channel: string
          client_request_id: string | null
          conversation_id: string
          created_at: string
          id: string
          reply_to_message_id: string | null
          team_user_id: string | null
          telegram_chat_id: number | null
          telegram_message_id: number | null
          telegram_reply_to_message_id: number | null
          telegram_update_id: number | null
        }
        Insert: {
          author_type: string
          body: string
          channel: string
          client_request_id?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          reply_to_message_id?: string | null
          team_user_id?: string | null
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          telegram_reply_to_message_id?: number | null
          telegram_update_id?: number | null
        }
        Update: {
          author_type?: string
          body?: string
          channel?: string
          client_request_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          reply_to_message_id?: string | null
          team_user_id?: string | null
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          telegram_reply_to_message_id?: number | null
          telegram_update_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "project_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_conversation_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "project_conversation_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_conversation_messages_team_user_id_fkey"
            columns: ["team_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_conversations: {
        Row: {
          assigned_to: string | null
          category: string
          contact_id: string
          created_at: string
          id: string
          last_message_at: string
          opened_at: string
          origin_group_announcement_id: string | null
          origin_launch_delivery_id: string | null
          origin_launch_event_id: string | null
          origin_launch_id: string | null
          origin_telegram_message_id: number | null
          origin_text_snapshot: string | null
          origin_title_snapshot: string | null
          origin_type: string
          priority: string
          resolved_at: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          opened_at?: string
          origin_group_announcement_id?: string | null
          origin_launch_delivery_id?: string | null
          origin_launch_event_id?: string | null
          origin_launch_id?: string | null
          origin_telegram_message_id?: number | null
          origin_text_snapshot?: string | null
          origin_title_snapshot?: string | null
          origin_type: string
          priority?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          opened_at?: string
          origin_group_announcement_id?: string | null
          origin_launch_delivery_id?: string | null
          origin_launch_event_id?: string | null
          origin_launch_id?: string | null
          origin_telegram_message_id?: number | null
          origin_text_snapshot?: string | null
          origin_title_snapshot?: string | null
          origin_type?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_conversations_contact_ws_fkey"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "project_inbox_contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "project_conversations_origin_group_announcement_id_fkey"
            columns: ["origin_group_announcement_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_conversations_origin_launch_delivery_id_fkey"
            columns: ["origin_launch_delivery_id"]
            isOneToOne: false
            referencedRelation: "launch_notification_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_conversations_origin_launch_event_id_fkey"
            columns: ["origin_launch_event_id"]
            isOneToOne: false
            referencedRelation: "launch_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_conversations_origin_launch_id_fkey"
            columns: ["origin_launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      project_inbox_contacts: {
        Row: {
          blocked_at: string | null
          blocked_by: string | null
          created_at: string
          first_contact_at: string
          id: string
          last_contact_at: string
          member_ref: string
          status: string
          telegram_user_id: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          blocked_at?: string | null
          blocked_by?: string | null
          created_at?: string
          first_contact_at?: string
          id?: string
          last_contact_at?: string
          member_ref?: string
          status?: string
          telegram_user_id: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          blocked_at?: string | null
          blocked_by?: string | null
          created_at?: string
          first_contact_at?: string
          id?: string
          last_contact_at?: string
          member_ref?: string
          status?: string
          telegram_user_id?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_inbox_contacts_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_inbox_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_inbox_deliveries: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          attempt_count: number
          body_snapshot: string
          claimed_at: string | null
          conversation_id: string
          created_at: string
          error_class: string | null
          id: string
          last_error: string | null
          message_id: string
          next_attempt_at: string
          sent_at: string | null
          status: string
          team_user_id: string
          telegram_message_id: number | null
          telegram_user_id: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          attempt_count?: number
          body_snapshot: string
          claimed_at?: string | null
          conversation_id: string
          created_at?: string
          error_class?: string | null
          id?: string
          last_error?: string | null
          message_id: string
          next_attempt_at?: string
          sent_at?: string | null
          status?: string
          team_user_id: string
          telegram_message_id?: number | null
          telegram_user_id: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          attempt_count?: number
          body_snapshot?: string
          claimed_at?: string | null
          conversation_id?: string
          created_at?: string
          error_class?: string | null
          id?: string
          last_error?: string | null
          message_id?: string
          next_attempt_at?: string
          sent_at?: string | null
          status?: string
          team_user_id?: string
          telegram_message_id?: number | null
          telegram_user_id?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_inbox_deliveries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "project_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_inbox_deliveries_message_conv_fkey"
            columns: ["message_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "project_conversation_messages"
            referencedColumns: ["id", "conversation_id"]
          },
        ]
      }
      project_inbox_settings: {
        Row: {
          created_at: string
          new_conversations_enabled: boolean
          replies_enabled: boolean
          security_warning_version: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          new_conversations_enabled?: boolean
          replies_enabled?: boolean
          security_warning_version?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          new_conversations_enabled?: boolean
          replies_enabled?: boolean
          security_warning_version?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_inbox_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_inbox_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_inbox_team_preferences: {
        Row: {
          assigned_reply_alerts: boolean
          every_message_alerts: boolean
          new_conversation_alerts: boolean
          new_security_alerts: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          assigned_reply_alerts?: boolean
          every_message_alerts?: boolean
          new_conversation_alerts?: boolean
          new_security_alerts?: boolean
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          assigned_reply_alerts?: boolean
          every_message_alerts?: boolean
          new_conversation_alerts?: boolean
          new_security_alerts?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_inbox_team_preferences_member_fkey"
            columns: ["workspace_id", "user_id"]
            isOneToOne: true
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "user_id"]
          },
        ]
      }
      project_network_moderation: {
        Row: {
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          internal_reason: string | null
          is_hidden: boolean
          project_profile_id: string
          restored_at: string | null
          restored_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          internal_reason?: string | null
          is_hidden?: boolean
          project_profile_id: string
          restored_at?: string | null
          restored_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          internal_reason?: string | null
          is_hidden?: boolean
          project_profile_id?: string
          restored_at?: string | null
          restored_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_network_moderation_project_profile_id_fkey"
            columns: ["project_profile_id"]
            isOneToOne: true
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_platform_reviews: {
        Row: {
          internal_note: string | null
          project_profile_id: string
          requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          internal_note?: string | null
          project_profile_id: string
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          internal_note?: string | null
          project_profile_id?: string
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_platform_reviews_project_profile_id_fkey"
            columns: ["project_profile_id"]
            isOneToOne: true
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_profiles: {
        Row: {
          created_at: string
          description: string | null
          discovery_status: string
          id: string
          logo_asset_id: string | null
          primary_chain: string | null
          project_name: string
          public_slug: string
          telegram_url: string | null
          ticker: string | null
          updated_at: string
          website_url: string | null
          workspace_id: string
          x_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          discovery_status?: string
          id?: string
          logo_asset_id?: string | null
          primary_chain?: string | null
          project_name: string
          public_slug: string
          telegram_url?: string | null
          ticker?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id: string
          x_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          discovery_status?: string
          id?: string
          logo_asset_id?: string | null
          primary_chain?: string | null
          project_name?: string
          public_slug?: string
          telegram_url?: string | null
          ticker?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id?: string
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_profiles_logo_asset_id_fkey"
            columns: ["logo_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
      sticker_motion_versions: {
        Row: {
          created_at: string
          id: string
          motion_asset_id: string | null
          motion_instruction: string | null
          motion_mode: string | null
          motion_preset: string | null
          pack_id: string
          provider_metadata: Json
          source_static_asset_id: string | null
          source_static_version_id: string | null
          sticker_id: string
          telegram_asset_id: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          motion_asset_id?: string | null
          motion_instruction?: string | null
          motion_mode?: string | null
          motion_preset?: string | null
          pack_id: string
          provider_metadata?: Json
          source_static_asset_id?: string | null
          source_static_version_id?: string | null
          sticker_id: string
          telegram_asset_id?: string | null
          version_number: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          motion_asset_id?: string | null
          motion_instruction?: string | null
          motion_mode?: string | null
          motion_preset?: string | null
          pack_id?: string
          provider_metadata?: Json
          source_static_asset_id?: string | null
          source_static_version_id?: string | null
          sticker_id?: string
          telegram_asset_id?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_motion_versions_motion_asset_id_fkey"
            columns: ["motion_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_motion_versions_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_motion_versions_source_static_asset_id_fkey"
            columns: ["source_static_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_motion_versions_source_static_version_id_fkey"
            columns: ["source_static_version_id"]
            isOneToOne: false
            referencedRelation: "sticker_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_motion_versions_sticker_id_fkey"
            columns: ["sticker_id"]
            isOneToOne: false
            referencedRelation: "stickers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_motion_versions_telegram_asset_id_fkey"
            columns: ["telegram_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_motion_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
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
          archived_at: string | null
          archived_by: string | null
          brief: string | null
          character_name: string | null
          created_at: string
          created_by: string | null
          creative_blueprint: Json
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
          archived_at?: string | null
          archived_by?: string | null
          brief?: string | null
          character_name?: string | null
          created_at?: string
          created_by?: string | null
          creative_blueprint?: Json
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
          archived_at?: string | null
          archived_by?: string | null
          brief?: string | null
          character_name?: string | null
          created_at?: string
          created_by?: string | null
          creative_blueprint?: Json
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
            foreignKeyName: "sticker_packs_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      sticker_versions: {
        Row: {
          asset_id: string | null
          created_at: string
          id: string
          origin: string
          pack_id: string
          sticker_id: string
          variation_group_id: string | null
          variation_label: string | null
          version_number: number
          workspace_id: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          id?: string
          origin?: string
          pack_id: string
          sticker_id: string
          variation_group_id?: string | null
          variation_label?: string | null
          version_number: number
          workspace_id: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          id?: string
          origin?: string
          pack_id?: string
          sticker_id?: string
          variation_group_id?: string | null
          variation_label?: string | null
          version_number?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sticker_versions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_versions_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "sticker_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_versions_sticker_id_fkey"
            columns: ["sticker_id"]
            isOneToOne: false
            referencedRelation: "stickers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sticker_versions_workspace_id_fkey"
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
          current_motion_version_id: string | null
          emoji_list: string[]
          id: string
          image_asset_id: string | null
          keyword_list: string[]
          label: string
          pack_id: string
          prompt: string | null
          release_variant: string
          sort_order: number
          status: string
          telegram_file_id: string | null
          telegram_motion_file_id: string | null
          telegram_motion_version_id: string | null
          telegram_publish_error: string | null
          telegram_published_at: string | null
          telegram_static_file_id: string | null
          updated_at: string
        }
        Insert: {
          action_description?: string | null
          created_at?: string
          current_motion_version_id?: string | null
          emoji_list?: string[]
          id?: string
          image_asset_id?: string | null
          keyword_list?: string[]
          label: string
          pack_id: string
          prompt?: string | null
          release_variant?: string
          sort_order: number
          status?: string
          telegram_file_id?: string | null
          telegram_motion_file_id?: string | null
          telegram_motion_version_id?: string | null
          telegram_publish_error?: string | null
          telegram_published_at?: string | null
          telegram_static_file_id?: string | null
          updated_at?: string
        }
        Update: {
          action_description?: string | null
          created_at?: string
          current_motion_version_id?: string | null
          emoji_list?: string[]
          id?: string
          image_asset_id?: string | null
          keyword_list?: string[]
          label?: string
          pack_id?: string
          prompt?: string | null
          release_variant?: string
          sort_order?: number
          status?: string
          telegram_file_id?: string | null
          telegram_motion_file_id?: string | null
          telegram_motion_version_id?: string | null
          telegram_publish_error?: string | null
          telegram_published_at?: string | null
          telegram_static_file_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stickers_current_motion_version_id_fkey"
            columns: ["current_motion_version_id"]
            isOneToOne: false
            referencedRelation: "sticker_motion_versions"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "stickers_telegram_motion_version_id_fkey"
            columns: ["telegram_motion_version_id"]
            isOneToOne: false
            referencedRelation: "sticker_motion_versions"
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
          launch_watch_cta_auto_delete_seconds: number
          launch_watch_cta_enabled: boolean
          launch_watch_launch_id: string | null
          launch_watch_show_telegram: boolean
          launch_watch_show_website: boolean
          launch_watch_show_x: boolean
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
          launch_watch_cta_auto_delete_seconds?: number
          launch_watch_cta_enabled?: boolean
          launch_watch_launch_id?: string | null
          launch_watch_show_telegram?: boolean
          launch_watch_show_website?: boolean
          launch_watch_show_x?: boolean
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
          launch_watch_cta_auto_delete_seconds?: number
          launch_watch_cta_enabled?: boolean
          launch_watch_launch_id?: string | null
          launch_watch_show_telegram?: boolean
          launch_watch_show_website?: boolean
          launch_watch_show_x?: boolean
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
            foreignKeyName: "telegram_community_settings_launch_watch_launch_id_fkey"
            columns: ["launch_watch_launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
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
      telegram_group_announcements: {
        Row: {
          branding_logo_asset_id: string | null
          branding_logo_mime_type: string | null
          branding_logo_storage_path: string | null
          branding_project_name: string | null
          branding_template_version: string | null
          branding_ticker: string | null
          client_request_id: string
          cta_chain: string | null
          cta_enabled: boolean
          cta_launch_id: string | null
          cta_launch_status: string | null
          cta_project_name: string | null
          cta_ticker: string | null
          cta_token_name: string | null
          delivered_text_snapshot: string
          delivery_kind: string
          group_connection_id: string | null
          group_title: string
          id: string
          last_error: string | null
          message_text: string
          requested_at: string
          requested_by: string | null
          sent_at: string | null
          status: string
          telegram_chat_id: number
          telegram_message_id: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          branding_logo_asset_id?: string | null
          branding_logo_mime_type?: string | null
          branding_logo_storage_path?: string | null
          branding_project_name?: string | null
          branding_template_version?: string | null
          branding_ticker?: string | null
          client_request_id: string
          cta_chain?: string | null
          cta_enabled?: boolean
          cta_launch_id?: string | null
          cta_launch_status?: string | null
          cta_project_name?: string | null
          cta_ticker?: string | null
          cta_token_name?: string | null
          delivered_text_snapshot: string
          delivery_kind?: string
          group_connection_id?: string | null
          group_title: string
          id?: string
          last_error?: string | null
          message_text: string
          requested_at?: string
          requested_by?: string | null
          sent_at?: string | null
          status: string
          telegram_chat_id: number
          telegram_message_id?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          branding_logo_asset_id?: string | null
          branding_logo_mime_type?: string | null
          branding_logo_storage_path?: string | null
          branding_project_name?: string | null
          branding_template_version?: string | null
          branding_ticker?: string | null
          client_request_id?: string
          cta_chain?: string | null
          cta_enabled?: boolean
          cta_launch_id?: string | null
          cta_launch_status?: string | null
          cta_project_name?: string | null
          cta_ticker?: string | null
          cta_token_name?: string | null
          delivered_text_snapshot?: string
          delivery_kind?: string
          group_connection_id?: string | null
          group_title?: string
          id?: string
          last_error?: string | null
          message_text?: string
          requested_at?: string
          requested_by?: string | null
          sent_at?: string | null
          status?: string
          telegram_chat_id?: number
          telegram_message_id?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_group_announcements_branding_logo_asset_id_fkey"
            columns: ["branding_logo_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_group_announcements_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_group_announcements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
      telegram_inbound_updates: {
        Row: {
          conversation_message_id: string | null
          last_error: string | null
          processed_at: string | null
          received_at: string
          status: string
          telegram_chat_id: number | null
          telegram_message_id: number | null
          telegram_update_id: number
          telegram_user_id: number | null
          update_kind: string
          updated_at: string
        }
        Insert: {
          conversation_message_id?: string | null
          last_error?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          telegram_update_id: number
          telegram_user_id?: number | null
          update_kind: string
          updated_at?: string
        }
        Update: {
          conversation_message_id?: string | null
          last_error?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          telegram_update_id?: number
          telegram_user_id?: number | null
          update_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_inbound_updates_conversation_message_id_fkey"
            columns: ["conversation_message_id"]
            isOneToOne: false
            referencedRelation: "project_conversation_messages"
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
      telegram_message_cleanup_jobs: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          cleanup_kind: string
          created_at: string
          delete_after: string
          deleted_at: string | null
          error_class: string | null
          group_connection_id: string
          id: string
          last_error: string | null
          next_attempt_at: string
          status: string
          telegram_chat_id: number
          telegram_message_id: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          cleanup_kind?: string
          created_at?: string
          delete_after: string
          deleted_at?: string | null
          error_class?: string | null
          group_connection_id: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          status?: string
          telegram_chat_id: number
          telegram_message_id: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          cleanup_kind?: string
          created_at?: string
          delete_after?: string
          deleted_at?: string | null
          error_class?: string | null
          group_connection_id?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          status?: string
          telegram_chat_id?: number
          telegram_message_id?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_message_cleanup_jobs_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_message_cleanup_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_team_sessions: {
        Row: {
          active_conversation_id: string | null
          expires_at: string
          mode: string
          selected_workspace_id: string | null
          telegram_user_id: number
          updated_at: string
        }
        Insert: {
          active_conversation_id?: string | null
          expires_at: string
          mode?: string
          selected_workspace_id?: string | null
          telegram_user_id: number
          updated_at?: string
        }
        Update: {
          active_conversation_id?: string | null
          expires_at?: string
          mode?: string
          selected_workspace_id?: string | null
          telegram_user_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_team_sessions_active_conversation_id_fkey"
            columns: ["active_conversation_id"]
            isOneToOne: false
            referencedRelation: "project_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_team_sessions_selected_workspace_id_fkey"
            columns: ["selected_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_team_sessions_telegram_user_id_fkey"
            columns: ["telegram_user_id"]
            isOneToOne: true
            referencedRelation: "telegram_connections"
            referencedColumns: ["telegram_user_id"]
          },
        ]
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
      acknowledge_project_inbox_delivery: {
        Args: { _delivery_id: string; _workspace_id: string }
        Returns: {
          acknowledged_at: string
          delivery_id: string
          status: string
        }[]
      }
      archive_sticker_pack: { Args: { _pack_id: string }; Returns: Json }
      can_access_pack: {
        Args: { _pack_id: string; _user_id: string }
        Returns: boolean
      }
      capture_project_inbox_launch_reply: {
        Args: {
          _body: string
          _telegram_chat_id: number
          _telegram_message_id: number
          _telegram_reply_to_message_id: number
          _telegram_update_id: number
          _telegram_user_id: number
        }
        Returns: {
          conversation_id: string
          conversation_message_id: string
          outcome: string
          reason: string
        }[]
      }
      claim_launch_notification_deliveries: {
        Args: { _limit?: number }
        Returns: {
          attempt_count: number
          delivery_id: string
          event_id: string
          event_type: string
          launch_id: string
          payload: Json
          scheduled_for: string
          subscription_id: string
          telegram_user_id: number
        }[]
      }
      claim_project_inbox_deliveries: {
        Args: { _limit?: number }
        Returns: {
          attempt_count: number
          body_snapshot: string
          contact_blocked: boolean
          conversation_id: string
          delivery_id: string
          message_id: string
          replies_enabled: boolean
          team_user_id: string
          telegram_user_id: number
          workspace_id: string
        }[]
      }
      claim_telegram_message_cleanup_jobs: {
        Args: { _limit?: number }
        Returns: {
          attempt_count: number
          cleanup_kind: string
          job_id: string
          telegram_chat_id: number
          telegram_message_id: number
        }[]
      }
      create_launch_watcher_update: {
        Args: {
          _body: string
          _client_request_id: string
          _launch_id: string
          _title: string
        }
        Returns: string
      }
      create_project_inbox_team_reply: {
        Args: {
          _body: string
          _client_request_id: string
          _conversation_id: string
          _workspace_id: string
        }
        Returns: {
          delivery_id: string
          delivery_status: string
          message_id: string
          replayed: boolean
        }[]
      }
      delete_sticker_pack_if_eligible: {
        Args: { _pack_id: string }
        Returns: Json
      }
      dismiss_launch_schedule_communication: {
        Args: {
          _expected_change_count: number
          _expected_current_launch_at: string
          _expected_current_timezone: string
          _expected_current_window_end: string
          _expected_current_window_start: string
          _id: string
        }
        Returns: {
          baseline_launch_at: string | null
          baseline_timezone: string
          baseline_window_end: string | null
          baseline_window_start: string | null
          change_count: number
          created_at: string
          current_launch_at: string | null
          current_timezone: string
          current_window_end: string | null
          current_window_start: string | null
          detected_at: string
          detected_by: string | null
          id: string
          launch_id: string
          resolved_at: string | null
          resolved_by: string | null
          sent_client_request_id: string | null
          sent_event_id: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_schedule_communications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_due_launch_reminder_events: {
        Args: { _now?: string }
        Returns: number
      }
      finalize_project_inbox_delivery: {
        Args: {
          _delivery_id: string
          _error_class?: string
          _last_error?: string
          _outcome: string
          _retry_after_seconds?: number
          _telegram_message_id?: number
        }
        Returns: string
      }
      format_launch_schedule_snapshot: {
        Args: { _at: string; _tz: string; _we: string; _ws: string }
        Returns: string
      }
      get_cartel_network_launch: {
        Args: { _slug: string }
        Returns: {
          announced_at: string
          chain: string
          completed_at: string
          contract_pending_at: string
          contract_registered_at: string
          has_logo: boolean
          join_launch_watch_url: string
          launch_approaching_at: string
          launch_at: string
          launch_window_end: string
          launch_window_start: string
          live_at: string
          official_contract_address: string
          project_description: string
          project_name: string
          project_primary_chain: string
          project_public_slug: string
          project_ticker: string
          public_slug: string
          status: string
          telegram_url: string
          ticker: string
          timezone: string
          token_name: string
          verification_status: string
          verified_at: string
          watchlist_opened_at: string
          website_url: string
          x_url: string
        }[]
      }
      get_cartel_network_project: {
        Args: { _slug: string }
        Returns: {
          description: string
          has_logo: boolean
          primary_chain: string
          project_name: string
          public_slug: string
          telegram_url: string
          ticker: string
          verification_status: string
          verified_at: string
          website_url: string
          x_url: string
        }[]
      }
      get_cartel_network_project_launches: {
        Args: { _project_slug: string }
        Returns: {
          announced_at: string
          chain: string
          completed_at: string
          contract_registered_at: string
          join_launch_watch_url: string
          launch_at: string
          launch_window_end: string
          launch_window_start: string
          live_at: string
          official_contract_address: string
          public_slug: string
          status: string
          ticker: string
          timezone: string
          token_name: string
          watchlist_opened_at: string
        }[]
      }
      get_cartel_network_projects: {
        Args: {
          _chain?: string
          _limit?: number
          _offset?: number
          _search?: string
          _verified_only?: boolean
        }
        Returns: {
          current_launch_at: string
          current_launch_chain: string
          current_launch_slug: string
          current_launch_status: string
          current_launch_ticker: string
          current_launch_timezone: string
          current_launch_token_name: string
          current_launch_window_end: string
          current_launch_window_start: string
          description: string
          has_logo: boolean
          primary_chain: string
          project_name: string
          public_slug: string
          telegram_url: string
          ticker: string
          total_count: number
          verification_status: string
          verified_at: string
          website_url: string
          x_url: string
        }[]
      }
      get_cartel_network_signals: {
        Args: { _chain?: string; _limit?: number; _offset?: number }
        Returns: {
          chain: string
          has_logo: boolean
          launch_public_slug: string
          occurred_at: string
          official_contract_address: string
          project_name: string
          project_primary_chain: string
          project_public_slug: string
          signal_type: string
          status: string
          ticker: string
          token_name: string
          total_count: number
        }[]
      }
      get_cartel_network_summary: {
        Args: never
        Returns: {
          live_launches: number
          published_projects: number
          upcoming_launches: number
        }[]
      }
      get_cartel_network_upcoming_launches: {
        Args: {
          _chain?: string
          _limit?: number
          _offset?: number
          _search?: string
        }
        Returns: {
          announced_at: string
          chain: string
          has_logo: boolean
          join_launch_watch_url: string
          launch_at: string
          launch_window_end: string
          launch_window_start: string
          project_name: string
          project_primary_chain: string
          project_public_slug: string
          project_ticker: string
          public_slug: string
          status: string
          ticker: string
          timezone: string
          token_name: string
          total_count: number
          verification_status: string
          verified_at: string
          watchlist_opened_at: string
        }[]
      }
      get_launch_audience_summary: {
        Args: { _launch_id: string }
        Returns: {
          active_watchers: number
          last_ambiguous_watchers: number
          last_delivery_at: string
          last_failed_watchers: number
          last_inflight_watchers: number
          last_sent_watchers: number
          last_skipped_watchers: number
          never_contacted_watchers: number
          reminders_enabled_watchers: number
          reminders_muted_watchers: number
          total_watchers: number
          updates_enabled_watchers: number
          updates_muted_watchers: number
        }[]
      }
      get_launch_notification_summary: {
        Args: { _launch_id: string }
        Returns: {
          ambiguous_count: number
          event_count: number
          failed_count: number
          pending_count: number
          reminder_enabled_watchers: number
          sent_count: number
          skipped_count: number
        }[]
      }
      get_launch_watch_confirmation_summary: {
        Args: { _launch_id: string }
        Returns: {
          ambiguous_count: number
          attempted_count: number
          delivered_count: number
          failed_count: number
          untracked_count: number
        }[]
      }
      get_launch_watch_summary: {
        Args: { _launch_id: string }
        Returns: {
          active_count: number
          total_count: number
        }[]
      }
      get_launch_watcher_update_stats: {
        Args: { _launch_id: string }
        Returns: {
          active_watchers: number
          updates_enabled_watchers: number
          updates_muted_watchers: number
        }[]
      }
      get_my_launch_watchlist: {
        Args: never
        Returns: {
          chain: string
          contract_registered_at: string
          has_logo: boolean
          launch_at: string
          launch_public_slug: string
          launch_window_end: string
          launch_window_start: string
          live_at: string
          official_contract_address: string
          project_name: string
          project_primary_chain: string
          project_public_slug: string
          reminders_enabled: boolean
          status: string
          subscribed_at: string
          ticker: string
          timezone: string
          token_name: string
        }[]
      }
      get_my_launch_watchlist_state: {
        Args: never
        Returns: {
          active_watch_count: number
          telegram_connected: boolean
        }[]
      }
      get_my_project_inbox_team_preferences: {
        Args: { _workspace_id: string }
        Returns: {
          assigned_reply_alerts: boolean
          every_message_alerts: boolean
          new_conversation_alerts: boolean
          new_security_alerts: boolean
          updated_at: string
          workspace_id: string
        }[]
      }
      get_platform_launch_analytics: {
        Args: never
        Returns: {
          connected_groups: number
          contracts_registered: number
          deliveries_by_status: Json
          deliveries_failed: number
          deliveries_pending: number
          deliveries_retried: number
          deliveries_sent: number
          launch_events_total: number
          launch_watch_cta_enabled: number
          launches_by_status: Json
          launches_scheduled: number
          launches_total: number
          launches_with_active_watchers: number
          opt_ins_30d: number
          opt_ins_7d: number
          per_launch: Json
          projects_operator_hidden: number
          projects_platform_hidden: number
          projects_published: number
          projects_total: number
          projects_verified: number
          reminders_enabled: number
          reminders_muted: number
          verification_pending: number
          watch_active: number
          watch_stopped: number
          welcomes_enabled: number
        }[]
      }
      get_platform_network_moderation: {
        Args: never
        Returns: {
          discovery_status: string
          hidden_at: string
          internal_reason: string
          is_hidden: boolean
          launch_count: number
          primary_chain: string
          project_name: string
          project_profile_id: string
          public_slug: string
          restored_at: string
          ticker: string
          verification_status: string
        }[]
      }
      get_platform_owner_dashboard_metrics: { Args: never; Returns: Json }
      get_platform_project_verifications: {
        Args: never
        Returns: {
          discovery_status: string
          primary_chain: string
          profile_updated_at: string
          project_name: string
          project_profile_id: string
          public_slug: string
          requested_at: string
          reviewed_at: string
          telegram_url: string
          ticker: string
          verification_status: string
          verified_at: string
          website_url: string
          workspace_name: string
          x_url: string
        }[]
      }
      get_project_inbox_conversation: {
        Args: { _conversation_id: string; _workspace_id: string }
        Returns: {
          assigned_display_name: string
          assigned_to: string
          category: string
          contact_status: string
          conversation_id: string
          last_message_at: string
          member_ref: string
          opened_at: string
          origin_text_snapshot: string
          origin_title_snapshot: string
          origin_type: string
          priority: string
          resolved_at: string
          status: string
        }[]
      }
      get_project_inbox_settings: {
        Args: { _workspace_id: string }
        Returns: {
          new_conversations_enabled: boolean
          replies_enabled: boolean
          security_warning_version: string
          updated_at: string
          workspace_id: string
        }[]
      }
      get_project_inbox_summary: {
        Args: { _workspace_id: string }
        Returns: {
          blocked_contact_count: number
          open_count: number
          resolved_count: number
          waiting_on_member_count: number
          waiting_on_team_count: number
        }[]
      }
      get_project_verification_state: {
        Args: { _project_profile_id: string }
        Returns: {
          project_authenticated: boolean
          requested_at: string
          reviewed_at: string
          verification_status: string
          verified_at: string
        }[]
      }
      has_platform_unrestricted_access: {
        Args: { _user_id: string }
        Returns: boolean
      }
      invoke_launch_notification_scheduler: { Args: never; Returns: number }
      invoke_sticker_drop_scheduler: { Args: never; Returns: number }
      invoke_telegram_message_cleanup_scheduler: {
        Args: never
        Returns: number
      }
      is_platform_owner: { Args: { _user_id: string }; Returns: boolean }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_operator: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_owner: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      launch_notification_payload: {
        Args: { _launch_id: string }
        Returns: Json
      }
      launch_notification_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      list_launch_watcher_updates: {
        Args: { _launch_id: string; _limit?: number }
        Returns: {
          ambiguous_count: number
          body: string
          created_at: string
          event_id: string
          failed_count: number
          pending_count: number
          sent_count: number
          skipped_count: number
          title: string
        }[]
      }
      list_project_conversation_messages: {
        Args: { _conversation_id: string; _limit?: number }
        Returns: {
          author_type: string
          body: string
          channel: string
          created_at: string
          delivery_acknowledged_at: string
          delivery_error_class: string
          delivery_id: string
          delivery_status: string
          message_id: string
          reply_to_message_id: string
          team_display_name: string
        }[]
      }
      list_project_inbox_conversations: {
        Args: { _limit?: number; _status?: string; _workspace_id: string }
        Returns: {
          assigned_display_name: string
          assigned_to: string
          category: string
          contact_status: string
          conversation_id: string
          last_message_at: string
          latest_message_preview: string
          member_ref: string
          opened_at: string
          origin_title_snapshot: string
          origin_type: string
          priority: string
          status: string
        }[]
      }
      mark_stale_launch_notification_claims: { Args: never; Returns: number }
      mark_stale_project_inbox_delivery_claims: { Args: never; Returns: number }
      project_inbox_delivery_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      record_launch_watch_confirmation: {
        Args: {
          _attempted_at: string
          _error_class?: string
          _last_error?: string
          _message_id?: number
          _status: string
          _subscription_id: string
        }
        Returns: undefined
      }
      request_project_verification: {
        Args: { _project_profile_id: string }
        Returns: {
          requested_at: string
          verification_status: string
        }[]
      }
      restore_sticker_pack: { Args: { _pack_id: string }; Returns: Json }
      review_project_verification: {
        Args: {
          _action: string
          _internal_note?: string
          _project_profile_id: string
        }
        Returns: {
          reviewed_at: string
          verification_status: string
          verified_at: string
        }[]
      }
      send_launch_schedule_communication: {
        Args: {
          _client_request_id: string
          _expected_change_count: number
          _expected_current_launch_at: string
          _expected_current_timezone: string
          _expected_current_window_end: string
          _expected_current_window_start: string
          _id: string
          _note?: string
        }
        Returns: string
      }
      set_launch_contract_address: {
        Args: { _contract_address: string; _launch_id: string }
        Returns: {
          announced_at: string | null
          chain: string
          completed_at: string | null
          contract_pending_at: string | null
          contract_registered_at: string | null
          contract_registered_by: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_notes: string | null
          launch_approaching_at: string | null
          launch_at: string | null
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          project_profile_id: string
          public_slug: string
          status: string
          status_changed_at: string
          status_changed_by: string | null
          ticker: string
          timezone: string
          token_name: string
          updated_at: string
          watchlist_opened_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_my_project_inbox_team_preferences: {
        Args: {
          _assigned_reply_alerts: boolean
          _every_message_alerts: boolean
          _new_conversation_alerts: boolean
          _new_security_alerts: boolean
          _workspace_id: string
        }
        Returns: {
          assigned_reply_alerts: boolean
          every_message_alerts: boolean
          new_conversation_alerts: boolean
          new_security_alerts: boolean
          updated_at: string
          workspace_id: string
        }[]
      }
      set_project_inbox_contact_blocked: {
        Args: { _blocked: boolean; _contact_id: string }
        Returns: {
          blocked_at: string
          contact_id: string
          member_ref: string
          status: string
        }[]
      }
      set_project_inbox_conversation_contact_blocked: {
        Args: {
          _blocked: boolean
          _conversation_id: string
          _workspace_id: string
        }
        Returns: {
          blocked_at: string
          contact_status: string
          conversation_id: string
          member_ref: string
        }[]
      }
      set_project_inbox_settings: {
        Args: {
          _new_conversations_enabled: boolean
          _replies_enabled: boolean
          _workspace_id: string
        }
        Returns: {
          new_conversations_enabled: boolean
          replies_enabled: boolean
          security_warning_version: string
          updated_at: string
          workspace_id: string
        }[]
      }
      set_project_network_moderation: {
        Args: {
          _hidden: boolean
          _internal_reason?: string
          _project_profile_id: string
        }
        Returns: {
          hidden_at: string
          internal_reason: string
          is_hidden: boolean
          project_profile_id: string
          restored_at: string
        }[]
      }
      set_sticker_current_version: {
        Args: { _sticker_id: string; _version_id: string }
        Returns: Json
      }
      sticker_drop_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      sticker_pack_lifecycle_state: {
        Args: { _pack_id: string }
        Returns: Json
      }
      telegram_message_cleanup_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      transition_launch_status: {
        Args: { _launch_id: string; _target_status: string }
        Returns: {
          announced_at: string | null
          chain: string
          completed_at: string | null
          contract_pending_at: string | null
          contract_registered_at: string | null
          contract_registered_by: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_notes: string | null
          launch_approaching_at: string | null
          launch_at: string | null
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          project_profile_id: string
          public_slug: string
          status: string
          status_changed_at: string
          status_changed_by: string | null
          ticker: string
          timezone: string
          token_name: string
          updated_at: string
          watchlist_opened_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_conversation_status: {
        Args: { _conversation_id: string; _status: string }
        Returns: {
          conversation_id: string
          resolved_at: string
          status: string
          updated_at: string
        }[]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
