CREATE TABLE IF NOT EXISTS "gitdiagram_diagram_cache" (
	"username" varchar(256) NOT NULL,
	"repo" varchar(256) NOT NULL,
	"diagram" text DEFAULT '' NOT NULL,
	"explanation" text DEFAULT 'No explanation provided' NOT NULL,
	"graph" jsonb DEFAULT 'null'::jsonb,
	"latest_session_id" varchar(128),
	"latest_session_status" varchar(32) DEFAULT 'idle' NOT NULL,
	"latest_session_stage" varchar(64),
	"latest_session_provider" varchar(64),
	"latest_session_model" varchar(256),
	"latest_session_audit" jsonb DEFAULT 'null'::jsonb,
	"last_successful_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone,
	"used_own_key" boolean DEFAULT false,
	CONSTRAINT "gitdiagram_diagram_cache_username_repo_pk" PRIMARY KEY("username","repo")
);

ALTER TABLE "gitdiagram_diagram_cache"
	ALTER COLUMN "diagram" TYPE text,
	ALTER COLUMN "diagram" SET DEFAULT '',
	ALTER COLUMN "explanation" TYPE text,
	ALTER COLUMN "explanation" SET DEFAULT 'No explanation provided';

ALTER TABLE "gitdiagram_diagram_cache"
	ADD COLUMN IF NOT EXISTS "graph" jsonb DEFAULT 'null'::jsonb,
	ADD COLUMN IF NOT EXISTS "latest_session_id" varchar(128),
	ADD COLUMN IF NOT EXISTS "latest_session_status" varchar(32) DEFAULT 'idle',
	ADD COLUMN IF NOT EXISTS "latest_session_stage" varchar(64),
	ADD COLUMN IF NOT EXISTS "latest_session_provider" varchar(64),
	ADD COLUMN IF NOT EXISTS "latest_session_model" varchar(256),
	ADD COLUMN IF NOT EXISTS "latest_session_audit" jsonb DEFAULT 'null'::jsonb,
	ADD COLUMN IF NOT EXISTS "last_successful_at" timestamp with time zone;
