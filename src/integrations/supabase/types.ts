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
      commercial_billing_customers: {
        Row: {
          billing_owner_user_id: string
          created_at: string
          customer_ref: string
          environment: string
          id: string
          provider: string
          updated_at: string
        }
        Insert: {
          billing_owner_user_id: string
          created_at?: string
          customer_ref: string
          environment: string
          id?: string
          provider?: string
          updated_at?: string
        }
        Update: {
          billing_owner_user_id?: string
          created_at?: string
          customer_ref?: string
          environment?: string
          id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      commercial_billing_events: {
        Row: {
          attempt_count: number
          created_at: string
          environment: string
          event_ref: string
          event_type: string
          id: string
          last_error: string | null
          livemode: boolean
          object_ref: string | null
          processed_at: string | null
          processing_status: string
          provider: string
          subscription_ref: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          environment: string
          event_ref: string
          event_type: string
          id?: string
          last_error?: string | null
          livemode: boolean
          object_ref?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          subscription_ref?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          environment?: string
          event_ref?: string
          event_type?: string
          id?: string
          last_error?: string | null
          livemode?: boolean
          object_ref?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          subscription_ref?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_billing_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_billing_subscriptions: {
        Row: {
          billing_owner_user_id: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          customer_ref: string
          environment: string
          id: string
          last_payment_failed_at: string | null
          plan_id: string
          price_ref: string
          provider: string
          stripe_status: string
          subscription_ref: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billing_owner_user_id?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_ref: string
          environment: string
          id?: string
          last_payment_failed_at?: string | null
          plan_id: string
          price_ref: string
          provider?: string
          stripe_status: string
          subscription_ref: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billing_owner_user_id?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_ref?: string
          environment?: string
          id?: string
          last_payment_failed_at?: string | null
          plan_id?: string
          price_ref?: string
          provider?: string
          stripe_status?: string
          subscription_ref?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_billing_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_billing_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_plan_entitlements: {
        Row: {
          created_at: string
          customer_visible: boolean
          enabled: boolean
          feature_key: string
          kind: string
          limit_value: number | null
          metadata: Json
          period: string
          plan_id: string
        }
        Insert: {
          created_at?: string
          customer_visible?: boolean
          enabled?: boolean
          feature_key: string
          kind: string
          limit_value?: number | null
          metadata?: Json
          period: string
          plan_id: string
        }
        Update: {
          created_at?: string
          customer_visible?: boolean
          enabled?: boolean
          feature_key?: string
          kind?: string
          limit_value?: number | null
          metadata?: Json
          period?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_plan_provider_refs: {
        Row: {
          active: boolean
          created_at: string
          environment: string
          id: string
          plan_id: string
          portal_configuration_ref: string | null
          price_ref: string
          product_ref: string
          provider: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          environment: string
          id?: string
          plan_id: string
          portal_configuration_ref?: string | null
          price_ref: string
          product_ref: string
          provider?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          environment?: string
          id?: string
          plan_id?: string
          portal_configuration_ref?: string | null
          price_ref?: string
          product_ref?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_plan_provider_refs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_plans: {
        Row: {
          billing_interval: string
          code: string
          created_at: string
          currency: string
          id: string
          name: string
          price_cents: number
          status: string
          version: number
        }
        Insert: {
          billing_interval: string
          code: string
          created_at?: string
          currency: string
          id?: string
          name: string
          price_cents: number
          status: string
          version: number
        }
        Update: {
          billing_interval?: string
          code?: string
          created_at?: string
          currency?: string
          id?: string
          name?: string
          price_cents?: number
          status?: string
          version?: number
        }
        Relationships: []
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before?: number | null
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
          deployer_nonce_before?: number | null
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
          artifact_id: string
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
          artifact_id?: string
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
          artifact_id?: string
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
      launch_treasury_signer_configs: {
        Row: {
          created_at: string
          created_by: string
          id: string
          launch_id: string
          safe_address: string | null
          safe_creation_tx_hash: string | null
          safe_salt_nonce: string | null
          safe_verified_at: string | null
          safe_verified_block: number | null
          signer_1: string
          signer_2: string
          signer_3: string
          threshold: number
          updated_at: string
          updated_by: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          launch_id: string
          safe_address?: string | null
          safe_creation_tx_hash?: string | null
          safe_salt_nonce?: string | null
          safe_verified_at?: string | null
          safe_verified_block?: number | null
          signer_1: string
          signer_2: string
          signer_3: string
          threshold?: number
          updated_at?: string
          updated_by: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          launch_id?: string
          safe_address?: string | null
          safe_creation_tx_hash?: string | null
          safe_salt_nonce?: string | null
          safe_verified_at?: string | null
          safe_verified_block?: number | null
          signer_1?: string
          signer_2?: string
          signer_3?: string
          threshold?: number
          updated_at?: string
          updated_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_treasury_signer_configs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: true
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_treasury_signer_configs_workspace_id_fkey"
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
      mission_control_launcher_bindings: {
        Row: {
          cleanup_job_id: string | null
          close_token_hash: string
          created_at: string
          expires_at: string
          group_connection_id: string
          id: string
          status: string
          telegram_chat_id: number
          telegram_message_id: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cleanup_job_id?: string | null
          close_token_hash: string
          created_at?: string
          expires_at?: string
          group_connection_id: string
          id?: string
          status?: string
          telegram_chat_id: number
          telegram_message_id?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cleanup_job_id?: string | null
          close_token_hash?: string
          created_at?: string
          expires_at?: string
          group_connection_id?: string
          id?: string
          status?: string
          telegram_chat_id?: number
          telegram_message_id?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_control_launcher_bindings_cleanup_job_id_fkey"
            columns: ["cleanup_job_id"]
            isOneToOne: false
            referencedRelation: "telegram_message_cleanup_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_control_launcher_bindings_group_connection_id_fkey"
            columns: ["group_connection_id"]
            isOneToOne: false
            referencedRelation: "telegram_group_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_control_launcher_bindings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_agreement_acceptances: {
        Row: {
          accepted_at: string
          id: string
          partner_id: string
          terms_version: number
        }
        Insert: {
          accepted_at?: string
          id?: string
          partner_id: string
          terms_version: number
        }
        Update: {
          accepted_at?: string
          id?: string
          partner_id?: string
          terms_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "partner_agreement_acceptances_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_agreement_acceptances_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "partner_program_terms"
            referencedColumns: ["version"]
          },
        ]
      }
      partner_applications: {
        Row: {
          created_at: string
          id: string
          pitch: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          terms_version: number
          updated_at: string
          user_id: string
          wants_affiliate: boolean
          wants_service_partner: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          pitch: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          terms_version: number
          updated_at?: string
          user_id: string
          wants_affiliate?: boolean
          wants_service_partner?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          pitch?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          terms_version?: number
          updated_at?: string
          user_id?: string
          wants_affiliate?: boolean
          wants_service_partner?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "partner_applications_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "partner_program_terms"
            referencedColumns: ["version"]
          },
        ]
      }
      partner_client_access: {
        Row: {
          created_at: string
          id: string
          invited_at: string
          invited_by: string
          partner_id: string
          partner_user_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          scopes: string[]
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string
          invited_by: string
          partner_id: string
          partner_user_id: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string
          partner_id?: string
          partner_user_id?: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_client_access_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_client_access_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_commission_ledger: {
        Row: {
          amount_cents: number
          available_at: string
          created_at: string
          created_by: string | null
          currency: string
          entry_type: string
          id: string
          note: string | null
          partner_id: string
          payout_request_id: string | null
          referral_id: string | null
          source_event_ref: string | null
          source_kind: string
          terms_version: number | null
          workspace_id: string | null
        }
        Insert: {
          amount_cents: number
          available_at?: string
          created_at?: string
          created_by?: string | null
          currency: string
          entry_type: string
          id?: string
          note?: string | null
          partner_id: string
          payout_request_id?: string | null
          referral_id?: string | null
          source_event_ref?: string | null
          source_kind: string
          terms_version?: number | null
          workspace_id?: string | null
        }
        Update: {
          amount_cents?: number
          available_at?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_type?: string
          id?: string
          note?: string | null
          partner_id?: string
          payout_request_id?: string | null
          referral_id?: string | null
          source_event_ref?: string | null
          source_kind?: string
          terms_version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_commission_ledger_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_commission_ledger_payout_request_id_fkey"
            columns: ["payout_request_id"]
            isOneToOne: false
            referencedRelation: "partner_payout_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_commission_ledger_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "partner_referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_commission_ledger_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "partner_program_terms"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "partner_commission_ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_payout_requests: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          paid_reference: string | null
          partner_id: string
          requested_at: string
          review_note: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: string
          terms_version: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          id?: string
          paid_at?: string | null
          paid_reference?: string | null
          partner_id: string
          requested_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string
          terms_version: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          paid_reference?: string | null
          partner_id?: string
          requested_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string
          terms_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_payout_requests_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_payout_requests_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "partner_program_terms"
            referencedColumns: ["version"]
          },
        ]
      }
      partner_program_terms: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          affiliate_applications_open: boolean
          agreement_text: string | null
          attribution_window_days: number | null
          commission_bps: number | null
          commission_duration_invoices: number | null
          created_at: string
          created_by: string | null
          currency: string | null
          disclosure_text: string | null
          hold_days: number | null
          id: string
          min_payout_cents: number | null
          retired_at: string | null
          service_partner_applications_open: boolean
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          affiliate_applications_open?: boolean
          agreement_text?: string | null
          attribution_window_days?: number | null
          commission_bps?: number | null
          commission_duration_invoices?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          disclosure_text?: string | null
          hold_days?: number | null
          id?: string
          min_payout_cents?: number | null
          retired_at?: string | null
          service_partner_applications_open?: boolean
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          affiliate_applications_open?: boolean
          agreement_text?: string | null
          attribution_window_days?: number | null
          commission_bps?: number | null
          commission_duration_invoices?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          disclosure_text?: string | null
          hold_days?: number | null
          id?: string
          min_payout_cents?: number | null
          retired_at?: string | null
          service_partner_applications_open?: boolean
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      partner_referrals: {
        Row: {
          attributed_at: string
          bound_at: string | null
          created_at: string
          id: string
          partner_id: string
          reason: string | null
          referred_user_id: string
          source: string
          status: string
          terms_version: number
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          attributed_at?: string
          bound_at?: string | null
          created_at?: string
          id?: string
          partner_id: string
          reason?: string | null
          referred_user_id: string
          source: string
          status?: string
          terms_version: number
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          attributed_at?: string
          bound_at?: string | null
          created_at?: string
          id?: string
          partner_id?: string
          reason?: string | null
          referred_user_id?: string
          source?: string
          status?: string
          terms_version?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_referrals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_referrals_terms_version_fkey"
            columns: ["terms_version"]
            isOneToOne: false
            referencedRelation: "partner_program_terms"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "partner_referrals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          is_affiliate: boolean
          is_service_partner: boolean
          referral_code: string | null
          status: string
          tax_doc_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          is_affiliate?: boolean
          is_service_partner?: boolean
          referral_code?: string | null
          status?: string
          tax_doc_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          is_affiliate?: boolean
          is_service_partner?: boolean
          referral_code?: string | null
          status?: string
          tax_doc_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pcart_auction_execution_rehearsal_reviews: {
        Row: {
          created_at: string
          duration_blocks: number
          expires_at: string
          floor_price_q96: number
          fork_block: number
          id: string
          launch_id: string
          live_attestation: Json
          lp_custody_mode: string
          manifest_fingerprint: string
          manifest_version: string
          migration_mode: string
          overall_result: string
          p8a_review_id: string
          refund_fingerprint: string
          refund_mode: string
          release_schedule_fingerprint: string
          reviewed_at: string
          reviewed_by: string
          safe_tx_count_post: number
          safe_tx_count_pre: number
          settlement_mode: string
          signatures_per_safe_tx: number
          source_attestation_fingerprint: string
          success_fingerprint: string
          tick_spacing_q96: number
          transaction_sequence: Json
          unsold_mode: string
        }
        Insert: {
          created_at?: string
          duration_blocks: number
          expires_at: string
          floor_price_q96: number
          fork_block: number
          id?: string
          launch_id: string
          live_attestation: Json
          lp_custody_mode: string
          manifest_fingerprint: string
          manifest_version: string
          migration_mode: string
          overall_result: string
          p8a_review_id: string
          refund_fingerprint: string
          refund_mode: string
          release_schedule_fingerprint: string
          reviewed_at?: string
          reviewed_by: string
          safe_tx_count_post: number
          safe_tx_count_pre: number
          settlement_mode: string
          signatures_per_safe_tx: number
          source_attestation_fingerprint: string
          success_fingerprint: string
          tick_spacing_q96: number
          transaction_sequence: Json
          unsold_mode: string
        }
        Update: {
          created_at?: string
          duration_blocks?: number
          expires_at?: string
          floor_price_q96?: number
          fork_block?: number
          id?: string
          launch_id?: string
          live_attestation?: Json
          lp_custody_mode?: string
          manifest_fingerprint?: string
          manifest_version?: string
          migration_mode?: string
          overall_result?: string
          p8a_review_id?: string
          refund_fingerprint?: string
          refund_mode?: string
          release_schedule_fingerprint?: string
          reviewed_at?: string
          reviewed_by?: string
          safe_tx_count_post?: number
          safe_tx_count_pre?: number
          settlement_mode?: string
          signatures_per_safe_tx?: number
          source_attestation_fingerprint?: string
          success_fingerprint?: string
          tick_spacing_q96?: number
          transaction_sequence?: Json
          unsold_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_auction_execution_rehearsal_reviews_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_auction_execution_rehearsal_reviews_p8a_review_id_fkey"
            columns: ["p8a_review_id"]
            isOneToOne: false
            referencedRelation: "pcart_auction_liquidity_plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_auction_liquidity_plan_reviews: {
        Row: {
          created_at: string
          dependency_attestation: Json
          deployment_id: string | null
          expires_at: string
          id: string
          launch_id: string
          lp_custody_policy: string
          mainnet_dependencies_ok: boolean
          manifest_fingerprint: string
          manifest_version: string
          rehearsal_mode: string
          review_kind: string
          reviewed_at: string
          reviewed_by: string
          simulation_fingerprint: string
          simulation_summary: Json
          unsold_policy: string
          unsold_policy_requires_live_reconfirmation: boolean
        }
        Insert: {
          created_at?: string
          dependency_attestation: Json
          deployment_id?: string | null
          expires_at: string
          id?: string
          launch_id: string
          lp_custody_policy: string
          mainnet_dependencies_ok: boolean
          manifest_fingerprint: string
          manifest_version: string
          rehearsal_mode: string
          review_kind: string
          reviewed_at?: string
          reviewed_by: string
          simulation_fingerprint: string
          simulation_summary: Json
          unsold_policy: string
          unsold_policy_requires_live_reconfirmation: boolean
        }
        Update: {
          created_at?: string
          dependency_attestation?: Json
          deployment_id?: string | null
          expires_at?: string
          id?: string
          launch_id?: string
          lp_custody_policy?: string
          mainnet_dependencies_ok?: boolean
          manifest_fingerprint?: string
          manifest_version?: string
          rehearsal_mode?: string
          review_kind?: string
          reviewed_at?: string
          reviewed_by?: string
          simulation_fingerprint?: string
          simulation_summary?: Json
          unsold_policy?: string
          unsold_policy_requires_live_reconfirmation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pcart_auction_liquidity_plan_reviews_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_auction_liquidity_plan_reviews_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_launch_coordinator_events: {
        Row: {
          actor: string | null
          coordinator_state: string | null
          created_at: string
          detail: Json
          event_kind: string
          id: string
          launch_id: string
        }
        Insert: {
          actor?: string | null
          coordinator_state?: string | null
          created_at?: string
          detail?: Json
          event_kind: string
          id?: string
          launch_id: string
        }
        Update: {
          actor?: string | null
          coordinator_state?: string | null
          created_at?: string
          detail?: Json
          event_kind?: string
          id?: string
          launch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_launch_coordinator_events_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_launch_day_plans: {
        Row: {
          authoritative_start_block: number | null
          auto_start: boolean
          cadence_observed_at: string | null
          created_at: string
          end_block: number | null
          estimated_start_block: number | null
          intended_auction_start_at: string | null
          launch_id: string
          observed_ms_per_block: number | null
          promotion_start_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          authoritative_start_block?: number | null
          auto_start?: boolean
          cadence_observed_at?: string | null
          created_at?: string
          end_block?: number | null
          estimated_start_block?: number | null
          intended_auction_start_at?: string | null
          launch_id: string
          observed_ms_per_block?: number | null
          promotion_start_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          authoritative_start_block?: number | null
          auto_start?: boolean
          cadence_observed_at?: string | null
          created_at?: string
          end_block?: number | null
          estimated_start_block?: number | null
          intended_auction_start_at?: string | null
          launch_id?: string
          observed_ms_per_block?: number | null
          promotion_start_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pcart_launch_day_plans_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: true
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_policy_approval_revocations: {
        Row: {
          id: string
          launch_id: string
          reason: string
          review_id: string
          review_kind: string
          revoked_at: string
          revoked_by: string
        }
        Insert: {
          id?: string
          launch_id: string
          reason: string
          review_id: string
          review_kind: string
          revoked_at?: string
          revoked_by: string
        }
        Update: {
          id?: string
          launch_id?: string
          reason?: string
          review_id?: string
          review_kind?: string
          revoked_at?: string
          revoked_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_policy_approval_revocations_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_production_execution_permits: {
        Row: {
          action_type: string | null
          artifact_id: string
          binding_version: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          consumed_at: string | null
          created_at: string
          dependency_attestation_fingerprint: string | null
          deployer_nonce: number
          deployment_id: string
          execution_control_revision: number | null
          expires_at: string
          gas_limit: number
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          max_fee_per_gas: number
          max_priority_fee_per_gas: number
          p8a_manifest_fingerprint: string | null
          p8a_manifest_version: string | null
          p8a_review_id: string | null
          p8b_manifest_fingerprint: string | null
          p8b_manifest_version: string | null
          p8b_review_id: string | null
          predicted_contract_address: string
          preparation_authorization_id: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_attestation_fingerprint: string | null
          safe_nonce: number | null
          safe_recipient: string
          unsigned_tx_fingerprint: string
          wallet_account: string
        }
        Insert: {
          action_type?: string | null
          artifact_id?: string
          binding_version?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          chain_id?: number
          consumed_at?: string | null
          created_at?: string
          dependency_attestation_fingerprint?: string | null
          deployer_nonce: number
          deployment_id: string
          execution_control_revision?: number | null
          expires_at: string
          gas_limit: number
          id?: string
          init_code_hash: string
          issued_at?: string
          issued_by: string
          launch_id: string
          max_fee_per_gas: number
          max_priority_fee_per_gas: number
          p8a_manifest_fingerprint?: string | null
          p8a_manifest_version?: string | null
          p8a_review_id?: string | null
          p8b_manifest_fingerprint?: string | null
          p8b_manifest_version?: string | null
          p8b_review_id?: string | null
          predicted_contract_address: string
          preparation_authorization_id: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_attestation_fingerprint?: string | null
          safe_nonce?: number | null
          safe_recipient: string
          unsigned_tx_fingerprint: string
          wallet_account: string
        }
        Update: {
          action_type?: string | null
          artifact_id?: string
          binding_version?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          chain_id?: number
          consumed_at?: string | null
          created_at?: string
          dependency_attestation_fingerprint?: string | null
          deployer_nonce?: number
          deployment_id?: string
          execution_control_revision?: number | null
          expires_at?: string
          gas_limit?: number
          id?: string
          init_code_hash?: string
          issued_at?: string
          issued_by?: string
          launch_id?: string
          max_fee_per_gas?: number
          max_priority_fee_per_gas?: number
          p8a_manifest_fingerprint?: string | null
          p8a_manifest_version?: string | null
          p8a_review_id?: string | null
          p8b_manifest_fingerprint?: string | null
          p8b_manifest_version?: string | null
          p8b_review_id?: string | null
          predicted_contract_address?: string
          preparation_authorization_id?: string
          readiness_fingerprint?: string
          review_fingerprint?: string
          safe_attestation_fingerprint?: string | null
          safe_nonce?: number | null
          safe_recipient?: string
          unsigned_tx_fingerprint?: string
          wallet_account?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_production_execution_pe_preparation_authorization_id_fkey"
            columns: ["preparation_authorization_id"]
            isOneToOne: false
            referencedRelation: "pcart_production_preparation_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_execution_permits_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_execution_permits_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_production_preparation_authorizations: {
        Row: {
          artifact_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          client_request_id: string
          created_at: string
          deployer_address: string
          deployer_nonce_before: number
          deployment_id: string
          expires_at: string
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          network_environment: string
          observed_latest_nonce: number
          observed_pending_nonce: number
          predicted_contract_address: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_address: string
          wallet_account: string
        }
        Insert: {
          artifact_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          chain_id?: number
          client_request_id: string
          created_at?: string
          deployer_address: string
          deployer_nonce_before: number
          deployment_id: string
          expires_at: string
          id?: string
          init_code_hash: string
          issued_at?: string
          issued_by: string
          launch_id: string
          network_environment?: string
          observed_latest_nonce: number
          observed_pending_nonce: number
          predicted_contract_address: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_address: string
          wallet_account: string
        }
        Update: {
          artifact_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          chain_id?: number
          client_request_id?: string
          created_at?: string
          deployer_address?: string
          deployer_nonce_before?: number
          deployment_id?: string
          expires_at?: string
          id?: string
          init_code_hash?: string
          issued_at?: string
          issued_by?: string
          launch_id?: string
          network_environment?: string
          observed_latest_nonce?: number
          observed_pending_nonce?: number
          predicted_contract_address?: string
          readiness_fingerprint?: string
          review_fingerprint?: string
          safe_address?: string
          wallet_account?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_production_preparation_authorizations_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_preparation_authorizations_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_production_readiness_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          artifact_id: string
          id: string
          launch_id: string
          readiness_fingerprint: string
          rehearsal_deployment_id: string
          rehearsal_tx_hash: string
          safe_address: string
          safe_verified_at: string
          signer_config_id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          artifact_id?: string
          id?: string
          launch_id: string
          readiness_fingerprint: string
          rehearsal_deployment_id: string
          rehearsal_tx_hash: string
          safe_address: string
          safe_verified_at: string
          signer_config_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          artifact_id?: string
          id?: string
          launch_id?: string
          readiness_fingerprint?: string
          rehearsal_deployment_id?: string
          rehearsal_tx_hash?: string
          safe_address?: string
          safe_verified_at?: string
          signer_config_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_production_readiness_approva_rehearsal_deployment_id_fkey"
            columns: ["rehearsal_deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_readiness_approvals_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: true
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_readiness_approvals_signer_config_id_fkey"
            columns: ["signer_config_id"]
            isOneToOne: false
            referencedRelation: "launch_treasury_signer_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      pcart_production_send_claims: {
        Row: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        Insert: {
          broadcast_at?: string | null
          chain_id?: number
          claim_status?: string
          claimed_at?: string
          claimed_by: string
          created_at?: string
          deployer_nonce: number
          deployment_id: string
          id?: string
          last_recovery_checked_at?: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason?: string | null
          released_at?: string | null
          tx_hash?: string | null
          unsigned_tx_fingerprint: string
          updated_at?: string
          wallet_account: string
        }
        Update: {
          broadcast_at?: string | null
          chain_id?: number
          claim_status?: string
          claimed_at?: string
          claimed_by?: string
          created_at?: string
          deployer_nonce?: number
          deployment_id?: string
          id?: string
          last_recovery_checked_at?: string | null
          launch_id?: string
          permit_id?: string
          predicted_contract_address?: string
          release_reason?: string | null
          released_at?: string | null
          tx_hash?: string | null
          unsigned_tx_fingerprint?: string
          updated_at?: string
          wallet_account?: string
        }
        Relationships: [
          {
            foreignKeyName: "pcart_production_send_claims_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "launch_chain_deployments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_send_claims_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pcart_production_send_claims_permit_id_fkey"
            columns: ["permit_id"]
            isOneToOne: true
            referencedRelation: "pcart_production_execution_permits"
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
          reviewed_targets: Json
          setup_mission_id: string | null
          setup_request_id: string | null
          setup_source: string
          setup_started_at: string | null
          source_cleanup_error: string | null
          source_cleanup_required: boolean
          source_deleted_at: string | null
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
          reviewed_targets?: Json
          setup_mission_id?: string | null
          setup_request_id?: string | null
          setup_source?: string
          setup_started_at?: string | null
          source_cleanup_error?: string | null
          source_cleanup_required?: boolean
          source_deleted_at?: string | null
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
          reviewed_targets?: Json
          setup_mission_id?: string | null
          setup_request_id?: string | null
          setup_source?: string
          setup_started_at?: string | null
          source_cleanup_error?: string | null
          source_cleanup_required?: boolean
          source_deleted_at?: string | null
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
            foreignKeyName: "social_mission_link_candidates_setup_mission_id_fkey"
            columns: ["setup_mission_id"]
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
          activity_message_count: number
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
          last_activity_message_id: number | null
          last_edit_at: string | null
          last_error: string | null
          last_metric_signature: string | null
          last_resurface_at: string | null
          last_resurface_attempt_at: string | null
          message_text_snapshot: string | null
          mission_id: string
          pinned_at: string | null
          pinned_by_hq: boolean
          resurface_client_request_id: string | null
          resurface_last_error: string | null
          resurface_revision: number
          resurface_state: string
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
          activity_message_count?: number
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
          last_activity_message_id?: number | null
          last_edit_at?: string | null
          last_error?: string | null
          last_metric_signature?: string | null
          last_resurface_at?: string | null
          last_resurface_attempt_at?: string | null
          message_text_snapshot?: string | null
          mission_id: string
          pinned_at?: string | null
          pinned_by_hq?: boolean
          resurface_client_request_id?: string | null
          resurface_last_error?: string | null
          resurface_revision?: number
          resurface_state?: string
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
          activity_message_count?: number
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
          last_activity_message_id?: number | null
          last_edit_at?: string | null
          last_error?: string | null
          last_metric_signature?: string | null
          last_resurface_at?: string | null
          last_resurface_attempt_at?: string | null
          message_text_snapshot?: string | null
          mission_id?: string
          pinned_at?: string | null
          pinned_by_hq?: boolean
          resurface_client_request_id?: string | null
          resurface_last_error?: string | null
          resurface_revision?: number
          resurface_state?: string
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
          active_mission_id: string | null
          expires_at: string
          mode: string
          pending_control_field: string | null
          selected_workspace_id: string | null
          telegram_user_id: number
          updated_at: string
        }
        Insert: {
          active_conversation_id?: string | null
          active_mission_id?: string | null
          expires_at: string
          mode?: string
          pending_control_field?: string | null
          selected_workspace_id?: string | null
          telegram_user_id: number
          updated_at?: string
        }
        Update: {
          active_conversation_id?: string | null
          active_mission_id?: string | null
          expires_at?: string
          mode?: string
          pending_control_field?: string | null
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
            foreignKeyName: "telegram_team_sessions_active_mission_id_fkey"
            columns: ["active_mission_id"]
            isOneToOne: false
            referencedRelation: "social_missions"
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
          currency: string | null
          id: string
          idempotency_key: string | null
          internal_cost: number | null
          metadata: Json
          pricing_effective_at: string | null
          pricing_source: string | null
          pricing_version: string | null
          provider: string | null
          provider_cost: number | null
          provider_model: string | null
          unit_type: string | null
          units: number
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action_type: string
          ai_job_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          idempotency_key?: string | null
          internal_cost?: number | null
          metadata?: Json
          pricing_effective_at?: string | null
          pricing_source?: string | null
          pricing_version?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_model?: string | null
          unit_type?: string | null
          units?: number
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action_type?: string
          ai_job_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          idempotency_key?: string | null
          internal_cost?: number | null
          metadata?: Json
          pricing_effective_at?: string | null
          pricing_source?: string | null
          pricing_version?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_model?: string | null
          unit_type?: string | null
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
      workspace_commercial_assignments: {
        Row: {
          assigned_by: string | null
          assignment_source: string
          billing_owner_user_id: string | null
          channel: string
          channel_partner_ref: string | null
          created_at: string
          ends_at: string | null
          enforcement_mode: string
          external_ref: string | null
          id: string
          plan_id: string
          starts_at: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_by?: string | null
          assignment_source?: string
          billing_owner_user_id?: string | null
          channel?: string
          channel_partner_ref?: string | null
          created_at?: string
          ends_at?: string | null
          enforcement_mode?: string
          external_ref?: string | null
          id?: string
          plan_id: string
          starts_at?: string
          status: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_by?: string | null
          assignment_source?: string
          billing_owner_user_id?: string | null
          channel?: string
          channel_partner_ref?: string | null
          created_at?: string
          ends_at?: string | null
          enforcement_mode?: string
          external_ref?: string | null
          id?: string
          plan_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_commercial_assignments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "commercial_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_commercial_assignments_workspace_id_fkey"
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
      abandon_canonical_pcart_production_draft: {
        Args: { _deployment_id: string; _reason: string }
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
      abandon_mission_control_launcher_binding: {
        Args: { _binding_id: string }
        Returns: undefined
      }
      accept_partner_agreement: {
        Args: { _terms_version: number }
        Returns: Json
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
      apply_canonical_pcart_production_finality: {
        Args: {
          _deployment_id: string
          _finality_notice?: string
          _finality_state: string
          _finalized_block_number?: number
          _finalized_head_block_number?: number
          _reread_block_hash?: string
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
          deployer_nonce_before: number | null
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
      apply_canonical_pcart_production_verification: {
        Args: {
          _block_hash?: string
          _block_number?: number
          _confirmations?: number
          _contract_address?: string
          _deployer_balance_text?: string
          _deployment_id: string
          _failure_code?: string
          _failure_detail?: string
          _observed_tx_hash: string
          _outcome: string
          _runtime_code_hash?: string
          _safe_balance_text?: string
          _verified_token_decimals?: number
          _verified_token_name?: string
          _verified_token_symbol?: string
          _verified_total_supply_text?: string
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
          deployer_nonce_before: number | null
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
      apply_commercial_downgrade_effects: {
        Args: { _workspace_id: string }
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
      apply_stripe_subscription_state: {
        Args: {
          _billing_owner_user_id: string
          _cancel_at_period_end: boolean
          _current_period_end: string
          _current_period_start: string
          _customer_ref: string
          _environment: string
          _payment_failed_at: string
          _plan_code: string
          _plan_version: number
          _price_ref: string
          _stripe_status: string
          _subscription_ref: string
          _workspace_id: string
        }
        Returns: Json
      }
      approve_canonical_pcart_production_readiness: {
        Args: { _launch_id: string }
        Returns: {
          approved_at: string
          approved_by: string
          artifact_id: string
          id: string
          launch_id: string
          readiness_fingerprint: string
          rehearsal_deployment_id: string
          rehearsal_tx_hash: string
          safe_address: string
          safe_verified_at: string
          signer_config_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_readiness_approvals"
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
          artifact_id: string
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
      bind_referral_to_workspace: {
        Args: { _workspace_id: string }
        Returns: Json
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
      can_use_project_tools: {
        Args: { _user_id?: string; _workspace_id: string }
        Returns: boolean
      }
      cancel_canonical_pcart_execution_permit: {
        Args: { _permit_id: string }
        Returns: {
          action_type: string | null
          artifact_id: string
          binding_version: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          consumed_at: string | null
          created_at: string
          dependency_attestation_fingerprint: string | null
          deployer_nonce: number
          deployment_id: string
          execution_control_revision: number | null
          expires_at: string
          gas_limit: number
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          max_fee_per_gas: number
          max_priority_fee_per_gas: number
          p8a_manifest_fingerprint: string | null
          p8a_manifest_version: string | null
          p8a_review_id: string | null
          p8b_manifest_fingerprint: string | null
          p8b_manifest_version: string | null
          p8b_review_id: string | null
          predicted_contract_address: string
          preparation_authorization_id: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_attestation_fingerprint: string | null
          safe_nonce: number | null
          safe_recipient: string
          unsigned_tx_fingerprint: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_execution_permits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_canonical_pcart_production_presign_authorization: {
        Args: { _authorization_id: string }
        Returns: {
          artifact_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          client_request_id: string
          created_at: string
          deployer_address: string
          deployer_nonce_before: number
          deployment_id: string
          expires_at: string
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          network_environment: string
          observed_latest_nonce: number
          observed_pending_nonce: number
          predicted_contract_address: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_address: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_preparation_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
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
      cancel_social_mission_from_control: {
        Args: {
          _idempotency_key: string
          _mission_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
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
      claim_canonical_pcart_mainnet_send: {
        Args: { _permit_id: string }
        Returns: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_send_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_canonical_pcart_mainnet_send_v2: {
        Args: {
          _actor: string
          _dependency_attestation_fingerprint: string
          _permit_id: string
          _safe_attestation_fingerprint: string
        }
        Returns: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_send_claims"
          isOneToOne: true
          isSetofReturn: false
        }
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
      claim_mission_control_launcher_cleanup_job: {
        Args: { _job_id: string }
        Returns: {
          attempt_count: number
          cleanup_kind: string
          job_id: string
          telegram_chat_id: number
          telegram_message_id: number
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
      commercial_evaluate_workspace_feature: {
        Args: { _base: Json; _feature_key: string; _workspace_id: string }
        Returns: Json
      }
      commercial_feature_usage: {
        Args: {
          _feature_key: string
          _period_end: string
          _period_start: string
          _workspace_id: string
        }
        Returns: number
      }
      confirm_mission_control_launcher_binding: {
        Args: { _binding_id: string; _telegram_message_id: number }
        Returns: string
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
      create_canonical_pcart_production_draft: {
        Args: {
          _client_request_id: string
          _deployer_address: string
          _deployer_nonce_before: number
          _init_code_hash: string
          _launch_id: string
          _review_fingerprint: string
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
      create_launch_chain_pcart_rehearsal_attempt: {
        Args: {
          _client_request_id: string
          _deployer_address: string
          _launch_id: string
          _rehearsal_recipient: string
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
          deployer_nonce_before: number | null
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
      create_launch_chain_pcart_rehearsal_attempt_v2: {
        Args: {
          _client_request_id: string
          _deployer_address: string
          _deployer_nonce_before: number
          _launch_id: string
          _rehearsal_recipient: string
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
      create_self_service_workspace: {
        Args: { _name: string; _slug: string }
        Returns: string
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
      create_social_mission_setup_candidate: {
        Args: {
          _author_handle: string
          _canonical_url: string
          _external_post_id: string
          _setup_source?: string
          _telegram_chat_id: number
          _telegram_message_id: number
          _telegram_user_id: number
          _ttl_minutes?: number
        }
        Returns: Json
      }
      custom_media_gate_ok: { Args: { _g: Json }; Returns: boolean }
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
      end_social_mission_from_control: {
        Args: {
          _idempotency_key: string
          _mission_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
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
      evaluate_commercial_access: {
        Args: { _feature_key: string; _user_id?: string; _workspace_id: string }
        Returns: Json
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
      get_canonical_pcart_production_readiness: {
        Args: { _launch_id: string }
        Returns: Json
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
      get_my_partner_summary: { Args: never; Returns: Json }
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
      get_partner_program_status: { Args: never; Returns: Json }
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
      get_workspace_billing_status: {
        Args: { _user_id?: string; _workspace_id: string }
        Returns: Json
      }
      get_workspace_commercial_usage: {
        Args: { _user_id?: string; _workspace_id: string }
        Returns: Json
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
      issue_canonical_pcart_execution_permit: {
        Args: {
          _deployment_id: string
          _gas_limit: number
          _max_fee_per_gas: number
          _max_priority_fee_per_gas: number
          _preparation_authorization_id: string
          _unsigned_tx_fingerprint: string
        }
        Returns: {
          action_type: string | null
          artifact_id: string
          binding_version: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          consumed_at: string | null
          created_at: string
          dependency_attestation_fingerprint: string | null
          deployer_nonce: number
          deployment_id: string
          execution_control_revision: number | null
          expires_at: string
          gas_limit: number
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          max_fee_per_gas: number
          max_priority_fee_per_gas: number
          p8a_manifest_fingerprint: string | null
          p8a_manifest_version: string | null
          p8a_review_id: string | null
          p8b_manifest_fingerprint: string | null
          p8b_manifest_version: string | null
          p8b_review_id: string | null
          predicted_contract_address: string
          preparation_authorization_id: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_attestation_fingerprint: string | null
          safe_nonce: number | null
          safe_recipient: string
          unsigned_tx_fingerprint: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_execution_permits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_canonical_pcart_execution_permit_v2: {
        Args: {
          _actor: string
          _dependency_attestation_fingerprint: string
          _deployment_id: string
          _gas_limit: number
          _max_fee_per_gas: number
          _max_priority_fee_per_gas: number
          _preparation_authorization_id: string
          _safe_attestation_fingerprint: string
          _safe_nonce: number
          _unsigned_tx_fingerprint: string
        }
        Returns: {
          action_type: string | null
          artifact_id: string
          binding_version: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          consumed_at: string | null
          created_at: string
          dependency_attestation_fingerprint: string | null
          deployer_nonce: number
          deployment_id: string
          execution_control_revision: number | null
          expires_at: string
          gas_limit: number
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          max_fee_per_gas: number
          max_priority_fee_per_gas: number
          p8a_manifest_fingerprint: string | null
          p8a_manifest_version: string | null
          p8a_review_id: string | null
          p8b_manifest_fingerprint: string | null
          p8b_manifest_version: string | null
          p8b_review_id: string | null
          predicted_contract_address: string
          preparation_authorization_id: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_attestation_fingerprint: string | null
          safe_nonce: number | null
          safe_recipient: string
          unsigned_tx_fingerprint: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_execution_permits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_canonical_pcart_production_presign_authorization: {
        Args: {
          _client_request_id: string
          _deployment_id: string
          _observed_chain_id: number
          _observed_latest_nonce: number
          _observed_pending_nonce: number
          _predicted_contract_address: string
          _wallet_account: string
        }
        Returns: {
          artifact_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          chain_id: number
          client_request_id: string
          created_at: string
          deployer_address: string
          deployer_nonce_before: number
          deployment_id: string
          expires_at: string
          id: string
          init_code_hash: string
          issued_at: string
          issued_by: string
          launch_id: string
          network_environment: string
          observed_latest_nonce: number
          observed_pending_nonce: number
          predicted_contract_address: string
          readiness_fingerprint: string
          review_fingerprint: string
          safe_address: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_preparation_authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
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
          deployer_nonce_before: number | null
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
      list_my_managed_workspaces: {
        Args: never
        Returns: {
          access_id: string
          created_at: string
          scopes: string[]
          workspace_id: string
          workspace_name: string
        }[]
      }
      list_my_partner_invites: {
        Args: never
        Returns: {
          access_id: string
          invited_at: string
          scopes: string[]
          workspace_name: string
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
      mark_canonical_pcart_send_ambiguous: {
        Args: { _claim_id: string }
        Returns: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_send_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_stale_launch_notification_claims: { Args: never; Returns: number }
      mark_stale_project_inbox_delivery_claims: { Args: never; Returns: number }
      miniapp_inbox_ack_uncertainty: {
        Args: {
          _conversation_id: string
          _message_id: string
          _telegram_user_id: number
          _workspace_id: string
        }
        Returns: {
          delivery_status: string
          message_id: string
          uncertainty_acknowledged_at: string
        }[]
      }
      miniapp_inbox_bind_operator: {
        Args: {
          _conversation_id?: string
          _telegram_user_id: number
          _workspace_id: string
        }
        Returns: string
      }
      miniapp_inbox_create_team_reply: {
        Args: {
          _body: string
          _client_request_id: string
          _conversation_id: string
          _telegram_user_id: number
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
      miniapp_inbox_get_conversation: {
        Args: {
          _conversation_id: string
          _telegram_user_id: number
          _workspace_id: string
        }
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
      miniapp_inbox_list_conversations: {
        Args: {
          _limit?: number
          _status?: string
          _telegram_user_id: number
          _workspace_id: string
        }
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
      miniapp_inbox_list_messages: {
        Args: {
          _conversation_id: string
          _limit?: number
          _telegram_user_id: number
          _workspace_id: string
        }
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
      miniapp_inbox_set_blocked: {
        Args: {
          _blocked: boolean
          _conversation_id: string
          _telegram_user_id: number
          _workspace_id: string
        }
        Returns: {
          blocked_at: string
          contact_status: string
          conversation_id: string
          member_ref: string
        }[]
      }
      miniapp_inbox_summary: {
        Args: { _telegram_user_id: number; _workspace_id: string }
        Returns: {
          blocked_contact_count: number
          open_count: number
          resolved_count: number
          waiting_on_member_count: number
          waiting_on_team_count: number
        }[]
      }
      miniapp_inbox_update_status: {
        Args: {
          _conversation_id: string
          _status: string
          _telegram_user_id: number
          _workspace_id: string
        }
        Returns: {
          conversation_id: string
          resolved_at: string
          status: string
          updated_at: string
        }[]
      }
      note_canonical_pcart_send_recovery_check: {
        Args: { _claim_id: string; _operator_user_id: string }
        Returns: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_send_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notify_launch_watchers_official_contract: {
        Args: { _launch_id: string }
        Returns: Json
      }
      notify_launch_watchers_official_contract_correction: {
        Args: { _launch_id: string; _registration_event_id: string }
        Returns: Json
      }
      owner_activate_partner_terms: {
        Args: { _version: number }
        Returns: Json
      }
      owner_add_partner_ledger_adjustment: {
        Args: {
          _amount_cents: number
          _available_at?: string
          _currency: string
          _note: string
          _partner_id: string
          _referral_id?: string
        }
        Returns: string
      }
      owner_invite_service_partner: {
        Args: {
          _partner_email: string
          _scopes: string[]
          _workspace_id: string
        }
        Returns: string
      }
      owner_list_partner_access: {
        Args: { _workspace_id: string }
        Returns: {
          access_id: string
          invited_at: string
          partner_reference: string
          responded_at: string
          revoked_at: string
          scopes: string[]
          status: string
        }[]
      }
      owner_mark_partner_payout_paid: {
        Args: { _paid_reference: string; _payout_id: string }
        Returns: Json
      }
      owner_reject_partner_referral_for_fraud: {
        Args: { _reason: string; _referral_id: string }
        Returns: Json
      }
      owner_retire_partner_terms: { Args: { _version: number }; Returns: Json }
      owner_review_partner_application: {
        Args: { _application_id: string; _approve: boolean; _note?: string }
        Returns: Json
      }
      owner_review_partner_payout: {
        Args: { _approve: boolean; _note?: string; _payout_id: string }
        Returns: Json
      }
      owner_revoke_service_partner: {
        Args: { _access_id: string }
        Returns: undefined
      }
      owner_save_partner_terms_draft: {
        Args: {
          _agreement_text: string
          _attribution_window_days: number
          _commission_bps: number
          _currency: string
          _disclosure_text: string
          _hold_days: number
          _min_payout_cents: number
          _version: number
        }
        Returns: Json
      }
      owner_save_service_partner_terms_draft: {
        Args: {
          _agreement_text: string
          _disclosure_text: string
          _version: number
        }
        Returns: Json
      }
      owner_set_partner_status: {
        Args: { _partner_id: string; _status: string; _tax_doc_status?: string }
        Returns: Json
      }
      owner_update_partner_scopes: {
        Args: { _access_id: string; _scopes: string[] }
        Returns: undefined
      }
      partner_active_terms: {
        Args: never
        Returns: {
          activated_at: string | null
          activated_by: string | null
          affiliate_applications_open: boolean
          agreement_text: string | null
          attribution_window_days: number | null
          commission_bps: number | null
          commission_duration_invoices: number | null
          created_at: string
          created_by: string | null
          currency: string | null
          disclosure_text: string | null
          hold_days: number | null
          id: string
          min_payout_cents: number | null
          retired_at: string | null
          service_partner_applications_open: boolean
          status: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "partner_program_terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      partner_authorize_community_action: {
        Args: {
          _action: string
          _group_connection_id: string
          _workspace_id: string
        }
        Returns: Json
      }
      partner_authorize_group_broadcast: {
        Args: { _group_connection_id: string; _workspace_id: string }
        Returns: Json
      }
      partner_authorize_sticker_drop_action: {
        Args: {
          _action: string
          _enabled?: boolean
          _group_connection_id?: string
          _pack_id?: string
          _schedule_id?: string
          _workspace_id: string
        }
        Returns: Json
      }
      partner_available_balance: {
        Args: { _currency: string; _partner_id: string }
        Returns: number
      }
      partner_client_access_eligible: {
        Args: { _partner_id: string }
        Returns: boolean
      }
      partner_client_scopes_valid: {
        Args: { _scopes: string[] }
        Returns: boolean
      }
      partner_create_launch_watcher_update: {
        Args: {
          _body: string
          _client_request_id: string
          _launch_id: string
          _title: string
          _workspace_id: string
        }
        Returns: string
      }
      partner_evaluate_commercial_access: {
        Args: { _feature_key: string; _workspace_id: string }
        Returns: Json
      }
      partner_get_project_profile: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      partner_get_welcome_settings: {
        Args: { _group_connection_id: string; _workspace_id: string }
        Returns: Json
      }
      partner_has_scope: {
        Args: { _scope: string; _workspace_id: string }
        Returns: boolean
      }
      partner_inbox_ack_uncertainty: {
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
      partner_inbox_create_reply: {
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
      partner_inbox_get_conversation: {
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
      partner_inbox_list_conversations: {
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
      partner_inbox_list_messages: {
        Args: {
          _conversation_id: string
          _limit?: number
          _workspace_id: string
        }
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
      partner_inbox_summary: {
        Args: { _workspace_id: string }
        Returns: {
          blocked_contact_count: number
          open_count: number
          resolved_count: number
          waiting_on_member_count: number
          waiting_on_team_count: number
        }[]
      }
      partner_inbox_update_status: {
        Args: {
          _conversation_id: string
          _status: string
          _workspace_id: string
        }
        Returns: {
          conversation_id: string
          resolved_at: string
          status: string
          updated_at: string
        }[]
      }
      partner_launch_watcher_stats: {
        Args: { _launch_id: string; _workspace_id: string }
        Returns: {
          active_watchers: number
          updates_enabled_watchers: number
          updates_muted_watchers: number
        }[]
      }
      partner_list_broadcast_groups: {
        Args: { _workspace_id: string }
        Returns: {
          bot_is_admin: boolean
          chat_type: string
          group_connection_id: string
          operational: boolean
          title: string
          verified_at: string
        }[]
      }
      partner_list_community_groups: {
        Args: { _workspace_id: string }
        Returns: {
          bot_is_admin: boolean
          chat_type: string
          group_connection_id: string
          operational: boolean
          title: string
          verified_at: string
        }[]
      }
      partner_list_group_broadcasts: {
        Args: { _limit?: number; _workspace_id: string }
        Returns: {
          actor_kind: string
          announcement_id: string
          delivery_kind: string
          group_title: string
          message_text: string
          requested_at: string
          sent_at: string
          status: string
        }[]
      }
      partner_list_launch_watcher_updates: {
        Args: { _launch_id: string; _limit?: number; _workspace_id: string }
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
      partner_list_launches_for_comms: {
        Args: { _workspace_id: string }
        Returns: {
          can_send: boolean
          launch_at: string
          launch_id: string
          status: string
          ticker: string
          token_name: string
        }[]
      }
      partner_list_mission_state: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      partner_list_sticker_drop_packs: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      partner_list_sticker_drop_state: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      partner_require_owner: { Args: never; Returns: string }
      partner_respond_client_invite: {
        Args: { _accept: boolean; _access_id: string }
        Returns: undefined
      }
      partner_save_mission_settings: {
        Args: { _settings: Json; _workspace_id: string }
        Returns: Json
      }
      partner_update_project_profile: {
        Args: {
          _description: string
          _primary_chain: string
          _project_name: string
          _tagline: string
          _telegram_url: string
          _ticker: string
          _website_url: string
          _workspace_id: string
          _x_url: string
        }
        Returns: undefined
      }
      peek_social_mission_link_candidate: {
        Args: { _candidate_id: string; _telegram_user_id: number }
        Returns: Json
      }
      prepare_mission_control_launcher_binding: {
        Args: {
          _binding_id: string
          _close_token_hash: string
          _group_connection_id: string
        }
        Returns: boolean
      }
      project_identity_ready: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      project_inbox_delivery_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      read_social_mission_candidate_setup: {
        Args: {
          _candidate_id: string
          _close_token?: string
          _group_connection_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
      }
      record_canonical_pcart_mainnet_tx_hash: {
        Args: { _claim_id: string; _tx_hash: string }
        Returns: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_send_claims"
          isOneToOne: true
          isSetofReturn: false
        }
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
      record_pcart_auction_liquidity_plan_review: {
        Args: {
          _dependency_attestation: Json
          _launch_id: string
          _manifest_fingerprint: string
          _manifest_version: string
          _rehearsal_mode: string
          _simulation_fingerprint: string
          _simulation_summary: Json
        }
        Returns: string
      }
      record_referral_attribution: {
        Args: { _code: string; _source?: string }
        Returns: Json
      }
      record_social_mission_command_deleted: {
        Args: { _command_message_id: number; _target_id: string }
        Returns: boolean
      }
      record_social_mission_link_candidate_source_cleanup: {
        Args: { _candidate_id: string; _deleted: boolean; _reason?: string }
        Returns: Json
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
      register_canonical_pcart_official_contract: {
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
      release_canonical_pcart_mainnet_send_claim: {
        Args: { _claim_id: string; _mode: string; _operator_user_id: string }
        Returns: {
          broadcast_at: string | null
          chain_id: number
          claim_status: string
          claimed_at: string
          claimed_by: string
          created_at: string
          deployer_nonce: number
          deployment_id: string
          id: string
          last_recovery_checked_at: string | null
          launch_id: string
          permit_id: string
          predicted_contract_address: string
          release_reason: string | null
          released_at: string | null
          tx_hash: string | null
          unsigned_tx_fingerprint: string
          updated_at: string
          wallet_account: string
        }
        SetofOptions: {
          from: "*"
          to: "pcart_production_send_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      repair_and_expire_social_missions_for_metrics: {
        Args: { _limit?: number }
        Returns: Json
      }
      request_mission_control_launcher_cleanup: {
        Args: {
          _close_token: string
          _group_connection_id: string
          _telegram_user_id: number
        }
        Returns: string
      }
      request_partner_payout: {
        Args: { _amount_cents: number }
        Returns: string
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
      review_canonical_pcart_p8b_rehearsal: {
        Args: {
          _launch_id: string
          _live_attestation: Json
          _manifest_fingerprint: string
          _refund_fingerprint: string
          _release_schedule_fingerprint: string
          _source_attestation_fingerprint: string
          _success_fingerprint: string
          _transaction_sequence: Json
        }
        Returns: string
      }
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
      revoke_canonical_pcart_policy_approval: {
        Args: {
          _launch_id: string
          _reason: string
          _review_id: string
          _review_kind: string
        }
        Returns: string
      }
      save_launch_treasury_safe_evidence: {
        Args: {
          _launch_id: string
          _safe_address: string
          _safe_creation_tx_hash: string
          _safe_salt_nonce: string
          _safe_verified_block: number
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          launch_id: string
          safe_address: string | null
          safe_creation_tx_hash: string | null
          safe_salt_nonce: string | null
          safe_verified_at: string | null
          safe_verified_block: number | null
          signer_1: string
          signer_2: string
          signer_3: string
          threshold: number
          updated_at: string
          updated_by: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_treasury_signer_configs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_launch_treasury_signers: {
        Args: {
          _launch_id: string
          _signer_1: string
          _signer_2: string
          _signer_3: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          launch_id: string
          safe_address: string | null
          safe_creation_tx_hash: string | null
          safe_salt_nonce: string | null
          safe_verified_at: string | null
          safe_verified_block: number | null
          signer_1: string
          signer_2: string
          signer_3: string
          threshold: number
          updated_at: string
          updated_by: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "launch_treasury_signer_configs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_social_mission_candidate_setup: {
        Args: {
          _candidate_id: string
          _group_connection_id: string
          _request_id: string
          _targets: Json
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
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
      set_canonical_pcart_launch_day_plan: {
        Args: {
          _intended_auction_start_at: string
          _launch_id: string
          _promotion_start_at: string
        }
        Returns: undefined
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
          artifact_id: string
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
      set_workspace_commercial_assignment: {
        Args: {
          _assignment_source?: string
          _billing_owner_user_id?: string
          _channel?: string
          _channel_partner_ref?: string
          _ends_at?: string
          _enforcement_mode?: string
          _external_ref?: string
          _plan_code: string
          _plan_version: number
          _status?: string
          _workspace_id: string
        }
        Returns: Json
      }
      set_workspace_custom_message_media: {
        Args: {
          _actor_user_id: string
          _asset_id: string
          _slot: string
          _workspace_id: string
        }
        Returns: Json
      }
      social_mission_apply_duration_override: {
        Args: {
          _idempotency_key: string
          _minutes_from_now: number
          _mission_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
      }
      social_mission_apply_target_override: {
        Args: {
          _bookmarks: number
          _idempotency_key: string
          _likes: number
          _mission_id: string
          _mode: string
          _primary_target: number
          _primary_type: string
          _replies: number
          _reposts: number
          _telegram_user_id: number
          _verified_chat_id: number
          _views: number
        }
        Returns: Json
      }
      social_mission_auto_goal: { Args: { _baseline: number }; Returns: Json }
      social_mission_control_active_session: {
        Args: { _telegram_user_id: number }
        Returns: {
          mission_id: string
          pending_control_field: string
          workspace_id: string
        }[]
      }
      social_mission_control_append_history: {
        Args: {
          _action: string
          _actor_user_id: string
          _after: Json
          _before: Json
          _idempotency_key: string
          _mission_id: string
          _telegram_user_id: number
        }
        Returns: undefined
      }
      social_mission_control_authorize: {
        Args: {
          _mission_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: {
          actor_user_id: string
          mission_status: string
          outcome: string
          target_id: string
          workspace_id: string
        }[]
      }
      social_mission_control_key_used: {
        Args: { _idempotency_key: string; _mission_id: string }
        Returns: boolean
      }
      social_mission_control_merge_state: {
        Args: { _mission_id: string; _patch: Json }
        Returns: undefined
      }
      social_mission_control_missions: {
        Args: { _telegram_user_id: number; _workspace_id: string }
        Returns: {
          author_handle: string
          canonical_url: string
          control_mode: string
          ends_at: string
          mission_id: string
          started_at: string
          telegram_chat_id: number
        }[]
      }
      social_mission_control_panel: {
        Args: {
          _mission_id: string
          _telegram_user_id: number
          _verified_chat_id: number
        }
        Returns: Json
      }
      social_mission_control_set_session: {
        Args: {
          _clear?: boolean
          _mission_id?: string
          _pending_field?: string
          _telegram_user_id: number
          _workspace_id?: string
        }
        Returns: string
      }
      social_mission_control_workspaces: {
        Args: { _telegram_user_id: number }
        Returns: {
          live_missions: number
          workspace_id: string
          workspace_name: string
        }[]
      }
      social_mission_effective_config: {
        Args: { _mission_id: string }
        Returns: Json
      }
      social_mission_effective_config_resolved: {
        Args: { _mission_id: string }
        Returns: Json
      }
      social_mission_finalize_resurface: {
        Args: {
          _client_request_id: string
          _message_text: string
          _new_message_id: number
          _target_id: string
        }
        Returns: Json
      }
      social_mission_metric_targets: {
        Args: {
          _comments: number
          _likes: number
          _primary_target: number
          _primary_type: string
          _saves: number
          _shares: number
          _views: number
        }
        Returns: Json
      }
      social_mission_note_chat_activity: {
        Args: { _telegram_chat_id: number; _telegram_message_id: number }
        Returns: Json
      }
      social_mission_preset_config: { Args: { _preset: string }; Returns: Json }
      social_mission_resolve_config: {
        Args: { _metadata: Json }
        Returns: Json
      }
      social_mission_scheduler_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      social_mission_setup_targets_valid: {
        Args: { _targets: Json }
        Returns: boolean
      }
      social_mission_support_target: {
        Args: { _baseline: number; _floor_add: number }
        Returns: number
      }
      start_social_mission_candidate_setup: {
        Args: {
          _bot_can_delete: boolean
          _bot_can_pin: boolean
          _bot_is_admin: boolean
          _bot_permissions_resolved: boolean
          _candidate_id: string
          _group_connection_id: string
          _request_id: string
          _targets: Json
          _telegram_user_id: number
          _verified_chat_id: number
        }
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
          deployer_nonce_before: number | null
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
          deployer_nonce_before: number | null
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
          artifact_id: string
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
      submit_partner_application: {
        Args: {
          _pitch: string
          _wants_affiliate: boolean
          _wants_service_partner: boolean
        }
        Returns: string
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
          artifact_id: string
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
