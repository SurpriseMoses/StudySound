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
      audio_assets: {
        Row: {
          char_count: number
          chunk_index: number
          created_at: string
          document_id: string
          duration_seconds: number | null
          id: string
          language: string
          storage_path: string
          voice_provider: Database["public"]["Enums"]["voice_provider"]
        }
        Insert: {
          char_count?: number
          chunk_index: number
          created_at?: string
          document_id: string
          duration_seconds?: number | null
          id?: string
          language: string
          storage_path: string
          voice_provider: Database["public"]["Enums"]["voice_provider"]
        }
        Update: {
          char_count?: number
          chunk_index?: number
          created_at?: string
          document_id?: string
          duration_seconds?: number | null
          id?: string
          language?: string
          storage_path?: string
          voice_provider?: Database["public"]["Enums"]["voice_provider"]
        }
        Relationships: [
          {
            foreignKeyName: "audio_assets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      character_sheets: {
        Row: {
          character_name: string
          created_at: string
          description: string
          id: string
          lesson_id: string
          reference_image_url: string | null
          user_id: string
        }
        Insert: {
          character_name: string
          created_at?: string
          description: string
          id?: string
          lesson_id: string
          reference_image_url?: string | null
          user_id: string
        }
        Update: {
          character_name?: string
          created_at?: string
          description?: string
          id?: string
          lesson_id?: string
          reference_image_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_sheets_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          document_id: string | null
          feature_type: string | null
          id: string
          metadata: Json | null
          request_id: string | null
          source: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          document_id?: string | null
          feature_type?: string | null
          id?: string
          metadata?: Json | null
          request_id?: string | null
          source: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          document_id?: string | null
          feature_type?: string | null
          id?: string
          metadata?: Json | null
          request_id?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_rewards: {
        Row: {
          created_at: string
          credits_awarded: number
          id: string
          reward_date: string
          streak_count: number
          trigger_action: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_awarded: number
          id?: string
          reward_date?: string
          streak_count: number
          trigger_action: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_awarded?: number
          id?: string
          reward_date?: string
          streak_count?: number
          trigger_action?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          char_count: number
          clean_text: string
          content_hash: string
          created_at: string
          grade_level: string | null
          id: string
          is_seeded: boolean
          language: string
          page_count: number | null
          source_url: string | null
          subject_type: Database["public"]["Enums"]["subject_type"]
          title: string
          updated_at: string
        }
        Insert: {
          char_count?: number
          clean_text: string
          content_hash: string
          created_at?: string
          grade_level?: string | null
          id?: string
          is_seeded?: boolean
          language?: string
          page_count?: number | null
          source_url?: string | null
          subject_type?: Database["public"]["Enums"]["subject_type"]
          title: string
          updated_at?: string
        }
        Update: {
          char_count?: number
          clean_text?: string
          content_hash?: string
          created_at?: string
          grade_level?: string | null
          id?: string
          is_seeded?: boolean
          language?: string
          page_count?: number | null
          source_url?: string | null
          subject_type?: Database["public"]["Enums"]["subject_type"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      image_assets: {
        Row: {
          created_at: string
          document_id: string
          id: string
          prompt_text: string
          scene_index: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          prompt_text: string
          scene_index: number
          storage_path: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          prompt_text?: string
          scene_index?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_assets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          audio_listened_seconds: number
          audio_progress_pct: number
          created_at: string
          id: string
          last_position_seconds: number
          last_updated_at: string
          lesson_id: string
          reward_claimed: boolean
          reward_eligible: boolean
          sections_completed: number
          sections_total: number
          user_id: string
        }
        Insert: {
          audio_listened_seconds?: number
          audio_progress_pct?: number
          created_at?: string
          id?: string
          last_position_seconds?: number
          last_updated_at?: string
          lesson_id: string
          reward_claimed?: boolean
          reward_eligible?: boolean
          sections_completed?: number
          sections_total?: number
          user_id: string
        }
        Update: {
          audio_listened_seconds?: number
          audio_progress_pct?: number
          created_at?: string
          id?: string
          last_position_seconds?: number
          last_updated_at?: string
          lesson_id?: string
          reward_claimed?: boolean
          reward_eligible?: boolean
          sections_completed?: number
          sections_total?: number
          user_id?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          audio_duration_seconds: number | null
          audio_url: string | null
          content_text: string
          created_at: string
          document_id: string | null
          id: string
          is_downloaded: boolean | null
          language: string | null
          progress: number | null
          subject: string
          title: string
          updated_at: string
          upload_id: string
          user_id: string
        }
        Insert: {
          audio_duration_seconds?: number | null
          audio_url?: string | null
          content_text: string
          created_at?: string
          document_id?: string | null
          id?: string
          is_downloaded?: boolean | null
          language?: string | null
          progress?: number | null
          subject: string
          title: string
          updated_at?: string
          upload_id: string
          user_id: string
        }
        Update: {
          audio_duration_seconds?: number | null
          audio_url?: string | null
          content_text?: string
          created_at?: string
          document_id?: string | null
          id?: string
          is_downloaded?: boolean | null
          language?: string | null
          progress?: number | null
          subject?: string
          title?: string
          updated_at?: string
          upload_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cooldown_until: string | null
          created_at: string
          credits_balance: number
          current_streak: number
          display_name: string | null
          flagged_reason: string | null
          free_credits_expires_at: string | null
          id: string
          is_flagged: boolean
          last_reward_date: string | null
          level: number
          onboarding_completed: boolean | null
          plan: Database["public"]["Enums"]["subscription_plan"] | null
          preferred_language: string | null
          selected_subjects: string[] | null
          streak_grace_used: boolean
          updated_at: string
          user_id: string
          xp: number
        }
        Insert: {
          avatar_url?: string | null
          cooldown_until?: string | null
          created_at?: string
          credits_balance?: number
          current_streak?: number
          display_name?: string | null
          flagged_reason?: string | null
          free_credits_expires_at?: string | null
          id?: string
          is_flagged?: boolean
          last_reward_date?: string | null
          level?: number
          onboarding_completed?: boolean | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          preferred_language?: string | null
          selected_subjects?: string[] | null
          streak_grace_used?: boolean
          updated_at?: string
          user_id: string
          xp?: number
        }
        Update: {
          avatar_url?: string | null
          cooldown_until?: string | null
          created_at?: string
          credits_balance?: number
          current_streak?: number
          display_name?: string | null
          flagged_reason?: string | null
          free_credits_expires_at?: string | null
          id?: string
          is_flagged?: boolean
          last_reward_date?: string | null
          level?: number
          onboarding_completed?: boolean | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          preferred_language?: string | null
          selected_subjects?: string[] | null
          streak_grace_used?: boolean
          updated_at?: string
          user_id?: string
          xp?: number
        }
        Relationships: []
      }
      quiz_assets: {
        Row: {
          created_at: string
          difficulty: string
          document_id: string
          id: string
          quiz_json: Json
        }
        Insert: {
          created_at?: string
          difficulty?: string
          document_id: string
          id?: string
          quiz_json: Json
        }
        Update: {
          created_at?: string
          difficulty?: string
          document_id?: string
          id?: string
          quiz_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "quiz_assets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean
          quiz_id: string
          selected_answer: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct: boolean
          quiz_id: string
          selected_answer: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          quiz_id?: string
          selected_answer?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          correct_answer: string
          created_at: string
          difficulty: string | null
          explanation: string | null
          id: string
          lesson_id: string
          options: Json | null
          question_text: string
          question_type: string
          user_id: string
        }
        Insert: {
          correct_answer: string
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          id?: string
          lesson_id: string
          options?: Json | null
          question_text: string
          question_type: string
          user_id: string
        }
        Update: {
          correct_answer?: string
          created_at?: string
          difficulty?: string | null
          explanation?: string | null
          id?: string
          lesson_id?: string
          options?: Json | null
          question_text?: string
          question_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_unlocks: {
        Row: {
          created_at: string
          credits_charged: number
          document_id: string
          id: string
          scene_index: number
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_charged?: number
          document_id: string
          id?: string
          scene_index: number
          user_id: string
        }
        Update: {
          created_at?: string
          credits_charged?: number
          document_id?: string
          id?: string
          scene_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_unlocks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      translation_assets: {
        Row: {
          char_count: number
          chunk_index: number
          created_at: string
          document_id: string
          id: string
          source_language: string
          target_language: string
          translated_text: string
        }
        Insert: {
          char_count?: number
          chunk_index: number
          created_at?: string
          document_id: string
          id?: string
          source_language?: string
          target_language: string
          translated_text: string
        }
        Update: {
          char_count?: number
          chunk_index?: number
          created_at?: string
          document_id?: string
          id?: string
          source_language?: string
          target_language?: string
          translated_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "translation_assets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      translation_rate_log: {
        Row: {
          chunk_index: number | null
          created_at: string
          document_id: string | null
          id: string
          target_language: string | null
          user_id: string
        }
        Insert: {
          chunk_index?: number | null
          created_at?: string
          document_id?: string | null
          id?: string
          target_language?: string | null
          user_id: string
        }
        Update: {
          chunk_index?: number | null
          created_at?: string
          document_id?: string | null
          id?: string
          target_language?: string | null
          user_id?: string
        }
        Relationships: []
      }
      translation_watermarks: {
        Row: {
          chunk_index: number
          created_at: string
          document_id: string
          id: string
          target_language: string
          user_id: string
          watermark_hash: string
        }
        Insert: {
          chunk_index: number
          created_at?: string
          document_id: string
          id?: string
          target_language: string
          user_id: string
          watermark_hash: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          document_id?: string
          id?: string
          target_language?: string
          user_id?: string
          watermark_hash?: string
        }
        Relationships: []
      }
      uploads: {
        Row: {
          created_at: string
          extracted_text: string | null
          file_name: string
          file_size_bytes: number
          file_type: string
          id: string
          page_count: number | null
          status: string
          storage_path: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          extracted_text?: string | null
          file_name: string
          file_size_bytes: number
          file_type: string
          id?: string
          page_count?: number | null
          status?: string
          storage_path: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          extracted_text?: string | null
          file_name?: string
          file_size_bytes?: number
          file_type?: string
          id?: string
          page_count?: number | null
          status?: string
          storage_path?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_tracking: {
        Row: {
          audio_minutes_used: number | null
          created_at: string
          id: string
          lessons_downloaded: number | null
          period_start: string
          quiz_questions_generated: number | null
          updated_at: string
          uploads_count: number | null
          user_id: string
          visual_scenes_generated: number | null
        }
        Insert: {
          audio_minutes_used?: number | null
          created_at?: string
          id?: string
          lessons_downloaded?: number | null
          period_start?: string
          quiz_questions_generated?: number | null
          updated_at?: string
          uploads_count?: number | null
          user_id: string
          visual_scenes_generated?: number | null
        }
        Update: {
          audio_minutes_used?: number | null
          created_at?: string
          id?: string
          lessons_downloaded?: number | null
          period_start?: string
          quiz_questions_generated?: number | null
          updated_at?: string
          uploads_count?: number | null
          user_id?: string
          visual_scenes_generated?: number | null
        }
        Relationships: []
      }
      user_asset_access: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          credits_charged: number
          document_id: string
          id: string
          user_id: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          credits_charged?: number
          document_id: string
          id?: string
          user_id: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          credits_charged?: number
          document_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_access_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_chunk_access: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          chunk_index: number
          created_at: string
          credits_charged: number
          document_id: string
          id: string
          language: string
          user_id: string
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          chunk_index: number
          created_at?: string
          credits_charged?: number
          document_id: string
          id?: string
          language: string
          user_id: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          chunk_index?: number
          created_at?: string
          credits_charged?: number
          document_id?: string
          id?: string
          language?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_chunk_access_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_translation_access: {
        Row: {
          chunk_index: number
          created_at: string
          credits_charged: number
          document_id: string
          id: string
          target_language: string
          user_id: string
        }
        Insert: {
          chunk_index: number
          created_at?: string
          credits_charged?: number
          document_id: string
          id?: string
          target_language: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          credits_charged?: number
          document_id?: string
          id?: string
          target_language?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_translation_access_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_usage: {
        Row: {
          action_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          credits_used: number
          document_id: string | null
          id: string
          request_id: string | null
          user_id: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          credits_used?: number
          document_id?: string | null
          id?: string
          request_id?: string | null
          user_id: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          credits_used?: number
          document_id?: string | null
          id?: string
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_usage_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_scenes: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          lesson_id: string
          paragraph_index: number
          prompt_text: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          lesson_id: string
          paragraph_index: number
          prompt_text: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          lesson_id?: string
          paragraph_index?: number
          prompt_text?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_scenes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_events: {
        Row: {
          created_at: string
          credits_awarded: number
          id: string
          metadata: Json | null
          source: string
          source_key: string | null
          user_id: string
          xp_awarded: number
        }
        Insert: {
          created_at?: string
          credits_awarded?: number
          id?: string
          metadata?: Json | null
          source: string
          source_key?: string | null
          user_id: string
          xp_awarded: number
        }
        Update: {
          created_at?: string
          credits_awarded?: number
          id?: string
          metadata?: Json | null
          source?: string
          source_key?: string | null
          user_id?: string
          xp_awarded?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_abuse_candidates: {
        Args: never
        Returns: {
          audio_today: number
          cooldown_until: string
          daily_cap: number
          display_name: string
          is_flagged: boolean
          plan: string
          translations_last_minute: number
          translations_today: number
          user_id: string
        }[]
      }
      admin_business_metrics: { Args: { _days?: number }; Returns: Json }
      admin_credit_timeseries: {
        Args: { _days?: number }
        Returns: {
          audio_credits: number
          day: string
          total: number
          translation_credits: number
          visual_credits: number
        }[]
      }
      admin_top_documents: {
        Args: { _limit?: number }
        Returns: {
          audio_cached: number
          audio_unlocks: number
          credits_generated: number
          document_id: string
          last_activity: string
          title: string
          total_unlocks: number
          translation_unlocks: number
          visual_unlocks: number
        }[]
      }
      count_translations_last_minute: {
        Args: { _user_id: string }
        Returns: number
      }
      count_translations_today: { Args: { _user_id: string }; Returns: number }
      expire_free_credits: { Args: { _user_id: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      search_documents_fuzzy: {
        Args: { _limit?: number; _query: string; _threshold?: number }
        Returns: {
          char_count: number
          id: string
          similarity: number
          subject_type: Database["public"]["Enums"]["subject_type"]
          title: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "user"
      asset_type: "audio" | "image" | "quiz"
      subject_type: "novel" | "history" | "science" | "other"
      subscription_plan: "free" | "essential" | "premium"
      voice_provider: "azure" | "elevenlabs"
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
      app_role: ["admin", "user"],
      asset_type: ["audio", "image", "quiz"],
      subject_type: ["novel", "history", "science", "other"],
      subscription_plan: ["free", "essential", "premium"],
      voice_provider: ["azure", "elevenlabs"],
    },
  },
} as const
