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
      launch_chain_deployments: {
        Row: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        Insert: {
          artifact_id?: string | null
          attempt_number: number
          block_hash?: string | null
          block_number?: number | null
          chain_id: number
          client_request_id: string
          confirmations?: number
          contract_address?: string | null
          created_at?: string
          created_by?: string | null
          deployer_address: string
          deployment_kind?: string
          failure_code?: string | null
          failure_detail?: string | null
          finality_last_checked_at?: string | null
          finality_notice?: string | null
          finality_provider_kind?: string | null
          finality_state?: string
          finalized_at?: string | null
          finalized_block_hash_confirmed?: boolean | null
          finalized_block_number?: number | null
          finalized_head_block_number?: number | null
          id?: string
          init_code_hash?: string | null
          last_checked_at?: string | null
          launch_id: string
          network_environment: string
          review_fingerprint?: string | null
          status?: string
          submitted_at?: string | null
          token_decimals?: number | null
          token_name?: string | null
          token_recipient?: string | null
          token_symbol?: string | null
          token_total_supply?: number | null
          token_total_supply_text?: string | null
          tx_hash?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_recipient_balance?: number | null
          verified_recipient_balance_text?: string | null
          verified_token_decimals?: number | null
          verified_token_name?: string | null
          verified_token_symbol?: string | null
          verified_total_supply?: number | null
          verified_total_supply_text?: string | null
          workspace_id: string
        }
        Update: {
          artifact_id?: string | null
          attempt_number?: number
          block_hash?: string | null
          block_number?: number | null
          chain_id?: number
          client_request_id?: string
          confirmations?: number
          contract_address?: string | null
          created_at?: string
          created_by?: string | null
          deployer_address?: string
          deployment_kind?: string
          failure_code?: string | null
          failure_detail?: string | null
          finality_last_checked_at?: string | null
          finality_notice?: string | null
          finality_provider_kind?: string | null
          finality_state?: string
          finalized_at?: string | null
          finalized_block_hash_confirmed?: boolean | null
          finalized_block_number?: number | null
          finalized_head_block_number?: number | null
          id?: string
          init_code_hash?: string | null
          last_checked_at?: string | null
          launch_id?: string
          network_environment?: string
          review_fingerprint?: string | null
          status?: string
          submitted_at?: string | null
          token_decimals?: number | null
          token_name?: string | null
          token_recipient?: string | null
          token_symbol?: string | null
          token_total_supply?: number | null
          token_total_supply_text?: string | null
          tx_hash?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_recipient_balance?: number | null
          verified_recipient_balance_text?: string | null
          verified_token_decimals?: number | null
          verified_token_name?: string | null
          verified_token_symbol?: string | null
          verified_total_supply?: number | null
          verified_total_supply_text?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_chain_deployments_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_chain_deployments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_chain_production_canary_permits: {
        Row: {
          authorization_expires_at: string
          authorization_id: string
          chain_id: number
          control_revision: number
          deployer_address: string
          deployment_id: string
          expires_at: string
          id: string
          init_code_hash: string
          issued_at: string
          launch_id: string
          network_environment: string
          operator_user_id: string
          reason: string
          review_fingerprint: string
          workspace_id: string
        }
        Insert: {
          authorization_expires_at: string
          authorization_id: string
          chain_id: number
          control_revision: number
          deployer_address: string
          deployment_id: string
          expires_at: string
          id?: string
          init_code_hash: string
          issued_at?: string
          launch_id: string
          network_environment: string
          operator_user_id: string
          reason: string
          review_fingerprint: string
          workspace_id: string
        }
        Update: {
          authorization_expires_at?: string
          authorization_id?: string
          chain_id?: number
          control_revision?: number
          deployer_address?: string
          deployment_id?: string
          expires_at?: string
          id?: string
          init_code_hash?: string
          issued_at?: string
          launch_id?: string
          network_environment?: string
          operator_user_id?: string
          reason?: string
          review_fingerprint?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_chain_production_canary_permits_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: true
            referencedRelation: "launch_chain_production_presign_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_chain_production_canary_permits_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_chain_production_execution_control_events: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_emergency_stop_engaged: boolean
          new_execution_enabled: boolean
          previous_emergency_stop_engaged: boolean | null
          previous_execution_enabled: boolean | null
          reason: string
          revision: number
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_emergency_stop_engaged: boolean
          new_execution_enabled: boolean
          previous_emergency_stop_engaged?: boolean | null
          previous_execution_enabled?: boolean | null
          reason: string
          revision: number
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_emergency_stop_engaged?: boolean
          new_execution_enabled?: boolean
          previous_emergency_stop_engaged?: boolean | null
          previous_execution_enabled?: boolean | null
          reason?: string
          revision?: number
        }
        Relationships: []
      }
      launch_chain_production_execution_controls: {
        Row: {
          control_key: string
          emergency_stop_engaged: boolean
          execution_enabled: boolean
          reason: string
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          control_key: string
          emergency_stop_engaged?: boolean
          execution_enabled?: boolean
          reason: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          control_key?: string
          emergency_stop_engaged?: boolean
          execution_enabled?: boolean
          reason?: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      launch_chain_production_presign_authorizations: {
        Row: {
          chain_id: number
          claimed_at: string | null
          client_request_id: string
          consumed_at: string | null
          consumed_tx_hash: string | null
          created_at: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id: string
          init_code_hash: string
          invalidated_at: string | null
          invalidated_reason: string | null
          issued_at: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status: string
          ttl_seconds: number
          tx_value_wei: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          chain_id: number
          claimed_at?: string | null
          client_request_id: string
          consumed_at?: string | null
          consumed_tx_hash?: string | null
          created_at?: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id?: string
          init_code_hash: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          issued_at?: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text?: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status?: string
          ttl_seconds: number
          tx_value_wei?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          chain_id?: number
          claimed_at?: string | null
          client_request_id?: string
          consumed_at?: string | null
          consumed_tx_hash?: string | null
          created_at?: string
          deployer_address?: string
          deployment_id?: string
          estimated_cost_wei_text?: string
          expires_at?: string
          fee_model?: string
          gas_estimate_text?: string
          gas_limit_text?: string
          id?: string
          init_code_hash?: string
          invalidated_at?: string | null
          invalidated_reason?: string | null
          issued_at?: string
          launch_id?: string
          max_fee_per_gas_wei_text?: string
          max_priority_fee_per_gas_wei_text?: string | null
          max_total_cost_wei_text?: string
          network_environment?: string
          observed_fee_per_gas_wei_text?: string
          operator_user_id?: string
          review_fingerprint?: string
          status?: string
          ttl_seconds?: number
          tx_value_wei?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_chain_production_presign_authorizatio_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_chain_production_send_window_issuances: {
        Row: {
          authorization_expires_at: string
          authorization_id: string
          canary_permit_id: string
          chain_id: number
          claimed_at: string
          control_revision: number
          deployment_id: string
          id: string
          init_code_hash: string
          issued_at: string
          launch_id: string
          network_environment: string
          operator_user_id: string
          review_fingerprint: string
          send_window_expires_at: string
          workspace_id: string
        }
        Insert: {
          authorization_expires_at: string
          authorization_id: string
          canary_permit_id: string
          chain_id: number
          claimed_at: string
          control_revision: number
          deployment_id: string
          id?: string
          init_code_hash: string
          issued_at?: string
          launch_id: string
          network_environment: string
          operator_user_id: string
          review_fingerprint: string
          send_window_expires_at: string
          workspace_id: string
        }
        Update: {
          authorization_expires_at?: string
          authorization_id?: string
          canary_permit_id?: string
          chain_id?: number
          claimed_at?: string
          control_revision?: number
          deployment_id?: string
          id?: string
          init_code_hash?: string
          issued_at?: string
          launch_id?: string
          network_environment?: string
          operator_user_id?: string
          review_fingerprint?: string
          send_window_expires_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_chain_production_send_window_issua_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: true
            referencedRelation: "launch_chain_production_presign_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_chain_production_send_window_issua_canary_permit_id_fkey"
            columns: ["canary_permit_id"]
            isOneToOne: true
            referencedRelation: "launch_chain_production_canary_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_chain_production_send_window_issuance_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_contract_registration_events: {
        Row: {
          action: string
          actor_id: string
          contract_address: string
          correction_reason: string | null
          created_at: string
          deployment_id: string
          evidence_snapshot: Json
          id: string
          launch_id: string
          superseded_event_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id: string
          contract_address: string
          correction_reason?: string | null
          created_at?: string
          deployment_id: string
          evidence_snapshot: Json
          id?: string
          launch_id: string
          superseded_event_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          contract_address?: string
          correction_reason?: string | null
          created_at?: string
          deployment_id?: string
          evidence_snapshot?: Json
          id?: string
          launch_id?: string
          superseded_event_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_contract_registration_events_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_contract_registration_events_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_contract_registration_events_superseded_event_id_fkey"
            columns: ["superseded_event_id"]
            isOneToOne: false
            referencedRelation: "launch_contract_registration_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_contract_registration_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
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
      launch_production_deployment_requests: {
        Row: {
          assigned_operator_id: string | null
          chain_id: number
          decision_note: string | null
          declared_chain: string
          execution_deployment_id: string | null
          id: string
          launch_id: string
          network_environment: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_decimals: number
          token_name: string
          token_recipient: string
          token_supply_whole: number
          token_symbol: string
          token_total_supply_base_units: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_operator_id?: string | null
          chain_id?: number
          decision_note?: string | null
          declared_chain: string
          execution_deployment_id?: string | null
          id?: string
          launch_id: string
          network_environment?: string
          project_profile_id: string
          requested_at?: string
          requested_by: string
          status?: string
          status_changed_at?: string
          token_decimals?: number
          token_name: string
          token_recipient: string
          token_supply_whole: number
          token_symbol: string
          token_total_supply_base_units: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_operator_id?: string | null
          chain_id?: number
          decision_note?: string | null
          declared_chain?: string
          execution_deployment_id?: string | null
          id?: string
          launch_id?: string
          network_environment?: string
          project_profile_id?: string
          requested_at?: string
          requested_by?: string
          status?: string
          status_changed_at?: string
          token_decimals?: number
          token_name?: string
          token_recipient?: string
          token_supply_whole?: number
          token_symbol?: string
          token_total_supply_base_units?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_production_deployment_reque_execution_deployment_id_fkey"
            columns: ["execution_deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_production_deployment_requests_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_production_deployment_requests_project_profile_id_fkey"
            columns: ["project_profile_id"]
            isOneToOne: false
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_production_deployment_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
          launch_kind: string
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          official_contract_deployment_id: string | null
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
          launch_kind?: string
          launch_watch_token?: string | null
          launch_watch_token_created_at?: string | null
          launch_window_end?: string | null
          launch_window_start?: string | null
          live_at?: string | null
          official_contract_address?: string | null
          official_contract_deployment_id?: string | null
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
          launch_kind?: string
          launch_watch_token?: string | null
          launch_watch_token_created_at?: string | null
          launch_window_end?: string | null
          launch_window_start?: string | null
          live_at?: string | null
          official_contract_address?: string | null
          official_contract_deployment_id?: string | null
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
            foreignKeyName: "launches_official_contract_deployment_id_fkey"
            columns: ["official_contract_deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
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
          attempt_count: number
          claimed_at: string | null
          conversation_id: string
          created_at: string
          delivered_text_snapshot: string | null
          error_class: string | null
          id: string
          last_error: string | null
          message_id: string
          next_attempt_at: string
          project_name_snapshot: string | null
          sent_at: string | null
          status: string
          telegram_message_id: number | null
          telegram_user_id: number
          template_version: string | null
          ticker_snapshot: string | null
          uncertainty_acknowledged_at: string | null
          uncertainty_acknowledged_by: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          conversation_id: string
          created_at?: string
          delivered_text_snapshot?: string | null
          error_class?: string | null
          id?: string
          last_error?: string | null
          message_id: string
          next_attempt_at?: string
          project_name_snapshot?: string | null
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
          telegram_user_id: number
          template_version?: string | null
          ticker_snapshot?: string | null
          uncertainty_acknowledged_at?: string | null
          uncertainty_acknowledged_by?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          conversation_id?: string
          created_at?: string
          delivered_text_snapshot?: string | null
          error_class?: string | null
          id?: string
          last_error?: string | null
          message_id?: string
          next_attempt_at?: string
          project_name_snapshot?: string | null
          sent_at?: string | null
          status?: string
          telegram_message_id?: number | null
          telegram_user_id?: number
          template_version?: string | null
          ticker_snapshot?: string | null
          uncertainty_acknowledged_at?: string | null
          uncertainty_acknowledged_by?: string | null
          updated_at?: string
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
      project_profile_videos: {
        Row: {
          created_at: string
          id: string
          position: number
          project_profile_id: string
          title: string | null
          updated_at: string
          youtube_video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          project_profile_id: string
          title?: string | null
          updated_at?: string
          youtube_video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          project_profile_id?: string
          title?: string | null
          updated_at?: string
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_profile_videos_project_profile_id_fkey"
            columns: ["project_profile_id"]
            isOneToOne: false
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_profiles: {
        Row: {
          about_long: string | null
          created_at: string
          description: string | null
          discovery_status: string
          docs_url: string | null
          github_url: string | null
          highlights: string[] | null
          id: string
          logo_asset_id: string | null
          primary_chain: string | null
          project_name: string
          public_slug: string
          tagline: string | null
          telegram_url: string | null
          ticker: string | null
          updated_at: string
          website_url: string | null
          workspace_id: string
          x_url: string | null
        }
        Insert: {
          about_long?: string | null
          created_at?: string
          description?: string | null
          discovery_status?: string
          docs_url?: string | null
          github_url?: string | null
          highlights?: string[] | null
          id?: string
          logo_asset_id?: string | null
          primary_chain?: string | null
          project_name: string
          public_slug: string
          tagline?: string | null
          telegram_url?: string | null
          ticker?: string | null
          updated_at?: string
          website_url?: string | null
          workspace_id: string
          x_url?: string | null
        }
        Update: {
          about_long?: string | null
          created_at?: string
          description?: string | null
          discovery_status?: string
          docs_url?: string | null
          github_url?: string | null
          highlights?: string[] | null
          id?: string
          logo_asset_id?: string | null
          primary_chain?: string | null
          project_name?: string
          public_slug?: string
          tagline?: string | null
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
      social_metric_snapshots: {
        Row: {
          availability: Json
          comments: number | null
          created_at: string
          id: string
          likes: number | null
          metadata: Json
          mission_id: string
          observed_at: string
          poll_bucket: string
          provider: string
          saves: number | null
          shares: number | null
          views: number | null
          workspace_id: string
        }
        Insert: {
          availability?: Json
          comments?: number | null
          created_at?: string
          id?: string
          likes?: number | null
          metadata?: Json
          mission_id: string
          observed_at?: string
          poll_bucket: string
          provider: string
          saves?: number | null
          shares?: number | null
          views?: number | null
          workspace_id: string
        }
        Update: {
          availability?: Json
          comments?: number | null
          created_at?: string
          id?: string
          likes?: number | null
          metadata?: Json
          mission_id?: string
          observed_at?: string
          poll_bucket?: string
          provider?: string
          saves?: number | null
          shares?: number | null
          views?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_metric_snapshots_mission_workspace_fkey"
            columns: ["mission_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "social_missions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "social_metric_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_mission_link_candidates: {
        Row: {
          author_handle: string
          canonical_url: string
          created_at: string
          expires_at: string
          external_post_id: string
          group_connection_id: string
          id: string
          mission_id: string | null
          prompt_message_id: number | null
          resolved_at: string | null
          resolved_by: string | null
          state: string
          telegram_chat_id: number
          telegram_message_id: number
          telegram_user_id: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_handle: string
          canonical_url: string
          created_at?: string
          expires_at: string
          external_post_id: string
          group_connection_id: string
          id?: string
          mission_id?: string | null
          prompt_message_id?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          state?: string
          telegram_chat_id: number
          telegram_message_id: number
          telegram_user_id?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_handle?: string
          canonical_url?: string
          created_at?: string
          expires_at?: string
          external_post_id?: string
          group_connection_id?: string
          id?: string
          mission_id?: string | null
          prompt_message_id?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          state?: string
          telegram_chat_id?: number
          telegram_message_id?: number
          telegram_user_id?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_mission_link_candidates_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_mission_link_candidates_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "social_missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_mission_link_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_mission_schedule_events: {
        Row: {
          claimed_at: string | null
          client_request_id: string
          created_at: string
          due_at: string
          event_type: string
          finished_at: string | null
          id: string
          last_error: string | null
          mission_id: string
          sequence_no: number
          state: string
          target_id: string
          telegram_message_id: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          claimed_at?: string | null
          client_request_id?: string
          created_at?: string
          due_at: string
          event_type: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          mission_id: string
          sequence_no: number
          state?: string
          target_id: string
          telegram_message_id?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          claimed_at?: string | null
          client_request_id?: string
          created_at?: string
          due_at?: string
          event_type?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          mission_id?: string
          sequence_no?: number
          state?: string
          target_id?: string
          telegram_message_id?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_mission_schedule_events_mission_workspace_fkey"
            columns: ["mission_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "social_missions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "social_mission_schedule_events_target_workspace_fkey"
            columns: ["target_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "social_mission_targets"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "social_mission_schedule_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_mission_settings: {
        Row: {
          auto_pin_mission: boolean
          created_at: string
          default_preset: string
          delete_command_after_send: boolean
          link_finder_enabled: boolean
          live_metrics_enabled: boolean
          milestone_target: number | null
          milestone_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auto_pin_mission?: boolean
          created_at?: string
          default_preset?: string
          delete_command_after_send?: boolean
          link_finder_enabled?: boolean
          live_metrics_enabled?: boolean
          milestone_target?: number | null
          milestone_type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auto_pin_mission?: boolean
          created_at?: string
          default_preset?: string
          delete_command_after_send?: boolean
          link_finder_enabled?: boolean
          live_metrics_enabled?: boolean
          milestone_target?: number | null
          milestone_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_mission_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_mission_targets: {
        Row: {
          command_deleted_at: string | null
          command_message_id: number | null
          created_at: string
          delivery_state: string
          edit_client_request_id: string | null
          edit_last_error: string | null
          edit_revision: number
          edit_state: string
          edit_text_snapshot: string | null
          group_connection_id: string | null
          id: string
          last_edit_at: string | null
          last_error: string | null
          last_metric_signature: string | null
          message_text_snapshot: string | null
          mission_id: string
          pinned_at: string | null
          pinned_by_hq: boolean
          send_client_request_id: string | null
          send_text_intent: string | null
          sent_at: string | null
          telegram_chat_id: number
          telegram_message_id: number | null
          transport_kind: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          command_deleted_at?: string | null
          command_message_id?: number | null
          created_at?: string
          delivery_state?: string
          edit_client_request_id?: string | null
          edit_last_error?: string | null
          edit_revision?: number
          edit_state?: string
          edit_text_snapshot?: string | null
          group_connection_id?: string | null
          id?: string
          last_edit_at?: string | null
          last_error?: string | null
          last_metric_signature?: string | null
          message_text_snapshot?: string | null
          mission_id: string
          pinned_at?: string | null
          pinned_by_hq?: boolean
          send_client_request_id?: string | null
          send_text_intent?: string | null
          sent_at?: string | null
          telegram_chat_id: number
          telegram_message_id?: number | null
          transport_kind?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          command_deleted_at?: string | null
          command_message_id?: number | null
          created_at?: string
          delivery_state?: string
          edit_client_request_id?: string | null
          edit_last_error?: string | null
          edit_revision?: number
          edit_state?: string
          edit_text_snapshot?: string | null
          group_connection_id?: string | null
          id?: string
          last_edit_at?: string | null
          last_error?: string | null
          last_metric_signature?: string | null
          message_text_snapshot?: string | null
          mission_id?: string
          pinned_at?: string | null
          pinned_by_hq?: boolean
          send_client_request_id?: string | null
          send_text_intent?: string | null
          sent_at?: string | null
          telegram_chat_id?: number
          telegram_message_id?: number | null
          transport_kind?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_mission_targets_group_workspace_chat_fkey"
            columns: ["group_connection_id", "workspace_id", "telegram_chat_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id", "workspace_id", "telegram_chat_id"]
          },
          {
            foreignKeyName: "social_mission_targets_mission_workspace_fkey"
            columns: ["mission_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "social_missions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "social_mission_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_missions: {
        Row: {
          accomplished_at: string | null
          baseline_comments: number | null
          baseline_likes: number | null
          baseline_observed_at: string | null
          baseline_saves: number | null
          baseline_shares: number | null
          baseline_views: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          metadata: Json
          social_post_id: string
          started_at: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accomplished_at?: string | null
          baseline_comments?: number | null
          baseline_likes?: number | null
          baseline_observed_at?: string | null
          baseline_saves?: number | null
          baseline_shares?: number | null
          baseline_views?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json
          social_post_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accomplished_at?: string | null
          baseline_comments?: number | null
          baseline_likes?: number | null
          baseline_observed_at?: string | null
          baseline_saves?: number | null
          baseline_shares?: number | null
          baseline_views?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          metadata?: Json
          social_post_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_missions_post_workspace_fkey"
            columns: ["social_post_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "social_missions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          author_display_name: string | null
          author_handle: string | null
          canonical_url: string
          content_text: string | null
          created_at: string
          external_post_id: string
          id: string
          media_type: string | null
          metadata: Json
          platform: string
          published_at: string | null
          social_source_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_display_name?: string | null
          author_handle?: string | null
          canonical_url: string
          content_text?: string | null
          created_at?: string
          external_post_id: string
          id?: string
          media_type?: string | null
          metadata?: Json
          platform: string
          published_at?: string | null
          social_source_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_display_name?: string | null
          author_handle?: string | null
          canonical_url?: string
          content_text?: string | null
          created_at?: string
          external_post_id?: string
          id?: string
          media_type?: string | null
          metadata?: Json
          platform?: string
          published_at?: string | null
          social_source_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_source_workspace_fkey"
            columns: ["social_source_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "social_sources"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "social_posts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_sources: {
        Row: {
          auto_detect_enabled: boolean
          canonical_url: string
          created_at: string
          external_account_id: string | null
          handle: string | null
          id: string
          last_checked_at: string | null
          last_external_post_id: string | null
          metadata: Json
          platform: string
          polling_interval_seconds: number
          provider_cursor: string | null
          provider_preference: string | null
          source_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auto_detect_enabled?: boolean
          canonical_url: string
          created_at?: string
          external_account_id?: string | null
          handle?: string | null
          id?: string
          last_checked_at?: string | null
          last_external_post_id?: string | null
          metadata?: Json
          platform: string
          polling_interval_seconds?: number
          provider_cursor?: string | null
          provider_preference?: string | null
          source_type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auto_detect_enabled?: boolean
          canonical_url?: string
          created_at?: string
          external_account_id?: string | null
          handle?: string | null
          id?: string
          last_checked_at?: string | null
          last_external_post_id?: string | null
          metadata?: Json
          platform?: string
          polling_interval_seconds?: number
          provider_cursor?: string | null
          provider_preference?: string | null
          source_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
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
          announcement_kind: string
          branding_logo_asset_id: string | null
          branding_logo_mime_type: string | null
          branding_logo_storage_path: string | null
          branding_project_name: string | null
          branding_template_version: string | null
          branding_ticker: string | null
          client_request_id: string
          contract_registration_event_id: string | null
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
          launch_id: string | null
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
          announcement_kind?: string
          branding_logo_asset_id?: string | null
          branding_logo_mime_type?: string | null
          branding_logo_storage_path?: string | null
          branding_project_name?: string | null
          branding_template_version?: string | null
          branding_ticker?: string | null
          client_request_id: string
          contract_registration_event_id?: string | null
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
          launch_id?: string | null
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
          announcement_kind?: string
          branding_logo_asset_id?: string | null
          branding_logo_mime_type?: string | null
          branding_logo_storage_path?: string | null
          branding_project_name?: string | null
          branding_template_version?: string | null
          branding_ticker?: string | null
          client_request_id?: string
          contract_registration_event_id?: string | null
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
          launch_id?: string | null
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
            foreignKeyName: "telegram_group_announcements_contract_registration_event_i_fkey"
            columns: ["contract_registration_event_id"]
            isOneToOne: false
            referencedRelation: "launch_contract_registration_events"
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
            foreignKeyName: "telegram_group_announcements_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
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
      abandon_launch_chain_deployment_attempt: {
        Args: { _deployment_id: string; _reason?: string }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acknowledge_project_inbox_delivery_uncertainty: {
        Args: {
          _conversation_id: string
          _message_id: string
          _workspace_id: string
        }
        Returns: {
          delivery_status: string
          message_id: string
          uncertainty_acknowledged_at: string
        }[]
      }
      activate_social_mission_schedule: {
        Args: { _mission_id: string; _target_id: string }
        Returns: Json
      }
      apply_launch_chain_deployment_verification: {
        Args: {
          _block_hash?: string
          _block_number?: number
          _confirmations?: number
          _contract_address?: string
          _deployment_id: string
          _failure_code?: string
          _failure_detail?: string
          _status: string
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_launch_chain_production_finality: {
        Args: {
          _deployment_id: string
          _finality_notice?: string
          _finality_provider_kind?: string
          _finality_state: string
          _finalized_block_hash_confirmed?: boolean
          _finalized_block_number?: number
          _finalized_head_block_number?: number
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_launch_chain_production_token_deployment_verification: {
        Args: {
          _block_hash?: string
          _block_number?: number
          _contract_address?: string
          _deployment_id: string
          _failure_code?: string
          _failure_detail?: string
          _observed_confirmations?: number
          _status: string
          _verified_recipient_balance?: number
          _verified_token_decimals?: number
          _verified_token_name?: string
          _verified_token_symbol?: string
          _verified_total_supply?: number
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_launch_chain_token_deployment_verification: {
        Args: {
          _block_hash?: string
          _block_number?: number
          _confirmations?: number
          _contract_address?: string
          _deployment_id: string
          _failure_code?: string
          _failure_detail?: string
          _status: string
          _verified_recipient_balance?: number
          _verified_token_decimals?: number
          _verified_token_name?: string
          _verified_token_symbol?: string
          _verified_total_supply?: number
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_sticker_pack: { Args: { _pack_id: string }; Returns: Json }
      arm_launch_chain_production_canary_execution: {
        Args: {
          _authorization_id: string
          _deployment_id: string
          _expected_control_revision: number
          _operator_user_id: string
          _reason: string
        }
        Returns: Json
      }
      assert_launch_contract_evidence: {
        Args: {
          _declared_chain: string
          _deployment_id: string
          _launch_id: string
          _workspace_id: string
        }
        Returns: string
      }
      attach_social_mission_link_prompt: {
        Args: { _candidate_id: string; _prompt_message_id: number }
        Returns: boolean
      }
      authorize_launch_chain_deployment: {
        Args: { _launch_id: string }
        Returns: string
      }
      authorize_launch_chain_production_send_window_issuance: {
        Args: {
          _authorization_id: string
          _deployment_id: string
          _operator_user_id: string
        }
        Returns: {
          authorization_expires_at: string
          authorization_id: string
          canary_permit_id: string
          chain_id: number
          claimed_at: string
          control_revision: number
          deployment_id: string
          id: string
          init_code_hash: string
          issued_at: string
          launch_id: string
          network_environment: string
          operator_user_id: string
          review_fingerprint: string
          send_window_expires_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_production_send_window_issuances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_launch_production_request_execution: {
        Args: {
          _deployer_address: string
          _init_code_hash: string
          _request_id: string
          _review_fingerprint: string
        }
        Returns: {
          assigned_operator_id: string | null
          chain_id: number
          decision_note: string | null
          declared_chain: string
          execution_deployment_id: string | null
          id: string
          launch_id: string
          network_environment: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_decimals: number
          token_name: string
          token_recipient: string
          token_supply_whole: number
          token_symbol: string
          token_total_supply_base_units: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_production_deployment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bot_inbox_active_reply_session: {
        Args: { _telegram_user_id: number }
        Returns: {
          conversation_id: string
          member_ref: string
          workspace_id: string
        }[]
      }
      bot_inbox_capture_alert_targets: {
        Args: { _telegram_update_id: number }
        Returns: {
          body: string
          conversation_id: string
          is_new_conversation: boolean
          member_ref: string
          operator_telegram_user_id: number
        }[]
      }
      bot_inbox_create_team_reply: {
        Args: {
          _body: string
          _client_request_id: string
          _telegram_user_id: number
        }
        Returns: {
          message_id: string
          outcome: string
          reason: string
        }[]
      }
      bot_inbox_list_conversations: {
        Args: {
          _limit?: number
          _telegram_user_id: number
          _workspace_id: string
        }
        Returns: {
          conversation_id: string
          conversation_status: string
          last_message_at: string
          member_ref: string
          preview: string
        }[]
      }
      bot_inbox_open_conversation: {
        Args: { _conversation_id: string; _telegram_user_id: number }
        Returns: {
          conversation_status: string
          member_ref: string
          outcome: string
          transcript: Json
          workspace_name: string
        }[]
      }
      bot_inbox_operator_workspaces: {
        Args: { _telegram_user_id: number }
        Returns: {
          waiting_count: number
          workspace_id: string
          workspace_name: string
        }[]
      }
      bot_inbox_set_session: {
        Args: {
          _mode: string
          _telegram_user_id: number
          _workspace_id?: string
        }
        Returns: string
      }
      can_access_pack: {
        Args: { _pack_id: string; _user_id: string }
        Returns: boolean
      }
      can_create_private_beta_workspace: { Args: never; Returns: boolean }
      can_read_launch_chain_deployment: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      cancel_claimed_launch_chain_production_presign_authorization: {
        Args: {
          _authorization_id: string
          _operator_user_id: string
          _reason: string
        }
        Returns: {
          chain_id: number
          claimed_at: string | null
          client_request_id: string
          consumed_at: string | null
          consumed_tx_hash: string | null
          created_at: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id: string
          init_code_hash: string
          invalidated_at: string | null
          invalidated_reason: string | null
          issued_at: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status: string
          ttl_seconds: number
          tx_value_wei: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_production_presign_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
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
      capture_project_inbox_member_message: {
        Args: {
          _body: string
          _telegram_chat_id: number
          _telegram_message_id: number
          _telegram_update_id: number
          _telegram_user_id: number
        }
        Returns: string
      }
      claim_due_social_mission_schedule_events: {
        Args: { _limit?: number }
        Returns: {
          canonical_url: string
          client_request_id: string
          edit_revision: number
          event_id: string
          event_type: string
          group_connection_id: string
          mission_created_by: string
          mission_id: string
          sequence_no: number
          target_id: string
          telegram_chat_id: number
          telegram_message_id: number
          workspace_id: string
        }[]
      }
      claim_launch_chain_production_presign_authorization: {
        Args: {
          _authorization_id: string
          _expected_init_code_hash: string
          _expected_review_fingerprint: string
        }
        Returns: {
          chain_id: number
          claimed_at: string | null
          client_request_id: string
          consumed_at: string | null
          consumed_tx_hash: string | null
          created_at: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id: string
          init_code_hash: string
          invalidated_at: string | null
          invalidated_reason: string | null
          issued_at: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status: string
          ttl_seconds: number
          tx_value_wei: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_production_presign_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
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
          conversation_id: string
          delivered_text_snapshot: string
          delivery_id: string
          message_id: string
          team_user_id: string
          telegram_user_id: number
          workspace_id: string
        }[]
      }
      claim_social_mission_card_refresh: {
        Args: { _signature: string; _target_id: string }
        Returns: boolean
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
      close_social_mission_from_telegram: {
        Args: { _telegram_chat_id: number; _telegram_user_id: number }
        Returns: Json
      }
      correct_verified_launch_contract: {
        Args: {
          _deployment_id: string
          _expected_contract_address: string
          _launch_id: string
          _reason: string
        }
        Returns: Json
      }
      create_launch_chain_deployment_attempt: {
        Args: {
          _client_request_id: string
          _deployer_address: string
          _launch_id: string
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_launch_chain_production_token_deployment_attempt: {
        Args: {
          _client_request_id: string
          _deployer_address: string
          _init_code_hash: string
          _launch_id: string
          _review_fingerprint: string
          _token_name: string
          _token_recipient: string
          _token_symbol: string
          _token_total_supply: number
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_launch_chain_token_deployment_attempt: {
        Args: {
          _client_request_id: string
          _deployer_address: string
          _launch_id: string
          _token_name: string
          _token_recipient: string
          _token_symbol: string
          _token_total_supply: number
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
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
          conversation_status: string
          created_at: string
          delivery_status: string
          idempotent_replay: boolean
          message_id: string
        }[]
      }
      create_social_mission_from_telegram_link: {
        Args: {
          _author_handle: string
          _canonical_url: string
          _external_post_id: string
          _source?: string
          _telegram_chat_id: number
          _telegram_message_id: number
          _telegram_update_id: number
          _telegram_user_id: number
        }
        Returns: Json
      }
      create_social_mission_link_candidate: {
        Args: {
          _author_handle: string
          _canonical_url: string
          _external_post_id: string
          _telegram_chat_id: number
          _telegram_message_id: number
          _telegram_user_id: number
          _ttl_minutes?: number
        }
        Returns: Json
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
      engage_launch_chain_production_emergency_stop: {
        Args: { _operator_user_id: string; _reason: string }
        Returns: {
          control_key: string
          emergency_stop_engaged: boolean
          execution_enabled: boolean
          reason: string
          revision: number
          updated_at: string
          updated_by: string
        }[]
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
          _next_attempt_at?: string
          _outcome: string
          _telegram_message_id?: number
        }
        Returns: {
          delivery_id: string
          next_attempt_at: string
          sent_at: string
          status: string
        }[]
      }
      finalize_social_mission_link_candidate_start: {
        Args: {
          _candidate_id: string
          _mission_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
      }
      finish_social_mission_schedule_event: {
        Args: {
          _event_id: string
          _last_error?: string
          _state: string
          _telegram_message_id?: number
        }
        Returns: boolean
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
          about_long: string
          description: string
          docs_url: string
          github_url: string
          has_logo: boolean
          highlights: string[]
          primary_chain: string
          project_name: string
          public_slug: string
          tagline: string
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
      get_cartel_network_project_videos: {
        Args: { _project_slug: string }
        Returns: {
          position: number
          title: string
          youtube_video_id: string
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
      get_launch_chain_production_execution_state: {
        Args: never
        Returns: {
          control_key: string
          emergency_stop_engaged: boolean
          execution_enabled: boolean
          reason: string
          revision: number
          updated_at: string
          updated_by: string
        }[]
      }
      get_launch_chain_production_presign_authorization: {
        Args: { _deployment_id: string }
        Returns: {
          chain_id: number
          claimed_at: string | null
          client_request_id: string
          consumed_at: string | null
          consumed_tx_hash: string | null
          created_at: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id: string
          init_code_hash: string
          invalidated_at: string | null
          invalidated_reason: string | null
          issued_at: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status: string
          ttl_seconds: number
          tx_value_wei: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_production_presign_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_launch_chain_production_reconciliation_snapshot: {
        Args: { _deployment_id: string; _operator_user_id: string }
        Returns: Json
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
      get_launch_production_deployment_request: {
        Args: { _launch_id: string }
        Returns: {
          assigned_operator_id: string
          chain_id: number
          decision_note: string
          declared_chain: string
          effective_status: string
          execution_deployment_id: string
          id: string
          launch_id: string
          network_environment: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_decimals: number
          token_name: string
          token_recipient: string
          token_supply_whole: string
          token_symbol: string
          token_total_supply_base_units: string
          updated_at: string
          workspace_id: string
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
      invalidate_launch_chain_production_presign_authorization: {
        Args: { _authorization_id: string; _reason: string }
        Returns: {
          chain_id: number
          claimed_at: string | null
          client_request_id: string
          consumed_at: string | null
          consumed_tx_hash: string | null
          created_at: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id: string
          init_code_hash: string
          invalidated_at: string | null
          invalidated_reason: string | null
          issued_at: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status: string
          ttl_seconds: number
          tx_value_wei: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_production_presign_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invoke_launch_notification_scheduler: { Args: never; Returns: number }
      invoke_project_inbox_delivery_scheduler: { Args: never; Returns: number }
      invoke_social_mission_runner: { Args: never; Returns: undefined }
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
      issue_launch_chain_production_presign_authorization: {
        Args: {
          _client_request_id: string
          _deployment_id: string
          _estimated_cost_wei_text: string
          _fee_model: string
          _gas_estimate_text: string
          _gas_limit_text: string
          _max_fee_per_gas_wei_text: string
          _max_priority_fee_per_gas_wei_text: string
          _max_total_cost_wei_text: string
          _observed_fee_per_gas_wei_text: string
          _operator_user_id: string
          _ttl_seconds?: number
        }
        Returns: {
          chain_id: number
          claimed_at: string | null
          client_request_id: string
          consumed_at: string | null
          consumed_tx_hash: string | null
          created_at: string
          deployer_address: string
          deployment_id: string
          estimated_cost_wei_text: string
          expires_at: string
          fee_model: string
          gas_estimate_text: string
          gas_limit_text: string
          id: string
          init_code_hash: string
          invalidated_at: string | null
          invalidated_reason: string | null
          issued_at: string
          launch_id: string
          max_fee_per_gas_wei_text: string
          max_priority_fee_per_gas_wei_text: string | null
          max_total_cost_wei_text: string
          network_environment: string
          observed_fee_per_gas_wei_text: string
          operator_user_id: string
          review_fingerprint: string
          status: string
          ttl_seconds: number
          tx_value_wei: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_production_presign_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      launch_chain_label_is_robinhood_mainnet: {
        Args: { _chain: string }
        Returns: boolean
      }
      launch_contract_correction_payload: {
        Args: { _launch_id: string; _registration_event_id: string }
        Returns: Json
      }
      launch_notification_payload: {
        Args: { _launch_id: string }
        Returns: Json
      }
      launch_notification_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      launch_production_request_is_completed: {
        Args: { _request_id: string }
        Returns: boolean
      }
      list_active_social_missions_for_metrics: {
        Args: { _limit?: number }
        Returns: {
          accomplished_at: string
          canonical_url: string
          edit_revision: number
          edit_state: string
          effective_config: Json
          external_post_id: string
          last_metric_signature: string
          mission_created_by: string
          mission_id: string
          target_id: string
          telegram_chat_id: number
          telegram_message_id: number
          workspace_id: string
        }[]
      }
      list_launch_chain_deployments: {
        Args: { _launch_id: string }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_launch_production_deployment_requests: {
        Args: never
        Returns: {
          assigned_operator_id: string
          decision_note: string
          effective_status: string
          execution_deployment_id: string
          id: string
          launch_id: string
          launch_kind: string
          launch_name: string
          launch_status: string
          launch_ticker: string
          project_name: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_name: string
          token_recipient: string
          token_supply_whole: string
          token_symbol: string
          token_total_supply_base_units: string
          workspace_id: string
          workspace_name: string
        }[]
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
          delivery_sent_at: string
          delivery_status: string
          delivery_uncertainty_acknowledged_at: string
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
      notify_launch_watchers_official_contract: {
        Args: { _launch_id: string }
        Returns: Json
      }
      notify_launch_watchers_official_contract_correction: {
        Args: { _launch_id: string; _registration_event_id: string }
        Returns: Json
      }
      peek_social_mission_link_candidate: {
        Args: { _candidate_id: string; _telegram_user_id: number }
        Returns: Json
      }
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
      record_social_mission_command_deleted: {
        Args: { _command_message_id: number; _target_id: string }
        Returns: boolean
      }
      record_social_mission_metric_snapshot: {
        Args: {
          _availability?: Json
          _comments?: number
          _likes?: number
          _metadata?: Json
          _mission_id: string
          _observed_at: string
          _poll_bucket: string
          _provider: string
          _saves?: number
          _shares?: number
          _views?: number
        }
        Returns: Json
      }
      record_social_mission_target_pin: {
        Args: { _pinned: boolean; _target_id: string }
        Returns: boolean
      }
      register_verified_launch_contract: {
        Args: {
          _deployment_id: string
          _expected_contract_address: string
          _launch_id: string
        }
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
          launch_kind: string
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          official_contract_deployment_id: string | null
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
      request_project_verification: {
        Args: { _project_profile_id: string }
        Returns: {
          requested_at: string
          verification_status: string
        }[]
      }
      resolve_social_mission_link_candidate: {
        Args: {
          _candidate_id: string
          _decision: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
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
          launch_kind: string
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          official_contract_deployment_id: string | null
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
      set_launch_production_deployment_request_status: {
        Args: { _note?: string; _request_id: string; _target_status: string }
        Returns: {
          assigned_operator_id: string | null
          chain_id: number
          decision_note: string | null
          declared_chain: string
          execution_deployment_id: string | null
          id: string
          launch_id: string
          network_environment: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_decimals: number
          token_name: string
          token_recipient: string
          token_supply_whole: number
          token_symbol: string
          token_total_supply_base_units: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_production_deployment_requests"
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
      set_project_inbox_new_conversations_enabled: {
        Args: { _enabled: boolean; _workspace_id: string }
        Returns: {
          new_conversations_enabled: boolean
          replies_enabled: boolean
          security_warning_version: string
          updated_at: string
          workspace_id: string
        }[]
      }
      set_project_inbox_replies_enabled: {
        Args: { _enabled: boolean; _workspace_id: string }
        Returns: {
          new_conversations_enabled: boolean
          replies_enabled: boolean
          security_warning_version: string
          updated_at: string
          workspace_id: string
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
      social_mission_effective_config: {
        Args: { _mission_id: string }
        Returns: Json
      }
      social_mission_preset_config: { Args: { _preset: string }; Returns: Json }
      social_mission_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      sticker_drop_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      sticker_pack_lifecycle_state: {
        Args: { _pack_id: string }
        Returns: Json
      }
      submit_launch_chain_deployment_tx: {
        Args: { _deployment_id: string; _tx_hash: string }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_launch_chain_production_deployment_tx: {
        Args: {
          _authorization_id: string
          _deployment_id: string
          _operator_user_id: string
          _tx_hash: string
        }
        Returns: {
          artifact_id: string | null
          attempt_number: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          client_request_id: string
          confirmations: number
          contract_address: string | null
          created_at: string
          created_by: string | null
          deployer_address: string
          deployment_kind: string
          failure_code: string | null
          failure_detail: string | null
          finality_last_checked_at: string | null
          finality_notice: string | null
          finality_provider_kind: string | null
          finality_state: string
          finalized_at: string | null
          finalized_block_hash_confirmed: boolean | null
          finalized_block_number: number | null
          finalized_head_block_number: number | null
          id: string
          init_code_hash: string | null
          last_checked_at: string | null
          launch_id: string
          network_environment: string
          review_fingerprint: string | null
          status: string
          submitted_at: string | null
          token_decimals: number | null
          token_name: string | null
          token_recipient: string | null
          token_symbol: string | null
          token_total_supply: number | null
          token_total_supply_text: string | null
          tx_hash: string | null
          updated_at: string
          verified_at: string | null
          verified_recipient_balance: number | null
          verified_recipient_balance_text: string | null
          verified_token_decimals: number | null
          verified_token_name: string | null
          verified_token_symbol: string | null
          verified_total_supply: number | null
          verified_total_supply_text: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_chain_deployments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_launch_production_deployment_request: {
        Args: {
          _launch_id: string
          _token_recipient: string
          _token_supply_whole: string
        }
        Returns: {
          assigned_operator_id: string | null
          chain_id: number
          decision_note: string | null
          declared_chain: string
          execution_deployment_id: string | null
          id: string
          launch_id: string
          network_environment: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_decimals: number
          token_name: string
          token_recipient: string
          token_supply_whole: number
          token_symbol: string
          token_total_supply_base_units: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_production_deployment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
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
          launch_kind: string
          launch_watch_token: string | null
          launch_watch_token_created_at: string | null
          launch_window_end: string | null
          launch_window_start: string | null
          live_at: string | null
          official_contract_address: string | null
          official_contract_deployment_id: string | null
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
      withdraw_launch_production_deployment_request: {
        Args: { _request_id: string }
        Returns: {
          assigned_operator_id: string | null
          chain_id: number
          decision_note: string | null
          declared_chain: string
          execution_deployment_id: string | null
          id: string
          launch_id: string
          network_environment: string
          project_profile_id: string
          requested_at: string
          requested_by: string
          status: string
          status_changed_at: string
          token_decimals: number
          token_name: string
          token_recipient: string
          token_supply_whole: number
          token_symbol: string
          token_total_supply_base_units: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_production_deployment_requests"
          isOneToOne: true
          isSetofReturn: false
        }
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
