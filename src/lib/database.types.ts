import type { AccountRole } from "../auth/authTypes";

export type Profile = {
  id: string;
  nome: string;
  role: AccountRole | null;
  created_at: string;
  updated_at: string;
};
export type Crianca = {
  id: string;
  usuario_id: string;
  nome: string;
  created_at: string;
  updated_at: string;
};
export type Comunicacao = {
  id: string;
  usuario_id: string;
  crianca_id: string;
  pictograma_id: string;
  rotulo: string;
  categoria: string;
  created_at: string;
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
};
export type ProfessionalMember = {
  professional_id: string;
  professional_name: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      caa_profiles: {
        Row: Profile;
        Insert: never;
        Update: { nome?: string };
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
          pictograma_id: string;
          rotulo: string;
          categoria: string;
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
    };
    Views: {
      caa_events: { Row: Comunicacao; Relationships: [] };
    };
    Functions: {
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
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
