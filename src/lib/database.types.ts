import type { AccountRole } from "../auth/authTypes";
import type { BoardSettings, BoardSettingsRow, CatalogOverride, CustomSymbol } from "./patientBoardModel";

export type Profile = {
  id: string;
  nome: string;
  role: AccountRole | null;
  professional_category?: string | null;
  professional_registration?: string | null;
  professional_validated_at?: string | null;
  created_at: string;
  updated_at: string;
};
export type Crianca = {
  id: string;
  usuario_id: string;
  nome: string;
  created_at: string;
  updated_at: string;
  board_access?: boolean;
};
export type CommunicationEventType = "legacy_symbol" | "symbol_selection" | "message_playback";
export type CommunicationSymbolSource = "catalog" | "custom";

export type Comunicacao = {
  id: string;
  usuario_id: string;
  crianca_id: string;
  pictograma_id: string | null;
  rotulo: string;
  categoria: string | null;
  created_at: string;
  event_type: CommunicationEventType;
  symbol_source: CommunicationSymbolSource | null;
  arasaac_id: number | null;
};
export type CaaInvitation = {
  id: string;
  crianca_id: string;
  code: string;
  expires_at: string;
  is_used: boolean;
  created_at: string;
};
export type CaaMember = {
  id: string;
  crianca_id: string;
  professional_id: string;
  created_at: string;
  board_access: boolean;
};
export type ProfessionalMember = {
  professional_id: string;
  professional_name: string;
  created_at: string;
  board_access?: boolean;
  professional_category?: string | null;
  professional_validated?: boolean;
  approved_at?: string | null;
};

export type AccountDeletionPatient = {
  patient_id: string;
  patient_name: string;
  successor_id: string | null;
  successor_name: string | null;
};

export type AccountDeletionPreview = {
  reauth_required: boolean;
  review_reason: "patient_care" | "storage" | null;
  review_requested_at: string | null;
  patients: AccountDeletionPatient[];
};
export type GuardianAccess = { is_owner: boolean; can_edit: boolean; can_manage_links: boolean };
export type GuardianMember = GuardianAccess & {
  guardian_id: string;
  guardian_name: string;
  created_at: string;
};
export type AccountOptionsRow = {
  roles: AccountRole[];
  professional_pending: boolean;
  professional_category: string | null;
  professional_registration: string | null;
  professional_validated: boolean;
};

