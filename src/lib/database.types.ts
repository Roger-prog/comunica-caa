import type { AccountRole } from "../auth/authTypes";
import type { BoardSettings, BoardSettingsRow, CatalogOverride, CustomSymbol } from "./patientBoardModel";

export type Profile = {
  id: string;
  nome: string;
  role: AccountRole | null;
  professional_category?: string | null;
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
};

export type Database = {
  public: {
    Tables: {
      caa_profiles: {
        Row: Profile;
        Insert: never;
        Update: { nome?: string; professional_category?: string | null };
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
      delete_own_caa_account: { Args: { p_expected_user_id: string }; Returns: undefined };
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
