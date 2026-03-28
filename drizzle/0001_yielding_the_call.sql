CREATE TABLE "gitdiagram_openai_daily_quota" (
	"quota_date_utc" varchar(10) NOT NULL,
	"quota_bucket" varchar(128) NOT NULL,
	"used_tokens" integer DEFAULT 0 NOT NULL,
	"reserved_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "gitdiagram_openai_daily_quota_quota_date_utc_quota_bucket_pk" PRIMARY KEY("quota_date_utc","quota_bucket")
);