export type Database = {
  public: {
    Tables: {
      caa_profiles: {
        Row: Profile;
        Insert: never;
        Update: { nome?: string; professional_category?: string | null; professional_registration?: string | null };
        Relationships: [];
      };
      criancas: {
        Row: Crianca;
        Insert: { id?: string; usuario_id?: string; nome: string };
        Update: { nome?: string };
        Relationships: [
          {
            foreignKeyName: "criancas_usuario_id_fkey";
            columns: ["usuario_id"];
            isOneToOne: false;
            referencedRelation: "caa_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comunicacoes: {
        Row: Comunicacao;
        Insert: {
          id?: string;
          usuario_id?: string;
          crianca_id: string;
          pictograma_id: string | null;
          rotulo: string;
          categoria: string | null;
          event_type?: CommunicationEventType;
          symbol_source?: CommunicationSymbolSource | null;
          arasaac_id?: number | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "comunicacoes_crianca_id_usuario_id_fkey";
            columns: ["crianca_id", "usuario_id"];
            isOneToOne: false;
            referencedRelation: "criancas";
            referencedColumns: ["id", "usuario_id"];
          },
        ];
      };
      caa_invitations: {
        Row: CaaInvitation;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      caa_members: {
        Row: CaaMember;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      caa_board_settings: {
        Row: BoardSettingsRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      caa_custom_symbols: {
        Row: CustomSymbol;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      caa_catalog_overrides: {
        Row: CatalogOverride;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      caa_events: { Row: Comunicacao; Relationships: [] };
    };
    Functions: {
      get_caa_pronunciation_settings: {
        Args: { p_crianca_id: string };
        Returns: { can_read: boolean; can_record: boolean; can_manage: boolean; retention_days: number | null }[];
      };
      list_caa_pronunciation_access: {
        Args: { p_crianca_id: string };
        Returns: { professional_id: string; professional_name: string; can_listen: boolean; can_observe: boolean }[];
      };
      set_caa_pronunciation_access: {
        Args: { p_crianca_id: string; p_professional_id: string; p_can_listen: boolean; p_can_observe: boolean };
        Returns: undefined;
      };
      set_caa_pronunciation_retention: {
        Args: { p_crianca_id: string; p_days: number };
        Returns: undefined;
      };
      save_caa_pronunciation: {
        Args: {
          p_crianca_id: string; p_id: string; p_practice: string; p_content_type: string;
          p_audio_base64: string; p_authorized: boolean;
        };
        Returns: string;
      };
      list_caa_pronunciation: {
        Args: { p_crianca_id: string; p_before_time: string | null; p_before_id: string | null };
        Returns: { id: string; practice: string; created_at: string; expires_at: string; can_delete: boolean; can_observe: boolean }[];
      };
      get_caa_pronunciation_audio: {
        Args: { p_id: string };
        Returns: { mime_type: string; audio_base64: string }[];
      };
      list_caa_pronunciation_notes: {
        Args: { p_id: string };
        Returns: { id: string; author_name: string; observation: string; updated_at: string; own: boolean }[];
      };
      save_caa_pronunciation_note: {
        Args: { p_id: string; p_observation: string };
        Returns: undefined;
      };
      delete_caa_pronunciation: {
        Args: { p_id: string };
        Returns: undefined;
      };
      get_caa_account_options: { Args: never; Returns: AccountOptionsRow[] };
      switch_caa_account_role: { Args: { p_expected_user_id: string; p_role: AccountRole }; Returns: undefined };
      request_caa_account_role: {
        Args: { p_expected_user_id: string; p_role: AccountRole; p_category: string | null; p_registration: string | null };
        Returns: undefined;
      };
      get_caa_guardian_access: { Args: { p_crianca_id: string }; Returns: GuardianAccess[] };
      list_caa_guardians: { Args: { p_crianca_id: string }; Returns: GuardianMember[] };
      create_caa_guardian_invitation: {
        Args: { p_crianca_id: string; p_email: string };
        Returns: { code: string; expires_at: string }[];
      };
      redeem_caa_guardian_invitation: { Args: { p_code: string }; Returns: string | null };
      set_caa_guardian_permissions: {
        Args: { p_crianca_id: string; p_guardian_id: string; p_can_edit: boolean; p_can_manage_links: boolean };
        Returns: boolean;
      };
      revoke_caa_guardian: { Args: { p_crianca_id: string; p_guardian_id: string }; Returns: boolean };
      approve_caa_professional_member: { Args: { p_crianca_id: string; p_professional_id: string }; Returns: boolean };
      complete_caa_profile_with_profession: {
        Args: { p_nome: string; p_consent: boolean; p_expected_user_id: string; p_category: string; p_registration: string | null };
        Returns: undefined;
      };
      query_caa_history: {
        Args: {
          p_crianca_id: string;
          p_from: string | null;
          p_to: string | null;
          p_event_type: string | null;
          p_search: string;
          p_before_time: string | null;
          p_before_id: string | null;
        };
        Returns: Comunicacao[];
      };
      preview_caa_account_deletion: { Args: { p_expected_user_id: string }; Returns: AccountDeletionPreview[] };
      confirm_caa_account_deletion: {
        Args: {
          p_expected_user_id: string;
          p_confirmation: string;
          p_expected_plan: AccountDeletionPatient[];
          p_expected_review_reason: string | null;
        };
        Returns: "deleted" | "reauth_required" | "plan_changed" | "review_requested";
      };
      complete_caa_profile: {
        Args: {
          p_role: AccountRole;
          p_nome: string;
          p_consent: boolean;
          p_expected_user_id: string;
        };
        Returns: Profile[];
      };
      create_caa_invitation: {
        Args: { p_crianca_id: string };
        Returns: CaaInvitation[];
      };
      redeem_caa_invitation: {
        Args: { p_code: string };
        Returns: {
          status: string;
          crianca_id: string | null;
          retry_after_seconds: number;
        }[];
      };
      list_caa_members: {
        Args: { p_crianca_id: string };
        Returns: ProfessionalMember[];
      };
      revoke_caa_member: {
        Args: { p_crianca_id: string; p_professional_id: string };
        Returns: boolean;
      };
      set_caa_board_member_access: {
        Args: { p_crianca_id: string; p_professional_id: string; p_allowed: boolean };
        Returns: boolean;
      };
      has_caa_board_access: {
        Args: { p_crianca_id: string };
        Returns: boolean;
      };
      save_caa_board_settings: {
        Args: { p_crianca_id: string; p_settings: BoardSettings; p_expected_version: number };
        Returns: BoardSettingsRow[];
      };
      save_caa_custom_symbol: {
        Args: {
          p_crianca_id: string;
          p_id: string | null;
          p_label: string;
          p_speech_text: string;
          p_categories: string[];
          p_arasaac_id: number | null;
          p_image_path: string | null;
          p_hidden: boolean;
          p_expected_version: number;
        };
        Returns: { symbol: CustomSymbol; retired_path: string | null }[];
      };
      delete_caa_custom_symbol: {
        Args: { p_crianca_id: string; p_id: string; p_expected_version: number };
        Returns: { retired_path: string | null }[];
      };
      save_caa_catalog_override: {
        Args: { p_crianca_id: string; p_symbol_id: string; p_arasaac_id: number | null };
        Returns: undefined;
      };
      reserve_caa_symbol_image: {
        Args: { p_crianca_id: string; p_authorized: boolean };
        Returns: string;
      };
      discard_caa_symbol_image: {
        Args: { p_crianca_id: string; p_path: string };
        Returns: undefined;
      };
      list_caa_symbol_image_cleanup: {
        Args: { p_crianca_id: string };
        Returns: string[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
