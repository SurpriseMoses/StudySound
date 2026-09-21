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
      assessment_patterns: {
        Row: {
          cognitive_demand: string | null
          command_word: string | null
          created_at: string
          created_by: string | null
          curriculum_reference: string | null
          exam_session: string | null
          grade: string | null
          id: string
          marks: number | null
          notes: string | null
          occurrences: number
          paper_number: string | null
          pattern_summary: string | null
          question_type: string | null
          section: string | null
          skill_assessed: string | null
          source_document_id: string | null
          subject: string | null
          subtopic: string | null
          topic: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          cognitive_demand?: string | null
          command_word?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_reference?: string | null
          exam_session?: string | null
          grade?: string | null
          id?: string
          marks?: number | null
          notes?: string | null
          occurrences?: number
          paper_number?: string | null
          pattern_summary?: string | null
          question_type?: string | null
          section?: string | null
          skill_assessed?: string | null
          source_document_id?: string | null
          subject?: string | null
          subtopic?: string | null
          topic?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          cognitive_demand?: string | null
          command_word?: string | null
          created_at?: string
          created_by?: string | null
          curriculum_reference?: string | null
          exam_session?: string | null
          grade?: string | null
          id?: string
          marks?: number | null
          notes?: string | null
          occurrences?: number
          paper_number?: string | null
          pattern_summary?: string | null
          question_type?: string | null
          section?: string | null
          skill_assessed?: string | null
          source_document_id?: string | null
          subject?: string | null
          subtopic?: string | null
          topic?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_patterns_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_assets: {
        Row: {
          char_count: number
          chunk_index: number
          clean_text_hash: string
          cleaning_version: number
          created_at: string
          document_id: string
          duration_seconds: number | null
          id: string
          language: string
          speaking_style: string
          storage_path: string
          voice_name: string
          voice_provider: Database["public"]["Enums"]["voice_provider"]
        }
        Insert: {
          char_count?: number
          chunk_index: number
          clean_text_hash?: string
          cleaning_version?: number
          created_at?: string
          document_id: string
          duration_seconds?: number | null
          id?: string
          language: string
          speaking_style?: string
          storage_path: string
          voice_name?: string
          voice_provider: Database["public"]["Enums"]["voice_provider"]
        }
        Update: {
          char_count?: number
          chunk_index?: number
          clean_text_hash?: string
          cleaning_version?: number
          created_at?: string
          document_id?: string
          duration_seconds?: number | null
          id?: string
          language?: string
          speaking_style?: string
          storage_path?: string
          voice_name?: string
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
      caps_sync_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          message: string | null
          meta: Json
          source_id: string | null
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          message?: string | null
          meta?: Json
          source_id?: string | null
          status: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          message?: string | null
          meta?: Json
          source_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "caps_sync_logs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
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
      content_quality_metrics: {
        Row: {
          cleaning_success_rate: number | null
          computed_at: string
          document_id: string
          duplicate_score: number | null
          english_leakage_pct: number | null
          missing_chunks: number | null
          ocr_score: number | null
          translation_health: number | null
        }
        Insert: {
          cleaning_success_rate?: number | null
          computed_at?: string
          document_id: string
          duplicate_score?: number | null
          english_leakage_pct?: number | null
          missing_chunks?: number | null
          ocr_score?: number | null
          translation_health?: number | null
        }
        Update: {
          cleaning_success_rate?: number | null
          computed_at?: string
          document_id?: string
          duplicate_score?: number | null
          english_leakage_pct?: number | null
          missing_chunks?: number | null
          ocr_score?: number | null
          translation_health?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_quality_metrics_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      content_sources: {
        Row: {
          country: string | null
          coverage_gained: number
          created_at: string
          curriculum: string | null
          docs_discovered: number
          docs_imported: number
          docs_mapped: number
          grade: string | null
          id: string
          import_count: number
          last_import_at: string | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_hash: string | null
          license_type: Database["public"]["Enums"]["license_type"]
          name: string
          notes: string | null
          source_type: string
          source_url: string | null
          subject: string | null
          sync_status: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["source_verification"]
        }
        Insert: {
          country?: string | null
          coverage_gained?: number
          created_at?: string
          curriculum?: string | null
          docs_discovered?: number
          docs_imported?: number
          docs_mapped?: number
          grade?: string | null
          id?: string
          import_count?: number
          last_import_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_hash?: string | null
          license_type?: Database["public"]["Enums"]["license_type"]
          name: string
          notes?: string | null
          source_type?: string
          source_url?: string | null
          subject?: string | null
          sync_status?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["source_verification"]
        }
        Update: {
          country?: string | null
          coverage_gained?: number
          created_at?: string
          curriculum?: string | null
          docs_discovered?: number
          docs_imported?: number
          docs_mapped?: number
          grade?: string | null
          id?: string
          import_count?: number
          last_import_at?: string | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_hash?: string | null
          license_type?: Database["public"]["Enums"]["license_type"]
          name?: string
          notes?: string | null
          source_type?: string
          source_url?: string | null
          subject?: string | null
          sync_status?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["source_verification"]
        }
        Relationships: []
      }
      content_topic_mapping: {
        Row: {
          chunk_index: number | null
          confidence: number
          country: string
          created_at: string
          curriculum: string
          document_id: string
          grade: string
          id: string
          signals: Json
          source: string
          subject: string
          subtopic: string | null
          topic: string | null
          updated_at: string
        }
        Insert: {
          chunk_index?: number | null
          confidence?: number
          country?: string
          created_at?: string
          curriculum?: string
          document_id: string
          grade: string
          id?: string
          signals?: Json
          source?: string
          subject: string
          subtopic?: string | null
          topic?: string | null
          updated_at?: string
        }
        Update: {
          chunk_index?: number | null
          confidence?: number
          country?: string
          created_at?: string
          curriculum?: string
          document_id?: string
          grade?: string
          id?: string
          signals?: Json
          source?: string
          subject?: string
          subtopic?: string | null
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_topic_mapping_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_snapshots: {
        Row: {
          country: string
          covered_topics: number
          created_at: string
          curriculum: string
          id: string
          note: string | null
          resources: number
          source_id: string | null
          total_topics: number
        }
        Insert: {
          country?: string
          covered_topics: number
          created_at?: string
          curriculum?: string
          id?: string
          note?: string | null
          resources?: number
          source_id?: string | null
          total_topics: number
        }
        Update: {
          country?: string
          covered_topics?: number
          created_at?: string
          curriculum?: string
          id?: string
          note?: string | null
          resources?: number
          source_id?: string | null
          total_topics?: number
        }
        Relationships: [
          {
            foreignKeyName: "coverage_snapshots_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_purchases: {
        Row: {
          amount_zar: number
          bonus_credits: number
          created_at: string
          credited: boolean
          credits: number
          currency: string
          id: string
          kind: string
          pack_id: string
          paystack_payload: Json | null
          plan_id: string | null
          provider: string
          reference: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_zar: number
          bonus_credits?: number
          created_at?: string
          credited?: boolean
          credits: number
          currency?: string
          id?: string
          kind?: string
          pack_id: string
          paystack_payload?: Json | null
          plan_id?: string | null
          provider?: string
          reference: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_zar?: number
          bonus_credits?: number
          created_at?: string
          credited?: boolean
          credits?: number
          currency?: string
          id?: string
          kind?: string
          pack_id?: string
          paystack_payload?: Json | null
          plan_id?: string | null
          provider?: string
          reference?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          api_cost: number
          created_at: string
          document_id: string | null
          feature_type: string | null
          generations: number
          id: string
          metadata: Json | null
          request_id: string | null
          source: string
          unlocks: number
          user_id: string
        }
        Insert: {
          amount: number
          api_cost?: number
          created_at?: string
          document_id?: string | null
          feature_type?: string | null
          generations?: number
          id?: string
          metadata?: Json | null
          request_id?: string | null
          source: string
          unlocks?: number
          user_id: string
        }
        Update: {
          amount?: number
          api_cost?: number
          created_at?: string
          document_id?: string | null
          feature_type?: string | null
          generations?: number
          id?: string
          metadata?: Json | null
          request_id?: string | null
          source?: string
          unlocks?: number
          user_id?: string
        }
        Relationships: []
      }
      curriculum_config: {
        Row: {
          assessment_skill: string | null
          cognitive_demand: string | null
          command_words: Json
          created_at: string
          created_by: string | null
          curriculum_system: string
          curriculum_version: string | null
          exam_alignment_level: string
          grade: string
          id: string
          is_active: boolean
          learning_objective: string | null
          phase: string | null
          subject: string
          subtopic: string | null
          topic: string
          typical_marks: number | null
          updated_at: string
        }
        Insert: {
          assessment_skill?: string | null
          cognitive_demand?: string | null
          command_words?: Json
          created_at?: string
          created_by?: string | null
          curriculum_system?: string
          curriculum_version?: string | null
          exam_alignment_level?: string
          grade: string
          id?: string
          is_active?: boolean
          learning_objective?: string | null
          phase?: string | null
          subject: string
          subtopic?: string | null
          topic: string
          typical_marks?: number | null
          updated_at?: string
        }
        Update: {
          assessment_skill?: string | null
          cognitive_demand?: string | null
          command_words?: Json
          created_at?: string
          created_by?: string | null
          curriculum_system?: string
          curriculum_version?: string | null
          exam_alignment_level?: string
          grade?: string
          id?: string
          is_active?: boolean
          learning_objective?: string | null
          phase?: string | null
          subject?: string
          subtopic?: string | null
          topic?: string
          typical_marks?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      curriculum_reference_docs: {
        Row: {
          created_at: string
          created_by: string | null
          curriculum_system: string
          curriculum_version: string | null
          document_id: string | null
          grade: string | null
          id: string
          is_active: boolean
          notes: string | null
          phase: string | null
          reference_type: string
          source_url: string | null
          subject: string | null
          title: string
          updated_at: string
          year: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          curriculum_system?: string
          curriculum_version?: string | null
          document_id?: string | null
          grade?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          phase?: string | null
          reference_type?: string
          source_url?: string | null
          subject?: string | null
          title: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          curriculum_system?: string
          curriculum_version?: string | null
          document_id?: string | null
          grade?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          phase?: string | null
          reference_type?: string
          source_url?: string | null
          subject?: string | null
          title?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_reference_docs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_tags: {
        Row: {
          confidence: number | null
          country: string | null
          created_at: string
          curriculum: string | null
          document_id: string
          grade: string | null
          id: string
          subject: string | null
          subtopic: string | null
          topic: string | null
        }
        Insert: {
          confidence?: number | null
          country?: string | null
          created_at?: string
          curriculum?: string | null
          document_id: string
          grade?: string | null
          id?: string
          subject?: string | null
          subtopic?: string | null
          topic?: string | null
        }
        Update: {
          confidence?: number | null
          country?: string | null
          created_at?: string
          curriculum?: string | null
          document_id?: string
          grade?: string | null
          id?: string
          subject?: string | null
          subtopic?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_tags_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_taxonomy: {
        Row: {
          country: string
          created_at: string
          curriculum: string
          grade: string
          id: string
          subject: string
          subtopic: string | null
          topic: string | null
        }
        Insert: {
          country: string
          created_at?: string
          curriculum: string
          grade: string
          id?: string
          subject: string
          subtopic?: string | null
          topic?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          curriculum?: string
          grade?: string
          id?: string
          subject?: string
          subtopic?: string | null
          topic?: string | null
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
      document_chunks: {
        Row: {
          char_count: number
          chunk_index: number
          content_hash: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string | null
          id: string
          text: string
        }
        Insert: {
          char_count: number
          chunk_index: number
          content_hash: string
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          text: string
        }
        Update: {
          char_count?: number
          chunk_index?: number
          content_hash?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_figures: {
        Row: {
          bytes: number | null
          caption: string | null
          created_at: string
          document_id: string
          height: number | null
          id: string
          label: string | null
          page_number: number
          storage_path: string
          width: number | null
        }
        Insert: {
          bytes?: number | null
          caption?: string | null
          created_at?: string
          document_id: string
          height?: number | null
          id?: string
          label?: string | null
          page_number?: number
          storage_path: string
          width?: number | null
        }
        Update: {
          bytes?: number | null
          caption?: string | null
          created_at?: string
          document_id?: string
          height?: number | null
          id?: string
          label?: string | null
          page_number?: number
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_figures_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          char_count: number
          clean_text: string | null
          cleaning_version: number
          content_hash: string
          country: string | null
          created_at: string
          current_chunk_index: number | null
          curriculum: string | null
          doc_type: string | null
          embeddings_status: string | null
          grade_level: string | null
          id: string
          import_job_id: string | null
          invalid_chunks: Json
          is_seeded: boolean
          language: string
          last_error: string | null
          license_type: Database["public"]["Enums"]["license_type"] | null
          page_count: number | null
          published_at: string | null
          raw_text: string | null
          seed_audio: boolean
          seed_audio_error: string | null
          seed_audio_progress: number
          seed_audio_status: string
          seed_translation: boolean
          source_id: string | null
          source_url: string | null
          subject_type: Database["public"]["Enums"]["subject_type"]
          tags: Json
          title: string
          translation_status: string
          updated_at: string
        }
        Insert: {
          char_count?: number
          clean_text?: string | null
          cleaning_version?: number
          content_hash: string
          country?: string | null
          created_at?: string
          current_chunk_index?: number | null
          curriculum?: string | null
          doc_type?: string | null
          embeddings_status?: string | null
          grade_level?: string | null
          id?: string
          import_job_id?: string | null
          invalid_chunks?: Json
          is_seeded?: boolean
          language?: string
          last_error?: string | null
          license_type?: Database["public"]["Enums"]["license_type"] | null
          page_count?: number | null
          published_at?: string | null
          raw_text?: string | null
          seed_audio?: boolean
          seed_audio_error?: string | null
          seed_audio_progress?: number
          seed_audio_status?: string
          seed_translation?: boolean
          source_id?: string | null
          source_url?: string | null
          subject_type?: Database["public"]["Enums"]["subject_type"]
          tags?: Json
          title: string
          translation_status?: string
          updated_at?: string
        }
        Update: {
          char_count?: number
          clean_text?: string | null
          cleaning_version?: number
          content_hash?: string
          country?: string | null
          created_at?: string
          current_chunk_index?: number | null
          curriculum?: string | null
          doc_type?: string | null
          embeddings_status?: string | null
          grade_level?: string | null
          id?: string
          import_job_id?: string | null
          invalid_chunks?: Json
          is_seeded?: boolean
          language?: string
          last_error?: string | null
          license_type?: Database["public"]["Enums"]["license_type"] | null
          page_count?: number | null
          published_at?: string | null
          raw_text?: string | null
          seed_audio?: boolean
          seed_audio_error?: string | null
          seed_audio_progress?: number
          seed_audio_status?: string
          seed_translation?: boolean
          source_id?: string | null
          source_url?: string | null
          subject_type?: Database["public"]["Enums"]["subject_type"]
          tags?: Json
          title?: string
          translation_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_context_caches: {
        Row: {
          cache_name: string
          created_at: string
          document_id: string
          expires_at: string
          id: string
          model: string
          target_language: string
        }
        Insert: {
          cache_name: string
          created_at?: string
          document_id: string
          expires_at: string
          id?: string
          model: string
          target_language: string
        }
        Update: {
          cache_name?: string
          created_at?: string
          document_id?: string
          expires_at?: string
          id?: string
          model?: string
          target_language?: string
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
      ingestion_batch_items: {
        Row: {
          batch_job_id: string
          created_at: string
          error: string | null
          id: string
          ingestion_job_id: string
          position: number
          result_ref: string | null
          status: string
        }
        Insert: {
          batch_job_id: string
          created_at?: string
          error?: string | null
          id?: string
          ingestion_job_id: string
          position: number
          result_ref?: string | null
          status?: string
        }
        Update: {
          batch_job_id?: string
          created_at?: string
          error?: string | null
          id?: string
          ingestion_job_id?: string
          position?: number
          result_ref?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_batch_items_batch_job_id_fkey"
            columns: ["batch_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_batch_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_batch_items_ingestion_job_id_fkey"
            columns: ["ingestion_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_batch_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          finished_at: string | null
          gemini_batch_name: string | null
          grade: string
          id: string
          item_count: number
          last_error: string | null
          report: Json | null
          stage: string
          state: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          gemini_batch_name?: string | null
          grade: string
          id?: string
          item_count?: number
          last_error?: string | null
          report?: Json | null
          stage: string
          state?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          gemini_batch_name?: string | null
          grade?: string
          id?: string
          item_count?: number
          last_error?: string | null
          report?: Json | null
          stage?: string
          state?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ingestion_jobs: {
        Row: {
          attempts: number
          batch_job_id: string | null
          batch_stage: string | null
          country: string | null
          created_at: string
          created_by: string | null
          curriculum: string | null
          document_id: string | null
          finished_at: string | null
          grade: string | null
          id: string
          idempotency_key: string | null
          input_raw_text: string | null
          input_upload_path: string | null
          input_url: string | null
          last_error: string | null
          progress: number
          source_id: string | null
          started_at: string | null
          state: Database["public"]["Enums"]["ingestion_state"]
          subject: string | null
          title_hint: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          batch_job_id?: string | null
          batch_stage?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          document_id?: string | null
          finished_at?: string | null
          grade?: string | null
          id?: string
          idempotency_key?: string | null
          input_raw_text?: string | null
          input_upload_path?: string | null
          input_url?: string | null
          last_error?: string | null
          progress?: number
          source_id?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["ingestion_state"]
          subject?: string | null
          title_hint?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          batch_job_id?: string | null
          batch_stage?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          curriculum?: string | null
          document_id?: string | null
          finished_at?: string | null
          grade?: string | null
          id?: string
          idempotency_key?: string | null
          input_raw_text?: string | null
          input_upload_path?: string | null
          input_url?: string | null
          last_error?: string | null
          progress?: number
          source_id?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["ingestion_state"]
          subject?: string | null
          title_hint?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_batch_job_id_fkey"
            columns: ["batch_job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_batch_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_stage_logs: {
        Row: {
          created_at: string
          id: string
          job_id: string
          message: string | null
          meta: Json
          stage: Database["public"]["Enums"]["ingestion_state"]
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          message?: string | null
          meta?: Json
          stage: Database["public"]["Enums"]["ingestion_state"]
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          message?: string | null
          meta?: Json
          stage?: Database["public"]["Enums"]["ingestion_state"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_stage_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
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
      payment_plan_codes: {
        Row: {
          amount_zar: number
          created_at: string
          plan_code: string
          plan_id: string
        }
        Insert: {
          amount_zar: number
          created_at?: string
          plan_code: string
          plan_id: string
        }
        Update: {
          amount_zar?: number
          created_at?: string
          plan_code?: string
          plan_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          cooldown_until: string | null
          created_at: string
          credits_balance: number
          current_streak: number
          display_name: string | null
          flagged_reason: string | null
          free_credits_expires_at: string | null
          grade: string | null
          id: string
          is_flagged: boolean
          last_reward_date: string | null
          level: number
          onboarding_completed: boolean | null
          plan: Database["public"]["Enums"]["subscription_plan"] | null
          preferred_language: string | null
          province: string | null
          school: string | null
          selected_subjects: string[] | null
          streak_grace_used: boolean
          updated_at: string
          user_id: string
          xp: number
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          cooldown_until?: string | null
          created_at?: string
          credits_balance?: number
          current_streak?: number
          display_name?: string | null
          flagged_reason?: string | null
          free_credits_expires_at?: string | null
          grade?: string | null
          id?: string
          is_flagged?: boolean
          last_reward_date?: string | null
          level?: number
          onboarding_completed?: boolean | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          preferred_language?: string | null
          province?: string | null
          school?: string | null
          selected_subjects?: string[] | null
          streak_grace_used?: boolean
          updated_at?: string
          user_id: string
          xp?: number
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          cooldown_until?: string | null
          created_at?: string
          credits_balance?: number
          current_streak?: number
          display_name?: string | null
          flagged_reason?: string | null
          free_credits_expires_at?: string | null
          grade?: string | null
          id?: string
          is_flagged?: boolean
          last_reward_date?: string | null
          level?: number
          onboarding_completed?: boolean | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          preferred_language?: string | null
          province?: string | null
          school?: string | null
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
      quiz_bank_attempt_questions: {
        Row: {
          answered_at: string | null
          attempt_id: string
          created_at: string
          given_answer: string | null
          id: string
          is_correct: boolean | null
          position: number
          question_id: string
          question_snapshot: Json
          question_version: number
        }
        Insert: {
          answered_at?: string | null
          attempt_id: string
          created_at?: string
          given_answer?: string | null
          id?: string
          is_correct?: boolean | null
          position: number
          question_id: string
          question_snapshot: Json
          question_version?: number
        }
        Update: {
          answered_at?: string | null
          attempt_id?: string
          created_at?: string
          given_answer?: string | null
          id?: string
          is_correct?: boolean | null
          position?: number
          question_id?: string
          question_snapshot?: Json
          question_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_bank_attempt_questions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "quiz_bank_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_bank_attempt_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_bank_attempts: {
        Row: {
          chunk_index: number | null
          completed_at: string | null
          correct_count: number
          created_at: string
          credits_charged: number
          document_id: string
          duration_seconds: number | null
          id: string
          idempotency_key: string | null
          language: string
          mode: string
          preset: string
          scope: string
          score: number | null
          started_at: string
          total_questions: number
          user_id: string
        }
        Insert: {
          chunk_index?: number | null
          completed_at?: string | null
          correct_count?: number
          created_at?: string
          credits_charged?: number
          document_id: string
          duration_seconds?: number | null
          id?: string
          idempotency_key?: string | null
          language?: string
          mode?: string
          preset?: string
          scope?: string
          score?: number | null
          started_at?: string
          total_questions?: number
          user_id: string
        }
        Update: {
          chunk_index?: number | null
          completed_at?: string | null
          correct_count?: number
          created_at?: string
          credits_charged?: number
          document_id?: string
          duration_seconds?: number | null
          id?: string
          idempotency_key?: string | null
          language?: string
          mode?: string
          preset?: string
          scope?: string
          score?: number | null
          started_at?: string
          total_questions?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_bank_attempts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_flags: {
        Row: {
          created_at: string
          flagged_by: string | null
          id: string
          question_id: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          flagged_by?: string | null
          id?: string
          question_id: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          flagged_by?: string | null
          id?: string
          question_id?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_flags_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_performance: {
        Row: {
          attempts: number
          chunk_index: number | null
          correct: number
          difficulty: string | null
          document_id: string
          id: string
          last_attempt_at: string | null
          question_type: string | null
          skill: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          chunk_index?: number | null
          correct?: number
          difficulty?: string | null
          document_id: string
          id?: string
          last_attempt_at?: string | null
          question_type?: string | null
          skill?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          chunk_index?: number | null
          correct?: number
          difficulty?: string | null
          document_id?: string
          id?: string
          last_attempt_at?: string | null
          question_type?: string | null
          skill?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_performance_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_question_exposure: {
        Row: {
          id: string
          last_seen_at: string | null
          question_id: string
          times_correct: number
          times_seen: number
          user_id: string
        }
        Insert: {
          id?: string
          last_seen_at?: string | null
          question_id: string
          times_correct?: number
          times_seen?: number
          user_id: string
        }
        Update: {
          id?: string
          last_seen_at?: string | null
          question_id?: string
          times_correct?: number
          times_seen?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_question_exposure_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_question_versions: {
        Row: {
          change_reason: string | null
          created_at: string
          created_by: string | null
          generation_job_id: string | null
          id: string
          question_id: string
          snapshot: Json
          source_content_hash: string | null
          status: string
          version: number
        }
        Insert: {
          change_reason?: string | null
          created_at?: string
          created_by?: string | null
          generation_job_id?: string | null
          id?: string
          question_id: string
          snapshot: Json
          source_content_hash?: string | null
          status: string
          version: number
        }
        Update: {
          change_reason?: string | null
          created_at?: string
          created_by?: string | null
          generation_job_id?: string | null
          id?: string
          question_id?: string
          snapshot?: Json
          source_content_hash?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_question_versions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          acceptable_answers: Json | null
          ai_validated: boolean
          answer_verified: boolean
          assessment_pattern_reference: string | null
          assessment_reference_type: string | null
          assessment_skill: string | null
          caps_subtopic: string | null
          caps_topic: string | null
          chunk_id: string | null
          chunk_index: number | null
          cognitive_level: string | null
          command_word: string | null
          correct_answer: string | null
          correct_order: Json | null
          created_at: string
          created_by: string | null
          curriculum_reference: string | null
          curriculum_system: string | null
          curriculum_version: string | null
          difficulty: string
          document_id: string
          exam_alignment_level: string
          expected_answer_points: Json | null
          explanation: string | null
          generation_job_id: string | null
          grade: string | null
          id: string
          items: Json | null
          language: string
          learning_outcome: string | null
          manually_edited: boolean
          mark_allocation: number | null
          marking_guidance: string | null
          options: Json | null
          phase: string | null
          question: string
          question_hash: string
          question_origin: string
          question_type: string
          quiz_bank_version: number
          replaced_by_id: string | null
          retired_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          skill: string | null
          source_content_hash: string | null
          source_material_type: string | null
          source_question_id: string | null
          source_reference: string | null
          status: string
          subject: string | null
          times_answered: number
          times_correct: number
          times_served: number
          topic: string | null
          translation_version: number | null
          updated_at: string
          validation: Json
          validation_status: string
          version: number
          working: string | null
        }
        Insert: {
          acceptable_answers?: Json | null
          ai_validated?: boolean
          answer_verified?: boolean
          assessment_pattern_reference?: string | null
          assessment_reference_type?: string | null
          assessment_skill?: string | null
          caps_subtopic?: string | null
          caps_topic?: string | null
          chunk_id?: string | null
          chunk_index?: number | null
          cognitive_level?: string | null
          command_word?: string | null
          correct_answer?: string | null
          correct_order?: Json | null
          created_at?: string
          created_by?: string | null
          curriculum_reference?: string | null
          curriculum_system?: string | null
          curriculum_version?: string | null
          difficulty?: string
          document_id: string
          exam_alignment_level?: string
          expected_answer_points?: Json | null
          explanation?: string | null
          generation_job_id?: string | null
          grade?: string | null
          id?: string
          items?: Json | null
          language?: string
          learning_outcome?: string | null
          manually_edited?: boolean
          mark_allocation?: number | null
          marking_guidance?: string | null
          options?: Json | null
          phase?: string | null
          question: string
          question_hash: string
          question_origin?: string
          question_type?: string
          quiz_bank_version?: number
          replaced_by_id?: string | null
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          skill?: string | null
          source_content_hash?: string | null
          source_material_type?: string | null
          source_question_id?: string | null
          source_reference?: string | null
          status?: string
          subject?: string | null
          times_answered?: number
          times_correct?: number
          times_served?: number
          topic?: string | null
          translation_version?: number | null
          updated_at?: string
          validation?: Json
          validation_status?: string
          version?: number
          working?: string | null
        }
        Update: {
          acceptable_answers?: Json | null
          ai_validated?: boolean
          answer_verified?: boolean
          assessment_pattern_reference?: string | null
          assessment_reference_type?: string | null
          assessment_skill?: string | null
          caps_subtopic?: string | null
          caps_topic?: string | null
          chunk_id?: string | null
          chunk_index?: number | null
          cognitive_level?: string | null
          command_word?: string | null
          correct_answer?: string | null
          correct_order?: Json | null
          created_at?: string
          created_by?: string | null
          curriculum_reference?: string | null
          curriculum_system?: string | null
          curriculum_version?: string | null
          difficulty?: string
          document_id?: string
          exam_alignment_level?: string
          expected_answer_points?: Json | null
          explanation?: string | null
          generation_job_id?: string | null
          grade?: string | null
          id?: string
          items?: Json | null
          language?: string
          learning_outcome?: string | null
          manually_edited?: boolean
          mark_allocation?: number | null
          marking_guidance?: string | null
          options?: Json | null
          phase?: string | null
          question?: string
          question_hash?: string
          question_origin?: string
          question_type?: string
          quiz_bank_version?: number
          replaced_by_id?: string | null
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          skill?: string | null
          source_content_hash?: string | null
          source_material_type?: string | null
          source_question_id?: string | null
          source_reference?: string | null
          status?: string
          subject?: string | null
          times_answered?: number
          times_correct?: number
          times_served?: number
          topic?: string | null
          translation_version?: number | null
          updated_at?: string
          validation?: Json
          validation_status?: string
          version?: number
          working?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_questions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_seed_job_items: {
        Row: {
          batch_position: number | null
          chunk_id: string | null
          chunk_index: number
          created_at: string
          document_id: string
          duplicate_questions: number
          error: string | null
          generated_questions: number
          id: string
          invalid_questions: number
          job_id: string
          requested_questions: number
          source_content_hash: string | null
          status: string
          updated_at: string
        }
        Insert: {
          batch_position?: number | null
          chunk_id?: string | null
          chunk_index: number
          created_at?: string
          document_id: string
          duplicate_questions?: number
          error?: string | null
          generated_questions?: number
          id?: string
          invalid_questions?: number
          job_id: string
          requested_questions?: number
          source_content_hash?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          batch_position?: number | null
          chunk_id?: string | null
          chunk_index?: number
          created_at?: string
          document_id?: string
          duplicate_questions?: number
          error?: string | null
          generated_questions?: number
          id?: string
          invalid_questions?: number
          job_id?: string
          requested_questions?: number
          source_content_hash?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_seed_job_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_seed_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "quiz_seed_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_seed_jobs: {
        Row: {
          approved_questions: number
          batch_name: string | null
          batch_state: string | null
          batch_submitted_at: string | null
          cancel_requested: boolean
          chunk_indexes: Json | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          difficulty_mix: Json
          document_id: string | null
          document_ids: Json
          duplicate_questions: number
          error_message: string | null
          estimated_cost_zar: number | null
          estimated_questions: number
          exam_alignment_level: string
          failed_questions: number
          generated_questions: number
          generation_mode: string
          id: string
          invalid_questions: number
          language: string
          model: string | null
          paused: boolean
          pricing_snapshot: Json | null
          published_questions: number
          question_types: Json
          questions_per_section: number
          scope: string
          skill_mix: Json
          started_at: string | null
          status: string
          target_questions: number
          total_sections: number
          updated_at: string
        }
        Insert: {
          approved_questions?: number
          batch_name?: string | null
          batch_state?: string | null
          batch_submitted_at?: string | null
          cancel_requested?: boolean
          chunk_indexes?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          difficulty_mix?: Json
          document_id?: string | null
          document_ids?: Json
          duplicate_questions?: number
          error_message?: string | null
          estimated_cost_zar?: number | null
          estimated_questions?: number
          exam_alignment_level?: string
          failed_questions?: number
          generated_questions?: number
          generation_mode?: string
          id?: string
          invalid_questions?: number
          language?: string
          model?: string | null
          paused?: boolean
          pricing_snapshot?: Json | null
          published_questions?: number
          question_types?: Json
          questions_per_section?: number
          scope?: string
          skill_mix?: Json
          started_at?: string | null
          status?: string
          target_questions?: number
          total_sections?: number
          updated_at?: string
        }
        Update: {
          approved_questions?: number
          batch_name?: string | null
          batch_state?: string | null
          batch_submitted_at?: string | null
          cancel_requested?: boolean
          chunk_indexes?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          difficulty_mix?: Json
          document_id?: string | null
          document_ids?: Json
          duplicate_questions?: number
          error_message?: string | null
          estimated_cost_zar?: number | null
          estimated_questions?: number
          exam_alignment_level?: string
          failed_questions?: number
          generated_questions?: number
          generation_mode?: string
          id?: string
          invalid_questions?: number
          language?: string
          model?: string | null
          paused?: boolean
          pricing_snapshot?: Json | null
          published_questions?: number
          question_types?: Json
          questions_per_section?: number
          scope?: string
          skill_mix?: Json
          started_at?: string | null
          status?: string
          target_questions?: number
          total_sections?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_seed_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_settings: {
        Row: {
          auto_publish_approved: boolean
          cognitive_mix_by_subject: Json
          credit_costs: Json
          default_questions_per_section: number
          generation_enabled: boolean
          id: number
          min_section_chars: number
          mode_presets: Json
          model_pricing: Json
          presets: Json
          require_review_subjects: Json
          strict_answer_verification_subjects: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_publish_approved?: boolean
          cognitive_mix_by_subject?: Json
          credit_costs?: Json
          default_questions_per_section?: number
          generation_enabled?: boolean
          id?: number
          min_section_chars?: number
          mode_presets?: Json
          model_pricing?: Json
          presets?: Json
          require_review_subjects?: Json
          strict_answer_verification_subjects?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_publish_approved?: boolean
          cognitive_mix_by_subject?: Json
          credit_costs?: Json
          default_questions_per_section?: number
          generation_enabled?: boolean
          id?: number
          min_section_chars?: number
          mode_presets?: Json
          model_pricing?: Json
          presets?: Json
          require_review_subjects?: Json
          strict_answer_verification_subjects?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      quiz_templates: {
        Row: {
          applies_to: string
          cognitive_mix: Json
          created_at: string
          description: string | null
          difficulty_mix: Json
          exam_alignment_level: string
          grade: string | null
          id: string
          is_default: boolean
          name: string
          question_types: Json
          questions_per_section: number
          skill_mix: Json
          subject: string | null
          updated_at: string
        }
        Insert: {
          applies_to?: string
          cognitive_mix?: Json
          created_at?: string
          description?: string | null
          difficulty_mix?: Json
          exam_alignment_level?: string
          grade?: string | null
          id?: string
          is_default?: boolean
          name: string
          question_types?: Json
          questions_per_section?: number
          skill_mix?: Json
          subject?: string | null
          updated_at?: string
        }
        Update: {
          applies_to?: string
          cognitive_mix?: Json
          created_at?: string
          description?: string | null
          difficulty_mix?: Json
          exam_alignment_level?: string
          grade?: string | null
          id?: string
          is_default?: boolean
          name?: string
          question_types?: Json
          questions_per_section?: number
          skill_mix?: Json
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
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
      seed_logs: {
        Row: {
          chunk_index: number
          created_at: string
          document_id: string
          error_message: string | null
          id: number
          retry_count: number
          status: string
        }
        Insert: {
          chunk_index: number
          created_at?: string
          document_id: string
          error_message?: string | null
          id?: number
          retry_count?: number
          status: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          document_id?: string
          error_message?: string | null
          id?: number
          retry_count?: number
          status?: string
        }
        Relationships: []
      }
      seed_queue: {
        Row: {
          attempts: number
          chunk_index: number
          completed_at: string | null
          created_at: string
          delayed_until: string | null
          document_id: string
          id: string
          last_error: string | null
          priority: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          chunk_index: number
          completed_at?: string | null
          created_at?: string
          delayed_until?: string | null
          document_id: string
          id?: string
          last_error?: string | null
          priority?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          chunk_index?: number
          completed_at?: string | null
          created_at?: string
          delayed_until?: string | null
          document_id?: string
          id?: string
          last_error?: string | null
          priority?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seed_queue_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_worker_state: {
        Row: {
          current_document_id: string | null
          current_queue_id: string | null
          id: number
          is_running: boolean
          last_error: string | null
          last_heartbeat: string | null
          total_processed: number
          updated_at: string
        }
        Insert: {
          current_document_id?: string | null
          current_queue_id?: string | null
          id?: number
          is_running?: boolean
          last_error?: string | null
          last_heartbeat?: string | null
          total_processed?: number
          updated_at?: string
        }
        Update: {
          current_document_id?: string | null
          current_queue_id?: string | null
          id?: number
          is_running?: boolean
          last_error?: string | null
          last_heartbeat?: string | null
          total_processed?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          paystack_customer_code: string | null
          paystack_email_token: string | null
          paystack_subscription_code: string | null
          plan: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      translation_assets: {
        Row: {
          char_count: number
          chunk_index: number
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string | null
          english_leak_detected: boolean
          id: string
          source_language: string
          source_text_hash: string | null
          target_language: string
          translated_text: string
          translation_version: number
        }
        Insert: {
          char_count?: number
          chunk_index: number
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_model?: string | null
          english_leak_detected?: boolean
          id?: string
          source_language?: string
          source_text_hash?: string | null
          target_language: string
          translated_text: string
          translation_version?: number
        }
        Update: {
          char_count?: number
          chunk_index?: number
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_model?: string | null
          english_leak_detected?: boolean
          id?: string
          source_language?: string
          source_text_hash?: string | null
          target_language?: string
          translated_text?: string
          translation_version?: number
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
      translation_blueprints: {
        Row: {
          batch_job_name: string | null
          batch_status: string | null
          batch_submitted_at: string | null
          blueprint_text: string
          created_at: string
          document_id: string
          id: string
          model: string
          token_estimate: number
          updated_at: string
          visual_prompts: Json | null
        }
        Insert: {
          batch_job_name?: string | null
          batch_status?: string | null
          batch_submitted_at?: string | null
          blueprint_text: string
          created_at?: string
          document_id: string
          id?: string
          model?: string
          token_estimate?: number
          updated_at?: string
          visual_prompts?: Json | null
        }
        Update: {
          batch_job_name?: string | null
          batch_status?: string | null
          batch_submitted_at?: string | null
          blueprint_text?: string
          created_at?: string
          document_id?: string
          id?: string
          model?: string
          token_estimate?: number
          updated_at?: string
          visual_prompts?: Json | null
        }
        Relationships: []
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
      translation_seed_logs: {
        Row: {
          chunk_index: number
          created_at: string
          document_id: string
          error_message: string | null
          id: number
          retry_count: number
          status: string
          target_language: string
        }
        Insert: {
          chunk_index: number
          created_at?: string
          document_id: string
          error_message?: string | null
          id?: never
          retry_count?: number
          status: string
          target_language: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          document_id?: string
          error_message?: string | null
          id?: never
          retry_count?: number
          status?: string
          target_language?: string
        }
        Relationships: []
      }
      translation_seed_queue: {
        Row: {
          attempts: number
          batch_index: number | null
          batch_job_name: string | null
          batch_submitted_at: string | null
          chunk_index: number
          completed_at: string | null
          created_at: string
          delayed_until: string | null
          document_id: string
          id: string
          last_error: string | null
          priority: number
          started_at: string | null
          status: string
          target_language: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          batch_index?: number | null
          batch_job_name?: string | null
          batch_submitted_at?: string | null
          chunk_index: number
          completed_at?: string | null
          created_at?: string
          delayed_until?: string | null
          document_id: string
          id?: string
          last_error?: string | null
          priority?: number
          started_at?: string | null
          status?: string
          target_language: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          batch_index?: number | null
          batch_job_name?: string | null
          batch_submitted_at?: string | null
          chunk_index?: number
          completed_at?: string | null
          created_at?: string
          delayed_until?: string | null
          document_id?: string
          id?: string
          last_error?: string | null
          priority?: number
          started_at?: string | null
          status?: string
          target_language?: string
          updated_at?: string
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
      translation_worker_state: {
        Row: {
          current_document_id: string | null
          current_language: string | null
          current_queue_id: string | null
          id: number
          is_running: boolean
          last_error: string | null
          last_heartbeat: string | null
          total_processed: number
          updated_at: string
        }
        Insert: {
          current_document_id?: string | null
          current_language?: string | null
          current_queue_id?: string | null
          id?: number
          is_running?: boolean
          last_error?: string | null
          last_heartbeat?: string | null
          total_processed?: number
          updated_at?: string
        }
        Update: {
          current_document_id?: string | null
          current_language?: string | null
          current_queue_id?: string | null
          id?: number
          is_running?: boolean
          last_error?: string | null
          last_heartbeat?: string | null
          total_processed?: number
          updated_at?: string
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
      user_activity: {
        Row: {
          activity_type: string
          created_at: string
          document_id: string
          id: string
          user_id: string
        }
        Insert: {
          activity_type?: string
          created_at?: string
          document_id: string
          id?: string
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          document_id?: string
          id?: string
          user_id?: string
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
          speaking_style: string | null
          user_id: string
          voice_name: string | null
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          chunk_index: number
          created_at?: string
          credits_charged?: number
          document_id: string
          id?: string
          language: string
          speaking_style?: string | null
          user_id: string
          voice_name?: string | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          chunk_index?: number
          created_at?: string
          credits_charged?: number
          document_id?: string
          id?: string
          language?: string
          speaking_style?: string | null
          user_id?: string
          voice_name?: string | null
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
      visual_prompts_batch_jobs: {
        Row: {
          batch_job_name: string
          document_id: string
          last_error: string | null
          status: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          batch_job_name: string
          document_id: string
          last_error?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          batch_job_name?: string
          document_id?: string
          last_error?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: []
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
      v_caps_coverage: {
        Row: {
          best_confidence: number | null
          country: string | null
          curriculum: string | null
          grade: string | null
          resources: number | null
          resources_any: number | null
          subject: string | null
          topic: string | null
        }
        Relationships: []
      }
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
      admin_investor_metrics: { Args: { _days: number }; Returns: Json }
      admin_pipeline_counts: { Args: { _ids: string[] }; Returns: Json }
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
      admin_top_documents_v2: {
        Args: { _limit?: number }
        Returns: {
          cache_hit: number
          cost: number
          doc_type: string
          document_id: string
          generations: number
          last_activity: string
          margin: number
          profit: number
          revenue: number
          tags: Json
          title: string
          unlocks: number
          users: number
        }[]
      }
      admin_translation_health: {
        Args: { _current_version?: number; _document_id?: string }
        Returns: {
          document_id: string
          leaked: number
          missing_hash: number
          stale_version: number
          total: number
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
      quiz_bank_overview: { Args: never; Returns: Json }
      quiz_bump_served: { Args: { _ids: string[] }; Returns: undefined }
      reclaim_stale_ingestion_jobs: {
        Args: { _stale_minutes?: number }
        Returns: number
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
      set_chunk_embeddings: {
        Args: { _ids: string[]; _model: string; _vecs: string[] }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "user"
      asset_type: "audio" | "image" | "quiz"
      ingestion_state:
        | "pending"
        | "downloading"
        | "parsing"
        | "structuring"
        | "tagging"
        | "cleaning"
        | "chunking"
        | "translating"
        | "audio_seeding"
        | "completed"
        | "failed"
        | "cancelled"
      license_type:
        | "public_domain"
        | "creative_commons"
        | "government_educational"
        | "educational_use"
        | "unknown"
      source_verification: "unverified" | "verified" | "blocked"
      subject_type: "novel" | "history" | "science" | "other"
      subscription_plan: "free" | "essential" | "premium"
      voice_provider: "azure" | "elevenlabs" | "gemini"
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
    Enums: {
      app_role: ["admin", "user"],
      asset_type: ["audio", "image", "quiz"],
      ingestion_state: [
        "pending",
        "downloading",
        "parsing",
        "structuring",
        "tagging",
        "cleaning",
        "chunking",
        "translating",
        "audio_seeding",
        "completed",
        "failed",
        "cancelled",
      ],
      license_type: [
        "public_domain",
        "creative_commons",
        "government_educational",
        "educational_use",
        "unknown",
      ],
      source_verification: ["unverified", "verified", "blocked"],
      subject_type: ["novel", "history", "science", "other"],
      subscription_plan: ["free", "essential", "premium"],
      voice_provider: ["azure", "elevenlabs", "gemini"],
    },
  },
} as const
