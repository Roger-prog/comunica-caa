export type Profile = {
  id: string;
  nome: string;
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

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { id: string; nome: string };
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
            referencedRelation: "profiles";
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
